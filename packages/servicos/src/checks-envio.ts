import {
  avaliarResposta,
  diasEntre,
  lerDataDaResposta,
  lerNumero,
  type Momento,
  type SaidaDoCheck,
  saidasDoCheck,
  simOuNao,
  unidadeDaMedida,
} from "@canteirocheck/core";
import { listarChecksAprovados, registrarAuditoria, schema, type Tx } from "@canteirocheck/db";
import { idJob } from "@canteirocheck/queue";
import type { MensagemSaida } from "@canteirocheck/whatsapp";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { type Contexto, ErroDominio } from "./contexto";
import { hojeNoFuso, type LinhaDoCronograma, linhasDaVersao } from "./cruzamentos";
import { type Efeitos, emTransacao } from "./transacao";
import { prepararMensagem } from "./whatsapp/saida";

const {
  checkFase,
  checkPergunta,
  checkEnvio,
  checkResposta,
  riscoFase,
  cruzamento,
  cronogramaTarefa,
  cronogramaVersao,
  obra,
  obraMembro,
  usuario,
} = schema;

/**
 * Envio dos checks pelo WhatsApp e a conversa de resposta. O check aprovado sai no dia e na hora
 * da regra, uma pergunta por mensagem: sim ou não e opções curtas com botões; data, medida e texto
 * por escrito; a foto, quando a pergunta pede, vem logo depois da resposta. Cada resposta é gravada
 * na hora e comparada com a esperada pelo core (nunca pela IA). Resposta fora do esperado avisa o
 * engenheiro responsável quando o check termina.
 */

/** Quantos dias depois da data marcada um envio ainda sai (worker parado, aprovação tardia). */
export const ATRASO_MAXIMO_DIAS = 7;
/** Enquanto um check espera resposta, o próximo para a mesma pessoa aguarda este tempo. */
const CONVERSA_ABERTA_MS = 24 * 3600 * 1000;

const ROTULO_DO_MOMENTO: Record<Momento, string> = {
  antes: "Antes de começar",
  durante: "Durante",
  depois: "Depois de terminar",
};

