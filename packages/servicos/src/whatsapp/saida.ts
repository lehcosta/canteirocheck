import { schema, type Tx, withTenant } from "@canteirocheck/db";
import { idJob } from "@canteirocheck/queue";
import {
  type ClienteWhatsapp,
  clienteWhatsapp,
  descreverMensagem,
  ErroGraph,
  type MensagemSaida,
  templateAviso,
} from "@canteirocheck/whatsapp";
import { and, desc, eq, ne } from "drizzle-orm";
import { Efeitos } from "../transacao";

const { mensagemWhatsapp, usuario, obra } = schema;

/** O que fica gravado em `mensagem_whatsapp.payload` de uma mensagem de saída. */
export interface PayloadSaida {
  mensagem: MensagemSaida;
  /** Texto curto para o template de aviso, se a janela de 24h estiver fechada. */
  assunto: string;
  /** Com a janela fechada, manda ESTE template no lugar do aviso genérico… */
  templateSeFechada?: MensagemSaida;
  /** …e descarta a mensagem original (o botão do template gera uma nova). */
  descartarSeFechada?: boolean;
}

/** Margem para não mandar não-template com a janela quase fechando. */
const JANELA_MS = 24 * 3600 * 1000 - 10 * 60 * 1000;

/**
 * Grava a mensagem como `pendente` na mesma transação do caso de uso e agenda o envio para
 * depois do commit. O worker decide entre mandar já (janela aberta) ou segurar e mandar template.
 */
export async function prepararMensagem(
  tx: Tx,
  efeitos: Efeitos,
  m: {
    tenantId: string;
    usuarioId: string;
    obraId?: string | null;
    execucaoId?: string | null;
    payload: PayloadSaida;
  },
): Promise<string> {
  const [linha] = await tx
    .insert(mensagemWhatsapp)
    .values({
      tenantId: m.tenantId,
      usuarioId: m.usuarioId,
      obraId: m.obraId ?? null,
      execucaoId: m.execucaoId ?? null,
      direcao: "saida",
      tipo: m.payload.mensagem.tipo,
      payload: m.payload,
      statusEntrega: "pendente",
    })
    .returning({ id: mensagemWhatsapp.id });
  if (!linha) throw new Error("falha ao gravar mensagem de saída");
  efeitos.enfileirar(
    "enviar_mensagem",
    { tenantId: m.tenantId, mensagemId: linha.id },
    { jobId: idJob("env", linha.id) },
  );
  return linha.id;
}

export async function janelaAberta(tx: Tx, usuarioId: string, agora = Date.now()): Promise<boolean> {
  const [ultima] = await tx
    .select({ criadoEm: mensagemWhatsapp.criadoEm })
    .from(mensagemWhatsapp)
    .where(and(eq(mensagemWhatsapp.usuarioId, usuarioId), eq(mensagemWhatsapp.direcao, "entrada")))
    .orderBy(desc(mensagemWhatsapp.criadoEm))
    .limit(1);
  return !!ultima && agora - ultima.criadoEm.getTime() < JANELA_MS;
}

export type ResultadoEnvio =
  | { tipo: "enviada"; waMessageId: string }
  | { tipo: "aguardando_janela"; avisoId: string | null }
  | { tipo: "descartada" }
  | { tipo: "ignorada"; motivo: string }
  | { tipo: "falhou"; erro: string };

/**
 * Job `enviar_mensagem`. Com a janela de 24h aberta (ou se for template) envia; senão segura a
 * mensagem (`aguardando_janela`) e manda UM template de aviso — quando o usuário toca no botão,
 * a janela abre e a entrada libera o que estava esperando.
 */
