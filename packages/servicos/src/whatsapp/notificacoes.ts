import { schema } from "@canteirocheck/db";
import { templateAnuncioDiario } from "@canteirocheck/whatsapp";
import { and, eq } from "drizzle-orm";
import { resumoDaExecucao } from "../execucoes/consultas";
import { emTransacao } from "../transacao";
import { prepararMensagem } from "./saida";
import { descreverExecucao, enviarFlowAnuncio, rotuloExecucao } from "./sessoes";

const { liberacao, pendencia, obra, obraMembro, usuario } = schema;

/**
 * Job `notificar_engenheiro`: resumo verde/vermelho da rodada + botões Liberar/Recusar.
 * Os ids dos botões levam execução e rodada: um botão velho não decide uma rodada nova.
 */
export async function notificarEngenheiro(tenantId: string, execucaoId: string, rodada: number) {
  return emTransacao(tenantId, async (tx, efeitos) => {
    const r = await resumoDaExecucao(tx, execucaoId);
    if (!r || r.rodadaAtual !== rodada) return { enviado: false };
    if (r.status !== "bloqueada" && r.status !== "aguardando_liberacao") return { enviado: false };
    const rod = r.rodadas.find((x) => x.rodada === rodada);
    if (!rod || rod.decisao) return { enviado: false };

    const linhas = rod.pontos.map((p) => {
      const ultima = p.tentativas.at(-1);
      if (p.situacao === "ok") return `✅ ${p.descricao}: ${ultima?.texto ?? ""}`;
      if (p.situacao === "divergente") {
        const tent = p.tentativas.length > 1 ? ` (${p.tentativas.length} medidas)` : "";
        return `❌ ${p.descricao}: ${ultima?.texto ?? ""}${tent} — esperado ${p.esperado}. Causa: ${p.divergencia?.causa ?? "?"}`;
      }
      return `⏳ ${p.descricao}: sem resposta`;
    });
    const bloqueada = r.status === "bloqueada";
    const titulo = `${bloqueada ? "🔴 BLOQUEADA" : "🟢 Pronta para liberar"} — ${r.etapaNome} · ${r.localNome}`;
    const texto = [
      titulo,
      `${r.obraNome} · conferida por ${r.anunciadaPor}${rodada > 1 ? ` · ${rodada}ª rodada` : ""}`,
      "",
      ...linhas,
      "",
      bloqueada
        ? "Para liberar com divergência é preciso justificar."
        : "Todos os pontos dentro da tolerância.",
    ].join("\n");

    await prepararMensagem(tx, efeitos, {
      tenantId,
      usuarioId: r.engenheiroResponsavel.id,
      obraId: r.obraId,
      execucaoId: r.id,
      payload: {
        assunto: `${r.etapaNome} da ${r.localNome} ${bloqueada ? "bloqueada" : "pronta para liberar"}`,
        mensagem: {
          tipo: "botoes",
          texto,
          botoes: [
            { id: `lib:${r.id}:${rodada}`, titulo: "Liberar" },
            { id: `rec:${r.id}:${rodada}`, titulo: "Recusar" },
          ],
        },
      },
    });
    return { enviado: true };
  });
}