export const horaNoFuso = (fuso: string, agora = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(agora)
    .replace(/^24/, "00");

type Pergunta = typeof checkPergunta.$inferSelect;
type Envio = typeof checkEnvio.$inferSelect;

/**
 * A tarefa do cronograma vigente a que cada pergunta está presa: a que vai começar, quando a
 * pergunta vem de uma passagem entre tarefas. A linha citada pelo risco é da versão cruzada; a
 * tarefa é achada na vigente pelo uid do MS Project.
 */
export async function ancorasDasPerguntas(
  tx: Tx,
  linhas: LinhaDoCronograma[],
  perguntas: { id: string; riscoId: string | null }[],
): Promise<Map<string, LinhaDoCronograma>> {
  const riscos = [...new Set(perguntas.flatMap((p) => (p.riscoId ? [p.riscoId] : [])))];
  if (riscos.length === 0) return new Map();
  const citadas = await tx
    .select({ riscoId: riscoFase.id, uid: cronogramaTarefa.uid })
    .from(riscoFase)
    .innerJoin(cruzamento, eq(cruzamento.id, riscoFase.cruzamentoId))
    .innerJoin(
      cronogramaTarefa,
      and(
        eq(cronogramaTarefa.versaoId, cruzamento.cronogramaVersaoId),
        eq(cronogramaTarefa.ordem, riscoFase.cronogramaOrdem),
      ),
    )
    .where(and(inArray(riscoFase.id, riscos), eq(riscoFase.tipo, "sequencia")));
  const porUid = new Map(linhas.map((l) => [l.uid, l]));
  const porRisco = new Map(
    citadas.flatMap((c) => {
      const linha = porUid.get(c.uid);
      return linha ? [[c.riscoId, linha] as const] : [];
    }),
  );
  return new Map(
    perguntas.flatMap((p) => {
      const linha = p.riscoId ? porRisco.get(p.riscoId) : undefined;
      return linha ? [[p.id, linha] as const] : [];
    }),
  );
}

/** As saídas de um check no cronograma vigente, com a âncora de cada pergunta. */
export async function saidasDoCheckNaVersao(
  tx: Tx,
  k: { momento: Momento; dias: number },
  fase: { inicio: string | null; termino: string | null },
  linhas: LinhaDoCronograma[],
  ativas: { id: string; riscoId: string | null }[],
): Promise<{ saidas: SaidaDoCheck[]; ancoras: Map<string, LinhaDoCronograma> }> {
  const ancoras =
    k.momento === "antes"
      ? await ancorasDasPerguntas(tx, linhas, ativas)
      : new Map<string, LinhaDoCronograma>();
  const saidas = saidasDoCheck(
    k,
    fase,
    ativas.map((p) => ({ id: p.id, ancoraInicio: ancoras.get(p.id)?.inicio ?? null })),
  );
  return { saidas, ancoras };
}

// ─────────────────────────── Despacho ───────────────────────────

export interface ResultadoDespacho {
  checks: number;
  enviados: number;
  /** A primeira falha, se houve (as outras obras não param por causa dela). */
  erro: string | null;
}

/** Job `despachar_checks`: passa por todos os checks aprovados e manda os que chegaram na hora. */
export async function despacharChecks(agora = new Date()): Promise<ResultadoDespacho> {
  const lista = await listarChecksAprovados();
  let enviados = 0;
  let erro: string | null = null;
  for (const c of lista) {
    try {
      if ((await despacharCheck(c.tenantId, c.checkId, agora)).enviado) enviados++;
    } catch (e) {
      erro ??= `${c.checkId}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { checks: lista.length, enviados, erro };
}

/**
 * Manda UMA saída do check, se há uma devida: a data chegou (até 7 dias atrás), a hora da regra
 * já passou no fuso da obra, ela ainda não saiu e quem responde não está no meio de outro check.
 * Em "durante" e "depois" só a data mais recente conta; em "antes", cada grupo de perguntas tem a
 * sua data (a pergunta de passagem sai antes da tarefa dela) e os grupos saem um por vez.
 */
export async function despacharCheck(
  tenantId: string,
  checkId: string,
  agora = new Date(),
): Promise<{ enviado: boolean; motivo?: string; envioId?: string }> {
  return emTransacao(tenantId, async (tx, efeitos) => {
    const [k] = await tx.select().from(checkFase).where(eq(checkFase.id, checkId)).for("update");
    if (!k?.aprovadoEm || !k.responsavelId) return { enviado: false, motivo: "não aprovado" };
    const responsavelId = k.responsavelId;
    const [o] = await tx.select().from(obra).where(eq(obra.id, k.obraId));
    if (o?.status !== "ativa") return { enviado: false, motivo: "obra não ativa" };
    const [quem] = await tx
      .select({ id: usuario.id })
      .from(usuario)
      .innerJoin(obraMembro, and(eq(obraMembro.usuarioId, usuario.id), eq(obraMembro.obraId, k.obraId)))
      .where(and(eq(usuario.id, responsavelId), eq(usuario.ativo, true)));
    if (!quem) return { enviado: false, motivo: "quem responde saiu da equipe" };

    const hoje = hojeNoFuso(o.fusoHorario, agora);
    if (horaNoFuso(o.fusoHorario, agora) < k.hora) return { enviado: false, motivo: "antes da hora" };

    const [aberta] = await tx
      .select({ id: checkEnvio.id })
      .from(checkEnvio)
      .innerJoin(checkFase, eq(checkFase.id, checkEnvio.checkId))
      .where(
        and(
          eq(checkFase.responsavelId, responsavelId),
          isNull(checkEnvio.respondidoEm),
          gt(checkEnvio.enviadoEm, new Date(agora.getTime() - CONVERSA_ABERTA_MS)),
        ),
      )
      .limit(1);
    if (aberta) return { enviado: false, motivo: "outro check espera resposta" };

    const [vigente] = await tx
      .select({ id: cronogramaVersao.id })
      .from(cronogramaVersao)
      .where(and(eq(cronogramaVersao.obraId, k.obraId), eq(cronogramaVersao.vigente, true)));
    if (!vigente) return { enviado: false, motivo: "sem cronograma" };
    const { linhas, fases } = await linhasDaVersao(tx, vigente.id);
    const fase = fases.find((f) => f.uid === k.faseUid);
    if (!fase) return { enviado: false, motivo: "a fase saiu do cronograma" };

    const ativas = await tx
      .select()
      .from(checkPergunta)
      .where(and(eq(checkPergunta.checkId, k.id), isNull(checkPergunta.removidaEm)))
      .orderBy(asc(checkPergunta.ordem), asc(checkPergunta.id));
    const { saidas, ancoras } = await saidasDoCheckNaVersao(tx, k, fase, linhas, ativas);
    const envios = await tx.select().from(checkEnvio).where(eq(checkEnvio.checkId, k.id));
    const datasEnviadas = new Set(envios.map((e) => e.previstoPara));
    // Em "antes" cada pergunta sai uma vez só, mesmo que o cronograma mude a data dela depois.
    const jaForam = new Set(
      k.momento === "antes" ? envios.flatMap((e) => e.perguntaIds ?? ativas.map((p) => p.id)) : [],
    );
    const devidas = saidas
      .filter(
        (s) => s.data <= hoje && diasEntre(s.data, hoje) <= ATRASO_MAXIMO_DIAS && !datasEnviadas.has(s.data),
      )
      .map((s) => ({ ...s, perguntas: s.perguntas.filter((id) => !jaForam.has(id)) }))
      .filter((s) => s.perguntas.length > 0);
    const saida = k.momento === "antes" ? devidas[0] : devidas.at(-1);
    if (!saida) return { enviado: false, motivo: "nada para hoje" };

    const perguntas = saida.perguntas.flatMap((id) => ativas.find((p) => p.id === id) ?? []);
    const [primeira] = perguntas;
    if (!primeira) return { enviado: false, motivo: "nada para hoje" };
    const tarefas = [...new Set(perguntas.map((p) => ancoras.get(p.id)?.nome ?? null))];
    const alvo = tarefas.length === 1 && tarefas[0] ? tarefas[0] : fase.nome;

    const [envio] = await tx
      .insert(checkEnvio)
      .values({
        tenantId,
        checkId: k.id,
        previstoPara: saida.data,
        enviadoEm: agora,
        entrega: "enviado",
        perguntaIds: perguntas.map((p) => p.id),
      })
      .returning();
    if (!envio) throw new Error("falha ao registrar o envio do check");
    const mensagemId = await perguntar(tx, efeitos, {
      tenantId,
      usuarioId: responsavelId,
      obraId: k.obraId,
      envio,
      pergunta: primeira,
      cabecalho: `*Check · ${o.nome}*\n${ROTULO_DO_MOMENTO[k.momento]}: ${alvo}\n${
        perguntas.length === 1 ? "1 pergunta rápida." : `${perguntas.length} perguntas rápidas.`
      }`,
      assunto: `check de ${alvo}`,
    });
    await tx.update(checkEnvio).set({ mensagemId }).where(eq(checkEnvio.id, envio.id));
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "sistema", id: null },
      acao: "check.enviado",
      entidade: "check_envio",
      entidadeId: envio.id,
      depois: { checkId: k.id, previstoPara: saida.data, perguntas: perguntas.length, alvo },
    });
    return { enviado: true, envioId: envio.id };
  });
}

// ─────────────────────────── Perguntas ───────────────────────────

const LIMITE_DO_BOTAO = 20;
const idBotao = (envioId: string, perguntaId: string, valor: string) =>
  `chk:${envioId}:${perguntaId}:${valor}`;

/** As opções cabem em botões? Até 3, curtas e diferentes entre si. */
const opcoesEmBotoes = (opcoes: string[]) =>
  opcoes.length >= 2 &&
  opcoes.length <= 3 &&
  opcoes.every((o) => o.length <= LIMITE_DO_BOTAO) &&
  new Set(opcoes).size === opcoes.length;

function mensagemDaPergunta(envioId: string, p: Pergunta, texto: string): MensagemSaida {
  if (p.tipoResposta === "sim_nao")
    return {
      tipo: "botoes",
      texto,
      botoes: [
        { id: idBotao(envioId, p.id, "s"), titulo: "Sim" },
        { id: idBotao(envioId, p.id, "n"), titulo: "Não" },
      ],
    };
  if (p.tipoResposta === "opcao") {
    if (opcoesEmBotoes(p.opcoes))
      return {
        tipo: "botoes",
        texto,
        botoes: p.opcoes.map((o, i) => ({ id: idBotao(envioId, p.id, `o${i}`), titulo: o })),
      };
    return {
      tipo: "texto",
      texto: `${texto}\n\n${p.opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\nResponda com o número.`,
    };
  }
  const dica =
    p.tipoResposta === "data"
      ? "Responda com a data (dia/mês/ano)."
      : p.tipoResposta === "medida"
        ? `Responda só com o número, em ${unidadeDaMedida(p.opcoes) ?? "m"}.`
        : "Responda por texto ou áudio.";
  return { tipo: "texto", texto: `${texto}\n\n${dica}` };
}

/** Manda a pergunta e deixa o envio esperando por ela. Devolve o id da mensagem. */
async function perguntar(
  tx: Tx,
  efeitos: Efeitos,
  d: {
    tenantId: string;
    usuarioId: string;
    obraId: string;
    envio: Envio;
    pergunta: Pergunta;
    cabecalho?: string;
    assunto?: string;
  },
): Promise<string> {
  const ids = d.envio.perguntaIds ?? [];
  const posicao = ids.indexOf(d.pergunta.id) + 1;
  const numerada = ids.length > 1 && posicao > 0 ? `${posicao}/${ids.length} · ` : "";
  const texto = [d.cabecalho, `${numerada}${d.pergunta.texto}`].filter(Boolean).join("\n\n");
  await tx
    .update(checkEnvio)
    .set({ aguardandoPerguntaId: d.pergunta.id, aguardandoFoto: false })
    .where(eq(checkEnvio.id, d.envio.id));
  return prepararMensagem(tx, efeitos, {
    tenantId: d.tenantId,
    usuarioId: d.usuarioId,
    obraId: d.obraId,
    payload: {
      assunto: d.assunto ?? "pergunta do check",
      mensagem: mensagemDaPergunta(d.envio.id, d.pergunta, texto),
    },
  });
}

// ─────────────────────────── Respostas ───────────────────────────

/** O envio que espera resposta desta pessoa (o mais recente), travado. */
async function envioEsperando(tx: Tx, usuarioId: string): Promise<Envio | null> {
  const [linha] = await tx
    .select({ id: checkEnvio.id })
    .from(checkEnvio)
    .innerJoin(checkFase, eq(checkFase.id, checkEnvio.checkId))
    .where(
      and(
        eq(checkFase.responsavelId, usuarioId),
        isNull(checkEnvio.respondidoEm),
        isNotNull(checkEnvio.aguardandoPerguntaId),
      ),
    )
    .orderBy(desc(checkEnvio.enviadoEm))
    .limit(1);
  if (!linha) return null;
  const [envio] = await tx.select().from(checkEnvio).where(eq(checkEnvio.id, linha.id)).for("update");
  return envio && !envio.respondidoEm ? envio : null;
}

const dizer = (tx: Tx, efeitos: Efeitos, ctx: Contexto, obraId: string, texto: string, assunto = "check") =>
  prepararMensagem(tx, efeitos, {
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    obraId,
    payload: { assunto, mensagem: { tipo: "texto", texto } },
  });

async function obraDoEnvio(tx: Tx, envio: Envio) {
  const [k] = await tx.select().from(checkFase).where(eq(checkFase.id, envio.checkId));
  if (!k) throw new Error("envio sem check");
  return k;
}

/** O que o texto diz, no formato gravado; null quando não serve de resposta para o tipo da pergunta. */
export function lerRespostaDoCheck(
  p: Pick<Pergunta, "tipoResposta" | "opcoes">,
  texto: string,
  hoje: string,
) {
  const t = texto.trim();
  if (!t) return null;
  if (p.tipoResposta === "sim_nao") return simOuNao(t.replace(/[.!]+$/, ""));
  if (p.tipoResposta === "opcao") {
    const n = /^\d+$/.test(t) ? Number(t) : null;
    if (n !== null) return p.opcoes[n - 1] ?? null;
    const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    return p.opcoes.find((o) => igual(o, t)) ?? null;
  }
  if (p.tipoResposta === "data") return lerDataDaResposta(t, hoje);
  if (p.tipoResposta === "medida") {
    const lido = lerNumero(t.replace(/\s*(mm|cm|m)\.?$/i, ""));
    return lido.ok ? lido.valor.toString() : null;
  }
  return t.slice(0, 2000);
}

const DE_NOVO: Record<Pergunta["tipoResposta"], string> = {
  sim_nao: "Não entendi. Responda Sim ou Não.",
  opcao: "Não entendi. Responda com o número de uma das opções.",
  data: "Não entendi a data. Responda no formato dia/mês/ano, por exemplo 25/11/2026.",
  medida: "Não entendi o número. Responda só com o valor, por exemplo 2,75.",
  texto: "Não entendi. Responda por texto.",
};

/** Grava a resposta (uma por pergunta do envio) e segue: pede a foto, ou a próxima pergunta. */
async function gravar(tx: Tx, efeitos: Efeitos, ctx: Contexto, envio: Envio, p: Pergunta, valor: string) {
  await tx
    .insert(checkResposta)
    .values({
      tenantId: ctx.tenantId,
      envioId: envio.id,
      perguntaId: p.id,
      valor,
      dentroDoEsperado: avaliarResposta({ tipo: p.tipoResposta, esperada: p.esperada }, valor),
    })
    .onConflictDoNothing({ target: [checkResposta.envioId, checkResposta.perguntaId] });
  if (p.pedeFoto) {
    const k = await obraDoEnvio(tx, envio);
    await tx
      .update(checkEnvio)
      .set({ aguardandoPerguntaId: p.id, aguardandoFoto: true })
      .where(eq(checkEnvio.id, envio.id));
    await prepararMensagem(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      obraId: k.obraId,
      payload: {
        assunto: "foto do check",
        mensagem: {
          tipo: "botoes",
          texto: "Anotado. Mande uma foto que mostre isso.",
          botoes: [{ id: idBotao(envio.id, p.id, "x"), titulo: "Sem foto" }],
        },
      },
    });
    return { acao: "check:foto_pedida" };
  }
  return avancar(tx, efeitos, ctx, envio);
}

/** A próxima pergunta sem resposta; sem nenhuma, fecha o envio. */
async function avancar(tx: Tx, efeitos: Efeitos, ctx: Contexto, envio: Envio): Promise<{ acao: string }> {
  const k = await obraDoEnvio(tx, envio);
  const respostas = await tx.select().from(checkResposta).where(eq(checkResposta.envioId, envio.id));
  const respondidas = new Set(respostas.map((r) => r.perguntaId));
  const ids = envio.perguntaIds ?? [];
  const perguntas = ids.length
    ? await tx.select().from(checkPergunta).where(inArray(checkPergunta.id, ids))
    : [];
  const proxima = ids
    .flatMap((id) => perguntas.find((p) => p.id === id) ?? [])
    .find((p) => !respondidas.has(p.id));
  if (proxima) {
    await perguntar(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      obraId: k.obraId,
      envio,
      pergunta: proxima,
    });
    return { acao: "check:proxima" };
  }

  const fora = respostas.filter((r) => r.dentroDoEsperado === false);
  await tx
    .update(checkEnvio)
    .set({
      respondidoEm: new Date(),
      respondidoPorId: ctx.usuarioId,
      foraDoEsperado: fora.length,
      aguardandoPerguntaId: null,
      aguardandoFoto: false,
    })
    .where(eq(checkEnvio.id, envio.id));
  await registrarAuditoria(tx, {
    tenantId: ctx.tenantId,
    ator: { tipo: "usuario", id: ctx.usuarioId },
    acao: "check.respondido",
    entidade: "check_envio",
    entidadeId: envio.id,
    depois: { respostas: respostas.length, foraDoEsperado: fora.length },
  });
  await dizer(tx, efeitos, ctx, k.obraId, "✅ Respostas registradas. Obrigado!");

  const [o] = await tx
    .select({ nome: obra.nome, engenheiroId: obra.engenheiroResponsavelId })
    .from(obra)
    .where(eq(obra.id, k.obraId));
  if (fora.length > 0 && o?.engenheiroId) {
    const [quem] = await tx.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, ctx.usuarioId));
    const mostrar = (v: string) => (v === "sim" ? "Sim" : v === "nao" ? "Não" : v);
    const linhas = fora.flatMap((r) => {
      const p = perguntas.find((x) => x.id === r.perguntaId);
      return p
        ? [`• ${p.texto}\n  Resposta: ${mostrar(r.valor)}${p.esperada ? ` (esperado: ${p.esperada})` : ""}`]
        : [];
    });
    await prepararMensagem(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: o.engenheiroId,
      obraId: k.obraId,
      payload: {
        assunto: "check com resposta fora do esperado",
        mensagem: {
          tipo: "texto",
          texto: [
            `⚠️ *Check · ${o.nome}*`,
            `${quem?.nome ?? "A obra"} respondeu ${fora.length === 1 ? "1 pergunta" : `${fora.length} perguntas`} fora do esperado:`,
            linhas.join("\n"),
            "Veja no painel, em Cronograma, na fase.",
          ].join("\n\n"),
        },
      },
    });
  }
  // o próximo check que esperava esta conversa acabar
  efeitos.enfileirar("despachar_checks", {}, { jobId: idJob("chk-prox", envio.id) });
  return { acao: fora.length > 0 ? "check:respondido_com_alerta" : "check:respondido" };
}

/**
 * Texto (ou áudio transcrito) de quem tem um check esperando resposta: vale como a resposta da
 * pergunta da vez. null quando ninguém espera nada desta pessoa (a mensagem segue o caminho normal).
 */
export async function responderCheckPorTexto(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  texto: string,
): Promise<{ acao: string } | null> {
  const envio = await envioEsperando(tx, ctx.usuarioId);
  if (!envio?.aguardandoPerguntaId) return null;
  const k = await obraDoEnvio(tx, envio);
  if (envio.aguardandoFoto) {
    await dizer(tx, efeitos, ctx, k.obraId, 'Mande a foto, ou toque em "Sem foto" para seguir.');
    return { acao: "check:esperando_foto" };
  }
  const [p] = await tx.select().from(checkPergunta).where(eq(checkPergunta.id, envio.aguardandoPerguntaId));
  if (!p) return null;
  const [o] = await tx.select({ fuso: obra.fusoHorario }).from(obra).where(eq(obra.id, k.obraId));
  const valor = lerRespostaDoCheck(p, texto, hojeNoFuso(o?.fuso ?? "America/Sao_Paulo"));
  if (valor === null) {
    await dizer(tx, efeitos, ctx, k.obraId, DE_NOVO[p.tipoResposta]);
    return { acao: "check:resposta_invalida" };
  }
  return gravar(tx, efeitos, ctx, envio, p, valor);
}

/** Botão de uma pergunta do check: `chk:<envio>:<pergunta>:<s|n|oN|x>`. */
export async function tratarBotaoDoCheck(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  id: string,
): Promise<{ acao: string }> {
  const [, envioId = "", perguntaId = "", valor = ""] = id.split(":");
  const [envio] = await tx.select().from(checkEnvio).where(eq(checkEnvio.id, envioId)).for("update");
  const k = envio ? await obraDoEnvio(tx, envio) : null;
  if (!envio || k?.responsavelId !== ctx.usuarioId)
    throw new ErroDominio("nao_encontrado", "Não achei este check.");
  if (envio.respondidoEm) throw new ErroDominio("conflito", "Este check já foi respondido. Obrigado!");
  const [p] = await tx.select().from(checkPergunta).where(eq(checkPergunta.id, perguntaId));
  if (!p || !(envio.perguntaIds ?? []).includes(p.id))
    throw new ErroDominio("invalido", "Esta pergunta não é deste check.");
  const [jaTem] = await tx
    .select({ id: checkResposta.id })
    .from(checkResposta)
    .where(and(eq(checkResposta.envioId, envio.id), eq(checkResposta.perguntaId, p.id)));

  if (valor === "x") {
    // "Sem foto": só vale para a pergunta que está esperando a foto
    if (!jaTem || !envio.aguardandoFoto || envio.aguardandoPerguntaId !== p.id)
      throw new ErroDominio("conflito", "Esta pergunta não está esperando foto.");
    return avancar(tx, efeitos, ctx, envio);
  }
  if (jaTem) throw new ErroDominio("conflito", "Esta pergunta já foi respondida.");
  const resposta =
    valor === "s"
      ? "sim"
      : valor === "n"
        ? "nao"
        : valor.startsWith("o")
          ? p.opcoes[Number(valor.slice(1))]
          : undefined;
  if (resposta === undefined) throw new ErroDominio("invalido", "Não reconheci esta opção.");
  return gravar(tx, efeitos, ctx, envio, p, resposta);
}

/** Foto de quem tem uma pergunta esperando foto: liga a foto à resposta e segue. false se ninguém esperava. */
export async function anexarFotoAoCheck(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  midiaId: string,
): Promise<{ acao: string } | null> {
  const envio = await envioEsperando(tx, ctx.usuarioId);
  if (!envio?.aguardandoFoto || !envio.aguardandoPerguntaId) return null;
  await tx
    .update(checkResposta)
    .set({ midiaId })
    .where(
      and(eq(checkResposta.envioId, envio.id), eq(checkResposta.perguntaId, envio.aguardandoPerguntaId)),
    );
  return avancar(tx, efeitos, ctx, envio);
}
