import { randomBytes } from "node:crypto";
import {
  type Avaliacao,
  agruparEmLotes,
  avaliar,
  type EntradaMedida,
  type EventoExecucao,
  podeConferir,
  proximoPasso,
  resumir,
  situacaoDoPonto,
  TransicaoInvalida,
  transicionar,
} from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx } from "@canteirocheck/db";
import { idJob } from "@canteirocheck/queue";
import { eq } from "drizzle-orm";
import { ErroDominio } from "../contexto";
import type { Efeitos } from "../transacao";
import { carregarPontos, type PontoDaExecucao, registrosDaRodada, travarExecucao } from "./pontos";

const { execucaoEtapa, verificacao, divergencia, flowSessao, midia } = schema;

const VALIDADE_SESSAO_MS = 48 * 3600 * 1000;

/** Estado guardado na `flow_sessao` de checklist: só a ordem dos pontos do lote e a rodada. */
export interface EstadoSessaoChecklist {
  rodada: number;
  titulo: string;
  pontos: string[];
  lote: number; // 1-based
  totalLotes: number;
}

/** Foto vinda do Flow: só os metadados; o worker baixa, decifra e guarda. */
export interface FotoRecebida {
  origem: "flow_cdn" | "whatsapp_media" | "upload_painel";
  fonte: unknown;
  mimeType?: string;
}

type Execucao = typeof execucaoEtapa.$inferSelect;

async function aplicarEvento(tx: Tx, exec: Execucao, evento: EventoExecucao): Promise<Execucao> {
  let novo: ReturnType<typeof transicionar>;
  try {
    novo = transicionar({ status: exec.status, rodada: exec.rodadaAtual }, evento);
  } catch (e) {
    if (e instanceof TransicaoInvalida) {
      throw new ErroDominio("conflito", `A execução está "${exec.status}" e não aceita esta ação.`);
    }
    throw e;
  }
  if (novo.status === exec.status && novo.rodada === exec.rodadaAtual) return exec;
  const [atualizada] = await tx
    .update(execucaoEtapa)
    .set({ status: novo.status, rodadaAtual: novo.rodada, versao: exec.versao + 1 })
    .where(eq(execucaoEtapa.id, exec.id))
    .returning();
  if (!atualizada) throw new Error("falha ao atualizar execução");
  return atualizada;
}

export { aplicarEvento };

function novoToken() {
  return randomBytes(32).toString("base64url");
}

export interface ConferenciaAberta {
  token: string;
  titulo: string;
  totalPontos: number;
  lote: number;
  totalLotes: number;
}

/**
 * Abre (ou reabre) a conferência: entra em `em_conferencia` (nova rodada se veio de recusa) e cria a
 * sessão do Flow com o próximo lote de pontos pendentes. Sem pontos pendentes → null.
 */
export async function abrirConferencia(
  tx: Tx,
  execucaoId: string,
  usuarioId: string,
): Promise<ConferenciaAberta | null> {
  let exec = await travarExecucao(tx, execucaoId);
  if (!podeConferir(exec.status)) {
    throw new ErroDominio("conflito", `A execução está "${exec.status}" e não pode ser conferida agora.`);
  }
  exec = await aplicarEvento(tx, exec, "iniciar_conferencia");

  const pontos = await carregarPontos(tx, exec);
  if (pontos.length === 0) {
    throw new ErroDominio("invalido", "Não há pontos de controle aprovados para esta etapa neste local.");
  }
  const registros = await registrosDaRodada(tx, exec.id, exec.rodadaAtual);
  const pendentes = pontos.filter((p) => {
    const s = situacaoDoPonto(p.id, registros).tipo;
    return s === "medir" || s === "causa";
  });
  if (pendentes.length === 0) return null;

  const lotes = agruparEmLotes(pendentes);
  const primeiro = lotes[0];
  if (!primeiro) return null;
  const estado: EstadoSessaoChecklist = {
    rodada: exec.rodadaAtual,
    titulo: primeiro.titulo,
    pontos: primeiro.pontos.map((p) => p.id),
    lote: 1,
    totalLotes: lotes.length,
  };
  const token = novoToken();
  await tx.insert(flowSessao).values({
    token,
    tenantId: exec.tenantId,
    tipo: "checklist",
    usuarioId,
    execucaoId: exec.id,
    estado,
    expiraEm: new Date(Date.now() + VALIDADE_SESSAO_MS),
  });
  return {
    token,
    titulo: primeiro.titulo,
    totalPontos: primeiro.pontos.length,
    lote: 1,
    totalLotes: lotes.length,
  };
}