/** Job `notificar_encarregado`: resultado da decisão + próximo passo. */
export async function notificarEncarregado(tenantId: string, liberacaoId: string) {
  return emTransacao(tenantId, async (tx, efeitos) => {
    const [l] = await tx
      .select({ l: liberacao, engenheiro: usuario.nome })
      .from(liberacao)
      .innerJoin(usuario, eq(usuario.id, liberacao.engenheiroId))
      .where(eq(liberacao.id, liberacaoId));
    if (!l) return { enviado: false };
    const d = await descreverExecucao(tx, l.l.execucaoId);
    const rotulo = rotuloExecucao(d);
    const recusada = l.l.decisao === "recusada";
    const texto = recusada
      ? `❌ ${rotulo} RECUSADA por ${l.engenheiro}.\nMotivo: ${l.l.justificativa}\n\nAjuste e reenvie a conferência antes de executar.`
      : `✅ ${rotulo} LIBERADA por ${l.engenheiro}.${l.l.justificativa ? `\nObservação: ${l.l.justificativa}` : ""}`;
    await prepararMensagem(tx, efeitos, {
      tenantId,
      usuarioId: d.anunciadaPorId,
      obraId: d.obraId,
      execucaoId: d.id,
      payload: {
        assunto: `${rotulo} ${recusada ? "recusada" : "liberada"}`,
        mensagem: recusada
          ? { tipo: "botoes", texto, botoes: [{ id: `conferir:${d.id}`, titulo: "Reenviar conferência" }] }
          : { tipo: "texto", texto },
      },
    });
    return { enviado: true };
  });
}

/** Job `avisar_pendencia`: etapa anunciada, mas o projeto tem pendência aberta que a bloqueia. */
export async function avisarPendencia(tenantId: string, execucaoId: string) {
  return emTransacao(tenantId, async (tx, efeitos) => {
    const d = await descreverExecucao(tx, execucaoId);
    const [exec] = await tx
      .select()
      .from(schema.execucaoEtapa)
      .where(eq(schema.execucaoEtapa.id, execucaoId));
    if (!exec) return { enviado: false };
    const abertas = await tx
      .select({ texto: pendencia.textoOriginal, risco: pendencia.risco })
      .from(pendencia)
      .where(
        and(
          eq(pendencia.obraId, d.obraId),
          eq(pendencia.status, "aberta"),
          eq(pendencia.etapaBloqueadaId, exec.etapaId),
        ),
      );
    if (abertas.length === 0) return { enviado: false };
    await prepararMensagem(tx, efeitos, {
      tenantId,
      usuarioId: d.responsavelId,
      obraId: d.obraId,
      execucaoId: d.id,
      payload: {
        assunto: `pendência de projeto em ${rotuloExecucao(d)}`,
        mensagem: {
          tipo: "texto",
          texto: [
            `⚠️ ${d.anunciadaPorNome} anunciou ${rotuloExecucao(d)} para ${d.dataPrevista.split("-").reverse().join("/")}, mas o projeto tem pendência aberta que bloqueia esta etapa:`,
            ...abertas.slice(0, 5).map((p) => `• (${p.risco}) ${p.texto.slice(0, 200)}`),
            "",
            "Resolva a pendência no painel antes da liberação.",
          ].join("\n"),
        },
      },
    });
    return { enviado: true };
  });
}

/** Job `anuncio_diario`: pergunta aos encarregados da obra o que vai ser executado amanhã. */
export async function anuncioDiario(tenantId: string, obraId: string) {
  return emTransacao(tenantId, async (tx, efeitos) => {
    const [o] = await tx
      .select({ nome: obra.nome, status: obra.status })
      .from(obra)
      .where(eq(obra.id, obraId));
    if (o?.status !== "ativa") return { enviados: 0 };
    const encarregados = await tx
      .select({ id: usuario.id, nome: usuario.nome })
      .from(obraMembro)
      .innerJoin(usuario, eq(usuario.id, obraMembro.usuarioId))
      .where(
        and(eq(obraMembro.obraId, obraId), eq(obraMembro.papel, "encarregado"), eq(usuario.ativo, true)),
      );
    for (const e of encarregados) {
      // Janela aberta → Flow direto. Fechada → template com botão "Anunciar" (que abre um Flow novo).
      await enviarFlowAnuncio(tx, efeitos, {
        tenantId,
        usuarioId: e.id,
        obraId,
        descartarSeFechada: true,
        templateSeFechada: templateAnuncioDiario(e.nome.split(" ")[0] ?? e.nome, o.nome, obraId),
      });
    }
    return { enviados: encarregados.length };
  });
}
