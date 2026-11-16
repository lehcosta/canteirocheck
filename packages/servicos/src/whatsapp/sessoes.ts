import { randomBytes } from "node:crypto";
import { schema, type Tx } from "@canteirocheck/db";
import type { MensagemSaida } from "@canteirocheck/whatsapp";
import { FLOWS } from "@canteirocheck/whatsapp/flows";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ErroDominio } from "../contexto";
import { abrirConferencia } from "../execucoes/conferencia";
import type { Efeitos } from "../transacao";
import { prepararMensagem } from "./saida";

const { execucaoEtapa, etapa, local, obra, usuario, flowSessao } = schema;

const VALIDADE_MS = 48 * 3600 * 1000;

export interface DescricaoExecucao {
  id: string;
  tenantId: string;
  obraId: string;
  obraNome: string;
  etapaNome: string;
  localNome: string;
  status: (typeof execucaoEtapa.$inferSelect)["status"];
  rodadaAtual: number;
  dataPrevista: string;
  anunciadaPorId: string;
  anunciadaPorNome: string;
  responsavelId: string;
  responsavelNome: string;
}

export async function descreverExecucao(tx: Tx, execucaoId: string): Promise<DescricaoExecucao> {
  const anunciante = alias(usuario, "anunciante");
  const responsavel = alias(usuario, "responsavel");
  const [e] = await tx
    .select({
      id: execucaoEtapa.id,
      tenantId: execucaoEtapa.tenantId,
      obraId: obra.id,
      obraNome: obra.nome,
      etapaNome: etapa.nome,
      localNome: local.nome,
      status: execucaoEtapa.status,
      rodadaAtual: execucaoEtapa.rodadaAtual,
      dataPrevista: execucaoEtapa.dataPrevista,
      anunciadaPorId: anunciante.id,
      anunciadaPorNome: anunciante.nome,
      responsavelId: responsavel.id,
      responsavelNome: responsavel.nome,
    })
    .from(execucaoEtapa)
    .innerJoin(obra, eq(obra.id, execucaoEtapa.obraId))
    .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
    .innerJoin(local, eq(local.id, execucaoEtapa.localId))
    .innerJoin(anunciante, eq(anunciante.id, execucaoEtapa.anunciadaPorId))
    .innerJoin(responsavel, eq(responsavel.id, obra.engenheiroResponsavelId))
    .where(eq(execucaoEtapa.id, execucaoId));
  if (!e) throw new ErroDominio("nao_encontrado", "Execução não encontrada.");
  return e;
}

/** "Concretagem · L4" */
export const rotuloExecucao = (d: Pick<DescricaoExecucao, "etapaNome" | "localNome">) =>
  `${d.etapaNome} · ${d.localNome}`;

function token() {
  return randomBytes(32).toString("base64url");
}

/** Abre a conferência e manda o Flow do checklist para quem vai medir. */
export async function enviarFlowChecklist(
  tx: Tx,
  efeitos: Efeitos,
  a: { usuarioId: string; execucaoId: string },
): Promise<{ enviado: boolean; motivo?: string }> {
  const d = await descreverExecucao(tx, a.execucaoId);
  const conf = await abrirConferencia(tx, a.execucaoId, a.usuarioId);
  if (!conf) return { enviado: false, motivo: "Todos os pontos desta rodada já foram respondidos." };
  const parte = conf.totalLotes > 1 ? ` (parte ${conf.lote} de ${conf.totalLotes}: ${conf.titulo})` : "";
  await prepararMensagem(tx, efeitos, {
    tenantId: d.tenantId,
    usuarioId: a.usuarioId,
    obraId: d.obraId,
    execucaoId: d.id,
    payload: {
      assunto: `conferência de ${rotuloExecucao(d)}`,
      mensagem: {
        tipo: "flow",
        cabecalho: rotuloExecucao(d),
        texto: `Conferência antes de executar${parte}: ${conf.totalPontos} ${conf.totalPontos === 1 ? "ponto" : "pontos"} para medir. Meça cada ponto e envie; o resultado aparece na hora.`,
        rodape: d.obraNome,
        flowNome: FLOWS.checklist,
        flowToken: conf.token,
        cta: "Conferir agora",
      },
    },
  });
  return { enviado: true };
}

export async function enviarFlowAnuncio(
  tx: Tx,
  efeitos: Efeitos,
  a: {
    tenantId: string;
    usuarioId: string;
    obraId?: string | null;
    descartarSeFechada?: boolean;
    templateSeFechada?: MensagemSaida;
  },
) {
  const t = token();
  await tx.insert(flowSessao).values({
    token: t,
    tenantId: a.tenantId,
    tipo: "anuncio",
    usuarioId: a.usuarioId,
    estado: a.obraId ? { obraId: a.obraId } : {},
    expiraEm: new Date(Date.now() + VALIDADE_MS),
  });
  const [o] = a.obraId ? await tx.select({ nome: obra.nome }).from(obra).where(eq(obra.id, a.obraId)) : [];
  await prepararMensagem(tx, efeitos, {
    tenantId: a.tenantId,
    usuarioId: a.usuarioId,
    obraId: a.obraId ?? null,
    payload: {
      assunto: "o que vai ser executado amanhã",
      descartarSeFechada: a.descartarSeFechada ?? false,
      ...(a.templateSeFechada ? { templateSeFechada: a.templateSeFechada } : {}),
      mensagem: {
        tipo: "flow",
        texto: `O que vai ser executado${o ? ` na obra ${o.nome}` : ""}? Informe a etapa e os locais para receber a conferência certa.`,
        flowNome: FLOWS.anuncio,
        flowToken: t,
        cta: "Anunciar",
      },
    },
  });
}

export interface EstadoJustificativa {
  execucaoId: string;
  rodada: number;
  decisao: "liberada" | "recusada";
}

export async function enviarFlowJustificativa(
  tx: Tx,
  efeitos: Efeitos,
  a: { usuarioId: string } & EstadoJustificativa,
) {
  const d = await descreverExecucao(tx, a.execucaoId);
  const t = token();
  await tx.insert(flowSessao).values({
    token: t,
    tenantId: d.tenantId,
    tipo: "recusa",
    usuarioId: a.usuarioId,
    execucaoId: d.id,
    estado: { execucaoId: d.id, rodada: a.rodada, decisao: a.decisao } satisfies EstadoJustificativa,
    expiraEm: new Date(Date.now() + VALIDADE_MS),
  });
  const verbo = a.decisao === "recusada" ? "recusar" : "liberar com divergência";
  await prepararMensagem(tx, efeitos, {
    tenantId: d.tenantId,
    usuarioId: a.usuarioId,
    obraId: d.obraId,
    execucaoId: d.id,
    payload: {
      assunto: `justificativa para ${verbo} ${rotuloExecucao(d)}`,
      mensagem: {
        tipo: "flow",
        texto: `Para ${verbo} ${rotuloExecucao(d)}, escreva a justificativa. Ela fica no registro e no relatório.`,
        flowNome: FLOWS.justificativa,
        flowToken: t,
        cta: "Escrever justificativa",
      },
    },
  });
}