export interface SessaoChecklist {
  token: string;
  tenantId: string;
  usuarioId: string;
  execucaoId: string;
  estado: EstadoSessaoChecklist;
  concluida: boolean;
}

export async function carregarSessaoChecklist(tx: Tx, token: string): Promise<SessaoChecklist> {
  const [s] = await tx.select().from(flowSessao).where(eq(flowSessao.token, token));
  if (s?.tipo !== "checklist" || !s.execucaoId)
    throw new ErroDominio("nao_encontrado", "Sessão não encontrada.");
  return {
    token: s.token,
    tenantId: s.tenantId,
    usuarioId: s.usuarioId,
    execucaoId: s.execucaoId,
    estado: s.estado as EstadoSessaoChecklist,
    concluida: s.concluidaEm !== null,
  };
}

/** Situação atual da sessão: execução, pontos do lote e o próximo passo do motor. */
export async function estadoDaSessao(tx: Tx, sessao: SessaoChecklist) {
  const [exec] = await tx.select().from(execucaoEtapa).where(eq(execucaoEtapa.id, sessao.execucaoId));
  if (!exec) throw new ErroDominio("nao_encontrado", "Execução não encontrada.");
  const todos = await carregarPontos(tx, exec);
  const porId = new Map(todos.map((p) => [p.id, p]));
  const pontos = sessao.estado.pontos.map((id) => porId.get(id)).filter((p): p is PontoDaExecucao => !!p);
  const registros = await registrosDaRodada(tx, exec.id, sessao.estado.rodada);
  const ids = pontos.map((p) => p.id);
  return {
    exec,
    pontos,
    todos,
    registros,
    passo: proximoPasso(ids, registros),
    resumo: resumir(ids, registros),
    rodadaVencida: exec.rodadaAtual !== sessao.estado.rodada,
  };
}

function exigirSessaoAtiva(sessao: SessaoChecklist, exec: Execucao) {
  if (sessao.concluida) throw new ErroDominio("conflito", "Esta conferência já foi enviada.");
  if (exec.rodadaAtual !== sessao.estado.rodada) {
    throw new ErroDominio("conflito", "Esta conferência é de uma rodada anterior. Abra a conferência nova.");
  }
  if (exec.status !== "em_conferencia" && exec.status !== "bloqueada") {
    throw new ErroDominio("conflito", `A execução está "${exec.status}" e não recebe medidas agora.`);
  }
}

async function registrarFoto(
  tx: Tx,
  efeitos: Efeitos,
  tenantId: string,
  foto: FotoRecebida,
  dono: { verificacaoId: string } | { divergenciaId: string },
) {
  const [m] = await tx
    .insert(midia)
    .values({ tenantId, origem: foto.origem, fonte: foto.fonte, mimeType: foto.mimeType ?? null, ...dono })
    .returning({ id: midia.id });
  if (!m) throw new Error("falha ao registrar mídia");
  efeitos.enfileirar("baixar_midia", { tenantId, midiaId: m.id }, { jobId: idJob("midia", m.id) });
}

export interface MedidaRegistrada {
  verificacaoId: string;
  tentativa: number;
  avaliacao: Avaliacao;
  ponto: PontoDaExecucao;
}