export async function enviarMensagemPendente(
  tenantId: string,
  mensagemId: string,
  cliente: ClienteWhatsapp = clienteWhatsapp(),
): Promise<ResultadoEnvio> {
  const efeitos = new Efeitos();
  const resultado = await withTenant(tenantId, async (tx): Promise<ResultadoEnvio> => {
    const [m] = await tx
      .select()
      .from(mensagemWhatsapp)
      .where(eq(mensagemWhatsapp.id, mensagemId))
      .for("update");
    if (m?.direcao !== "saida") return { tipo: "ignorada", motivo: "não encontrada" };
    if (m.statusEntrega !== "pendente") return { tipo: "ignorada", motivo: `status ${m.statusEntrega}` };
    if (!m.usuarioId) return { tipo: "ignorada", motivo: "sem destinatário" };

    const [u] = await tx
      .select({
        nome: usuario.nome,
        e164: usuario.whatsappE164,
        waId: usuario.whatsappWaId,
        ativo: usuario.ativo,
      })
      .from(usuario)
      .where(eq(usuario.id, m.usuarioId));
    if (!u?.ativo) {
      await tx
        .update(mensagemWhatsapp)
        .set({ statusEntrega: "descartada" })
        .where(eq(mensagemWhatsapp.id, m.id));
      return { tipo: "descartada" };
    }
    const payload = m.payload as PayloadSaida;
    const ehTemplate = payload.mensagem.tipo === "template";

    if (!ehTemplate && !(await janelaAberta(tx, m.usuarioId))) {
      if (payload.descartarSeFechada) {
        await tx
          .update(mensagemWhatsapp)
          .set({ statusEntrega: "descartada" })
          .where(eq(mensagemWhatsapp.id, m.id));
      } else {
        await tx
          .update(mensagemWhatsapp)
          .set({ statusEntrega: "aguardando_janela" })
          .where(eq(mensagemWhatsapp.id, m.id));
      }
      // Um aviso só, mesmo que várias mensagens fiquem esperando.
      const [outraEsperando] = await tx
        .select({ id: mensagemWhatsapp.id })
        .from(mensagemWhatsapp)
        .where(
          and(
            eq(mensagemWhatsapp.usuarioId, m.usuarioId),
            eq(mensagemWhatsapp.statusEntrega, "aguardando_janela"),
            ne(mensagemWhatsapp.id, m.id),
          ),
        )
        .limit(1);
      if (outraEsperando && !payload.templateSeFechada) return { tipo: "aguardando_janela", avisoId: null };

      let template = payload.templateSeFechada;
      if (!template) {
        const [o] = m.obraId
          ? await tx.select({ nome: obra.nome }).from(obra).where(eq(obra.id, m.obraId))
          : [];
        template = templateAviso(u.nome.split(" ")[0] ?? u.nome, o?.nome ?? "sua obra", payload.assunto);
      }
      const [aviso] = await tx
        .insert(mensagemWhatsapp)
        .values({
          tenantId,
          usuarioId: m.usuarioId,
          obraId: m.obraId,
          execucaoId: m.execucaoId,
          direcao: "saida",
          tipo: "template",
          payload: { mensagem: template, assunto: payload.assunto } satisfies PayloadSaida,
          statusEntrega: "pendente",
        })
        .returning({ id: mensagemWhatsapp.id });
      if (aviso) {
        efeitos.enfileirar(
          "enviar_mensagem",
          { tenantId, mensagemId: aviso.id },
          { jobId: idJob("env", aviso.id) },
        );
      }
      return payload.descartarSeFechada
        ? { tipo: "descartada" }
        : { tipo: "aguardando_janela", avisoId: aviso?.id ?? null };
    }

    const destino = u.waId ?? u.e164.replace(/\D/g, "");
    try {
      const { waMessageId } = await cliente.enviar(destino, payload.mensagem);
      await tx
        .update(mensagemWhatsapp)
        .set({ waMessageId, statusEntrega: "enviada" })
        .where(eq(mensagemWhatsapp.id, m.id));
      return { tipo: "enviada", waMessageId };
    } catch (e) {
      if (e instanceof ErroGraph && e.definitivo) {
        await tx
          .update(mensagemWhatsapp)
          .set({
            statusEntrega: "failed",
            erroEntrega: { status: e.status, codigo: e.codigo, corpo: e.corpo } as never,
          })
          .where(eq(mensagemWhatsapp.id, m.id));
        return { tipo: "falhou", erro: e.message };
      }
      throw e; // transitório: o BullMQ tenta de novo
    }
  });
  await efeitos.despachar();
  return resultado;
}

/** Entrada do usuário abriu a janela: o que estava esperando volta para a fila. */
export async function liberarMensagensEsperando(
  tx: Tx,
  efeitos: Efeitos,
  tenantId: string,
  usuarioId: string,
) {
  const esperando = await tx
    .update(mensagemWhatsapp)
    .set({ statusEntrega: "pendente" })
    .where(
      and(eq(mensagemWhatsapp.usuarioId, usuarioId), eq(mensagemWhatsapp.statusEntrega, "aguardando_janela")),
    )
    .returning({ id: mensagemWhatsapp.id });
  for (const m of esperando) {
    efeitos.enfileirar(
      "enviar_mensagem",
      { tenantId, mensagemId: m.id },
      { jobId: idJob("env", m.id, Date.now()) },
    );
  }
  return esperando.length;
}

export { descreverMensagem };