/** Grava uma medida do ponto atual. A comparação é do core; o banco guarda o resultado. */
export async function registrarMedida(
  tx: Tx,
  efeitos: Efeitos,
  entrada: {
    sessao: SessaoChecklist;
    pontoId: string;
    medida: EntradaMedida;
    observacao?: string | null;
    foto?: FotoRecebida | null;
    canal: "flow" | "conversa" | "painel";
    estruturada?: boolean;
  },
): Promise<MedidaRegistrada> {
  const { sessao } = entrada;
  const exec = await travarExecucao(tx, sessao.execucaoId);
  exigirSessaoAtiva(sessao, exec);

  const pontos = await carregarPontos(tx, exec);
  const ponto = pontos.find((p) => p.id === entrada.pontoId);
  if (!ponto || !sessao.estado.pontos.includes(ponto.id)) {
    throw new ErroDominio("invalido", "Ponto não faz parte desta conferência.");
  }
  const registros = await registrosDaRodada(tx, exec.id, exec.rodadaAtual);
  const situacao = situacaoDoPonto(ponto.id, registros);
  if (situacao.tipo !== "medir") throw new ErroDominio("conflito", "Este ponto não espera medida agora.");
  if (ponto.exigeFoto && !entrada.foto) throw new ErroDominio("invalido", "Este ponto exige foto.");

  const avaliacao = avaliar(ponto, entrada.medida);
  const [v] = await tx
    .insert(verificacao)
    .values({
      tenantId: exec.tenantId,
      execucaoId: exec.id,
      pontoId: ponto.id,
      rodada: exec.rodadaAtual,
      tentativa: situacao.tentativa,
      valorMedido: avaliacao.valorMedido,
      valorReferencia: avaliacao.valorReferencia,
      mesmaReferenciaNivel: avaliacao.mesmaReferenciaNivel,
      diferenca: avaliacao.diferenca,
      unidade: ponto.unidade,
      dentroTolerancia: avaliacao.dentro,
      observacao: entrada.observacao?.trim() || null,
      canal: entrada.canal,
      estruturada: entrada.estruturada ?? true,
      usuarioId: sessao.usuarioId,
      flowToken: sessao.token || null, // "" = medida confirmada pela conversa (sem Flow)
    })
    .returning({ id: verificacao.id });
  if (!v) throw new Error("falha ao gravar verificação");
  if (entrada.foto) await registrarFoto(tx, efeitos, exec.tenantId, entrada.foto, { verificacaoId: v.id });

  return { verificacaoId: v.id, tentativa: situacao.tentativa, avaliacao, ponto };
}

/** 2ª medida fora confirmada → causa provável + foto → divergência e execução bloqueada. */
export async function registrarCausa(
  tx: Tx,
  efeitos: Efeitos,
  entrada: {
    sessao: SessaoChecklist;
    pontoId: string;
    causa: string;
    descricao?: string | null;
    foto: FotoRecebida | null;
    exigirFoto?: boolean;
  },
): Promise<{ divergenciaId: string }> {
  const { sessao } = entrada;
  let exec = await travarExecucao(tx, sessao.execucaoId);
  exigirSessaoAtiva(sessao, exec);
  if (!sessao.estado.pontos.includes(entrada.pontoId)) {
    throw new ErroDominio("invalido", "Ponto não faz parte desta conferência.");
  }
  const causa = entrada.causa.trim();
  if (!causa) throw new ErroDominio("invalido", "Informe a causa provável.");
  if ((entrada.exigirFoto ?? true) && !entrada.foto)
    throw new ErroDominio("invalido", "Envie uma foto da situação.");

  const registros = await registrosDaRodada(tx, exec.id, exec.rodadaAtual);
  if (situacaoDoPonto(entrada.pontoId, registros).tipo !== "causa") {
    throw new ErroDominio("conflito", "Este ponto não espera causa agora.");
  }
  const ultima = registros
    .filter((r) => r.pontoId === entrada.pontoId)
    .reduce((a, b) => (b.tentativa > a.tentativa ? b : a));

  const [d] = await tx
    .insert(divergencia)
    .values({
      tenantId: exec.tenantId,
      execucaoId: exec.id,
      verificacaoId: ultima.verificacaoId,
      causaProvavel: causa,
      descricao: entrada.descricao?.trim() || null,
      usuarioId: sessao.usuarioId,
    })
    .returning({ id: divergencia.id });
  if (!d) throw new Error("falha ao gravar divergência");
  if (entrada.foto) await registrarFoto(tx, efeitos, exec.tenantId, entrada.foto, { divergenciaId: d.id });

  const antes = exec.status;
  exec = await aplicarEvento(tx, exec, "divergencia_confirmada");
  await registrarAuditoria(tx, {
    tenantId: exec.tenantId,
    ator: { tipo: "usuario", id: sessao.usuarioId },
    acao: "execucao.bloqueada",
    entidade: "execucao_etapa",
    entidadeId: exec.id,
    antes: { status: antes },
    depois: { status: exec.status, rodada: exec.rodadaAtual, pontoId: entrada.pontoId, causa },
  });
  return { divergenciaId: d.id };
}

export interface LoteConcluido {
  statusExecucao: Execucao["status"];
  execucaoCompleta: boolean;
  okDoLote: string[];
  divergentesDoLote: string[];
  pontosRestantes: number;
}

/**
 * Fim do lote (tela de resumo → complete). Se todos os pontos da rodada foram respondidos,
 * fecha a conferência (aguardando_liberacao, ou continua bloqueada) e avisa o engenheiro.
 */
export async function concluirLote(
  tx: Tx,
  efeitos: Efeitos,
  sessao: SessaoChecklist,
): Promise<LoteConcluido> {
  let exec = await travarExecucao(tx, sessao.execucaoId);
  if (exec.rodadaAtual !== sessao.estado.rodada) {
    throw new ErroDominio("conflito", "Esta conferência é de uma rodada anterior.");
  }
  const registros = await registrosDaRodada(tx, exec.id, exec.rodadaAtual);
  const doLote = resumir(sessao.estado.pontos, registros);
  if (!doLote.completo) throw new ErroDominio("invalido", "Ainda há pontos sem resposta nesta conferência.");

  if (!sessao.concluida) {
    await tx.update(flowSessao).set({ concluidaEm: new Date() }).where(eq(flowSessao.token, sessao.token));
  }

  const todos = await carregarPontos(tx, exec);
  const geral = resumir(
    todos.map((p) => p.id),
    registros,
  );
  if (geral.completo && (exec.status === "em_conferencia" || exec.status === "bloqueada")) {
    const antes = exec.status;
    exec = await aplicarEvento(tx, exec, "conferencia_concluida");
    await registrarAuditoria(tx, {
      tenantId: exec.tenantId,
      ator: { tipo: "usuario", id: sessao.usuarioId },
      acao: "execucao.conferencia_concluida",
      entidade: "execucao_etapa",
      entidadeId: exec.id,
      antes: { status: antes },
      depois: {
        status: exec.status,
        rodada: exec.rodadaAtual,
        ok: geral.ok.length,
        divergentes: geral.divergentes.length,
      },
    });
    efeitos.enfileirar(
      "notificar_engenheiro",
      { tenantId: exec.tenantId, execucaoId: exec.id, rodada: exec.rodadaAtual },
      { jobId: idJob("eng", exec.id, exec.rodadaAtual) },
    );
  }
  return {
    statusExecucao: exec.status,
    execucaoCompleta: geral.completo,
    okDoLote: doLote.ok,
    divergentesDoLote: doLote.divergentes,
    pontosRestantes: geral.pendentes.length,
  };
}
