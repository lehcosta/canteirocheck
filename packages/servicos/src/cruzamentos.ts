import {
  comNovaTentativa,
  espacosNormalizados,
  type Llm,
  llmPadrao,
  type MaterialCruzamento,
  type SaidaCruzamento,
  tarefaCruzamento,
  type UsoLlm,
  VERSAO_CRUZAMENTO,
} from "@canteirocheck/ai";
import {
  esperadaValida,
  MAXIMO_DA_OPCAO,
  MAXIMO_DE_OPCOES,
  MAXIMO_DE_PERGUNTAS,
  MAXIMO_DO_TEXTO_DA_PERGUNTA,
  MOMENTOS,
  type Momento,
  REGRA_PADRAO,
  type TipoResposta,
  unidadeDaMedida,
} from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import type { ExtracaoInterpretada } from "@canteirocheck/extracao";
import { idJob } from "@canteirocheck/queue";
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { type Contexto, ErroDominio, exigirPapel } from "./contexto";
import { registrarCusto } from "./ia";
import { emTransacao } from "./transacao";
import { uuid } from "./validacao";

const {
  cruzamento,
  riscoFase,
  checkFase,
  checkPergunta,
  checkEnvio,
  cronogramaVersao,
  cronogramaTarefa,
  projeto,
  extracaoProjeto,
  obra,
  obraMembro,
  usuario,
} = schema;

/**
 * Cruzamento do cronograma vigente com os projetos lidos: a IA aponta riscos por fase e sugere as
 * perguntas de check; o código confere cada citação antes de gravar. A IA sugere, o engenheiro
 * decide: check aprovado, editado ou já enviado não é tocado por um cruzamento novo.
 */

export const ERRO_SEM_IA = "A IA não está configurada neste ambiente.";
export const ERRO_SUBSTITUIDO = "Substituído por um cruzamento mais novo.";
const ERRO_SAIDA_INVALIDA = "A IA não devolveu uma análise válida. Tente cruzar de novo.";
const ERRO_SEM_PROJETO = "Não há projeto DWG lido para cruzar com o cronograma.";
/** O pedido automático espera um pouco: um lote de DWGs lidos em sequência vira um cruzamento só. */
export const ATRASO_DO_CRUZAMENTO_MS = 60_000;
/** Processando há mais que isso: o job que tomou o cruzamento caiu e outro pode tomar. */
const MINUTOS_PARA_RETOMAR = 15;

/** Retrato de um projeto usado no cruzamento (`cruzamento.projetos`). */
export interface ProjetoDoCruzamento {
  id: string;
  codigo: string;
  revisao: string;
  titulo: string;
  tipoArquivo: "dwg" | "pdf";
}

/** Uma obra por vez: pedir cruzamento e gravar o resultado não podem correr em paralelo. */
const travarObra = (tx: Tx, obraId: string) =>
  tx.execute(sql`select 1 from obra where id = ${obraId} for update`);

export const hojeNoFuso = (fuso: string, agora = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);

// ─────────────────────────── Fases do cronograma ───────────────────────────

export interface LinhaDoCronograma {
  ordem: number;
  uid: number;
  nome: string;
  nivel: number;
  marco: boolean;
  inicio: string | null;
  termino: string | null;
  percentual: number;
  /** uid das tarefas de que esta depende (vínculos do MS Project). */
  predecessoras: number[];
}

export interface FaseDaVersao extends LinhaDoCronograma {
  /** Nome da linha de nível 1 que contém a fase. */
  etapa: string | null;
  /** As linhas de nível 3 dentro da fase. */
  tarefas: LinhaDoCronograma[];
}

/** Fase = linha de nível 2 que não é marco, na ordem do arquivo. */
export async function linhasDaVersao(tx: Tx, versaoId: string) {
  const linhas: LinhaDoCronograma[] = await tx
    .select({
      ordem: cronogramaTarefa.ordem,
      uid: cronogramaTarefa.uid,
      nome: cronogramaTarefa.nome,
      nivel: cronogramaTarefa.nivel,
      marco: cronogramaTarefa.marco,
      inicio: cronogramaTarefa.inicio,
      termino: cronogramaTarefa.termino,
      percentual: cronogramaTarefa.percentual,
      predecessoras: cronogramaTarefa.predecessoras,
    })
    .from(cronogramaTarefa)
    .where(eq(cronogramaTarefa.versaoId, versaoId))
    .orderBy(asc(cronogramaTarefa.ordem));
  const fases: FaseDaVersao[] = [];
  let etapa: string | null = null;
  let atual: FaseDaVersao | null = null;
  for (const l of linhas) {
    if (l.nivel === 1) etapa = l.nome;
    if (l.nivel <= 2) atual = null;
    if (l.nivel === 2 && !l.marco) {
      atual = { ...l, etapa, tarefas: [] };
      fases.push(atual);
    } else if (l.nivel === 3 && atual) {
      atual.tarefas.push(l);
    }
  }
  return { linhas, fases };
}

/** O primeiro encarregado da equipe da obra (ordem de cadastro): o responsável padrão de um check novo. */
export async function primeiroEncarregado(tx: Tx, obraId: string): Promise<string | null> {
  const [u] = await tx
    .select({ id: usuario.id })
    .from(obraMembro)
    .innerJoin(usuario, eq(usuario.id, obraMembro.usuarioId))
    .where(and(eq(obraMembro.obraId, obraId), eq(obraMembro.papel, "encarregado"), eq(usuario.ativo, true)))
    .orderBy(asc(usuario.criadoEm), asc(usuario.id))
    .limit(1);
  return u?.id ?? null;
}

// ─────────────────────────── Pedido ───────────────────────────

/** Projetos vigentes já lidos: DWG com extração concluída e PDF (referência). Só os DWG vão para a IA. */
export async function projetosLidos(tx: Tx, obraId: string): Promise<ProjetoDoCruzamento[]> {
  const vigentes = await tx
    .select({
      id: projeto.id,
      codigo: projeto.codigo,
      revisao: projeto.revisao,
      titulo: projeto.titulo,
      tipoArquivo: projeto.tipoArquivo,
      statusExtracao: projeto.statusExtracao,
    })
    .from(projeto)
    .where(and(eq(projeto.obraId, obraId), isNull(projeto.substituidoPorId)))
    .orderBy(asc(projeto.codigo), asc(projeto.criadoEm));
  return vigentes
    .filter((p) =>
      p.tipoArquivo === "dwg" ? p.statusExtracao === "concluida" : p.statusExtracao === "nao_aplicavel",
    )
    .map(({ statusExtracao: _, ...p }) => p);
}

/**
 * No máximo um cruzamento pendente por obra: um pedido novo reaproveita o pendente (com a versão
 * vigente) e o mesmo jobId, então um lote de DWGs lidos em sequência vira um cruzamento só. O
 * retrato dos projetos é tirado quando o job começa.
 */
async function pedirCruzamento(
  tenantId: string,
  obraId: string,
  solicitadoPorId: string | null,
  imediato: boolean,
): Promise<{ id: string } | null> {
  return emTransacao(tenantId, async (tx, efeitos) => {
    await travarObra(tx, obraId);
    const [vigente] = await tx
      .select({ id: cronogramaVersao.id, numero: cronogramaVersao.numero })
      .from(cronogramaVersao)
      .where(and(eq(cronogramaVersao.obraId, obraId), eq(cronogramaVersao.vigente, true)));
    if (!vigente) return null;
    if (!(await projetosLidos(tx, obraId)).some((p) => p.tipoArquivo === "dwg")) return null;

    const [pendente] = await tx
      .select({ id: cruzamento.id, solicitadoPorId: cruzamento.solicitadoPorId })
      .from(cruzamento)
      .where(and(eq(cruzamento.obraId, obraId), eq(cruzamento.status, "pendente")))
      .orderBy(asc(cruzamento.criadoEm))
      .limit(1);
    let id: string;
    if (pendente) {
      id = pendente.id;
      await tx
        .update(cruzamento)
        .set({ cronogramaVersaoId: vigente.id, solicitadoPorId: solicitadoPorId ?? pendente.solicitadoPorId })
        .where(eq(cruzamento.id, id));
    } else {
      const [novo] = await tx
        .insert(cruzamento)
        .values({ tenantId, obraId, cronogramaVersaoId: vigente.id, solicitadoPorId })
        .returning({ id: cruzamento.id });
      if (!novo) throw new Error("falha ao criar o cruzamento");
      id = novo.id;
    }
    await registrarAuditoria(tx, {
      tenantId,
      ator: solicitadoPorId ? { tipo: "usuario", id: solicitadoPorId } : { tipo: "sistema", id: null },
      acao: "cruzamento.solicitado",
      entidade: "cruzamento",
      entidadeId: id,
      depois: { versao: vigente.numero, reaproveitado: Boolean(pendente) },
    });
    // O pedido do botão sai na hora; o job atrasado do mesmo cruzamento, quando chegar, é ignorado.
    efeitos.enfileirar(
      "cruzar_cronograma",
      { tenantId, cruzamentoId: id },
      imediato
        ? { jobId: idJob("cruz", id, "agora") }
        : { jobId: idJob("cruz", id), atrasoMs: ATRASO_DO_CRUZAMENTO_MS },
    );
    return { id };
  });
}

/**
 * Cria (ou reaproveita) o cruzamento pendente e enfileira `cruzar_cronograma` com atraso. null
 * quando não há cronograma vigente ou projeto DWG lido.
 */
export function solicitarCruzamento(
  tenantId: string,
  obraId: string,
  solicitadoPorId: string | null,
): Promise<{ id: string } | null> {
  return pedirCruzamento(tenantId, obraId, solicitadoPorId, false);
}

/** Painel: admin e engenheiro. Para o botão "Cruzar de novo" (sai sem atraso). */
export async function cruzarDeNovo(ctx: Contexto, obraId: string): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(obraId).success) throw new ErroDominio("invalido", "Obra inválida.");
  const [o] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ id: obra.id }).from(obra).where(eq(obra.id, obraId)),
  );
  if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
  const r = await pedirCruzamento(ctx.tenantId, obraId, ctx.usuarioId, true);
  if (!r)
    throw new ErroDominio(
      "conflito",
      "Para cruzar, a obra precisa de um cronograma vigente e de um projeto DWG já lido.",
    );
  return r;
}

// ─────────────────────────── Job ───────────────────────────

interface ProjetoNoMaterial extends ProjetoDoCruzamento {
  disciplina: string;
  textos: string[];
}

async function montarMaterial(tenantId: string, c: typeof cruzamento.$inferSelect) {
  return withTenant(tenantId, async (tx) => {
    const [o] = await tx.select({ fuso: obra.fusoHorario }).from(obra).where(eq(obra.id, c.obraId));
    const { linhas, fases } = await linhasDaVersao(tx, c.cronogramaVersaoId);
    const dwgs = (c.projetos as ProjetoDoCruzamento[]).filter((p) => p.tipoArquivo === "dwg");
    const lidos = dwgs.length
      ? await tx
          .select({ p: projeto, x: extracaoProjeto })
          .from(projeto)
          .innerJoin(extracaoProjeto, eq(extracaoProjeto.projetoId, projeto.id))
          .where(
            inArray(
              projeto.id,
              dwgs.map((p) => p.id),
            ),
          )
      : [];
    const projetos: ProjetoNoMaterial[] = lidos.map(({ p, x }) => {
      const notas = (x.carimbo as { notas?: ExtracaoInterpretada["notas"] }).notas ?? [];
      // Atributos de bloco (carimbo) não dizem nada da obra e custam tokens.
      const textos = (x.textos as ExtracaoInterpretada["textos"]).filter((t) => !t.tag);
      return {
        id: p.id,
        codigo: p.codigo,
        revisao: p.revisao,
        titulo: p.titulo,
        tipoArquivo: p.tipoArquivo,
        disciplina: p.disciplina,
        textos: [...new Set([...notas.map((n) => n.texto), ...textos.map((t) => t.texto)])].filter(
          (t) => t.trim().length > 0,
        ),
      };
    });
    const linhaDoUid = new Map(linhas.map((l) => [l.uid, l.ordem]));
    const dependeDe = (l: LinhaDoCronograma) =>
      l.predecessoras.map((uid) => linhaDoUid.get(uid)).filter((n): n is number => n !== undefined);
    const material: MaterialCruzamento = {
      hoje: hojeNoFuso(o?.fuso ?? "America/Sao_Paulo"),
      projetos: projetos.map(({ codigo, revisao, titulo, disciplina, textos }) => ({
        codigo,
        revisao,
        titulo,
        disciplina,
        textos,
      })),
      fases: fases.map((f) => ({
        uid: f.uid,
        nome: f.nome,
        etapa: f.etapa,
        linha: f.ordem,
        inicio: f.inicio,
        termino: f.termino,
        percentual: f.percentual,
        dependeDe: dependeDe(f),
        tarefas: f.tarefas.map((t) => ({
          linha: t.ordem,
          nome: t.nome,
          inicio: t.inicio,
          termino: t.termino,
          percentual: t.percentual,
          dependeDe: dependeDe(t),
        })),
      })),
    };
    return { material, projetos, fases, linhas: new Set(linhas.map((l) => l.ordem)), cronograma: linhas };
  });
}

const espacos = espacosNormalizados;
const semAcento = (t: string) => espacos(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MAXIMO_DO_TITULO = 160;
const MAXIMO_DA_CONSEQUENCIA = 300;

/** Corta na última palavra inteira que cabe, com "…" no fim (o total não passa de `maximo`). */
export function cortarNaPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  let cabe = "";
  for (const palavra of texto.split(" ")) {
    const proximo = cabe ? `${cabe} ${palavra}` : palavra;
    if (proximo.length + 1 > maximo) break;
    cabe = proximo;
  }
  return `${(cabe || texto.slice(0, maximo - 1)).replace(/[\s,;:.–-]+$/, "")}…`;
}

export interface PerguntaValidada {
  momento: Momento;
  texto: string;
  tipo: TipoResposta;
  opcoes: string[];
  esperada: string | null;
  pedeFoto: boolean;
}

export interface RiscoValidado {
  faseUid: number;
  nivel: "alto" | "medio" | "baixo";
  /** "sequencia": passagem entre tarefas, só do cronograma (sem projeto; o trecho é o nome da anterior). */
  tipo: "projeto" | "sequencia";
  titulo: string;
  projetoId: string | null;
  projetoTrecho: string;
  projetoReferencia: string | null;
  cronogramaOrdem: number | null;
  cronogramaTrecho: string;
  consequencia: string;
  perguntas: PerguntaValidada[];
}

/**
 * Regras determinísticas sobre a saída da IA. Descarta o risco cuja fase não é fase, cujo projeto
 * não está no material ou cujo trecho não aparece nos textos daquele projeto (anti-alucinação).
 * Descarta a pergunta vazia ou longa demais, com opções demais ou acima do limite do Flow, ou de
 * medida sem unidade. Título e consequência longos são cortados na última palavra inteira.
 *
 * Passagem entre tarefas: as duas linhas têm de existir, ser diferentes, a próxima tem de estar numa
 * fase, a anterior não pode estar pronta nem a próxima terminada, e precisa sobrar ao menos uma
 * pergunta. Os dois trechos são montados aqui, das linhas do cronograma, não pela IA.
 */
export function validarCruzamento(
  saida: SaidaCruzamento,
  m: {
    fases: { uid: number; ordem?: number; tarefas?: LinhaDoCronograma[] }[];
    projetos: { id: string; codigo: string; textos: string[] }[];
    linhas: Set<number>;
    /** Todas as linhas da versão; sem elas nenhuma passagem é aceita. */
    cronograma?: LinhaDoCronograma[];
  },
): { riscos: RiscoValidado[]; descartados: { titulo: string; motivo: string }[] } {
  const fases = new Set(m.fases.map((f) => f.uid));
  const projetos = new Map(m.projetos.map((p) => [p.codigo.trim(), p]));
  const riscos: RiscoValidado[] = [];
  const descartados: { titulo: string; motivo: string }[] = [];
  const validarPerguntas = (lista: SaidaCruzamento["riscos"][number]["perguntas"]) => {
    const perguntas: PerguntaValidada[] = [];
    for (const q of lista) {
      const texto = espacos(q.texto);
      const unidade = q.tipo === "medida" ? unidadeDaMedida(q.opcoes) : null;
      const opcoes = q.tipo === "opcao" ? q.opcoes.map(espacos).filter(Boolean) : unidade ? [unidade] : [];
      if (
        !texto ||
        texto.length > MAXIMO_DO_TEXTO_DA_PERGUNTA ||
        (q.tipo === "opcao" && (opcoes.length < 2 || opcoes.length > MAXIMO_DE_OPCOES)) ||
        (q.tipo === "medida" && !unidade) ||
        opcoes.some((o) => o.length > MAXIMO_DA_OPCAO)
      )
        continue;
      let esperada = q.tipo === "texto" ? null : q.esperada?.trim() || null;
      if (esperada && !esperadaValida(q.tipo, esperada)) esperada = null;
      if (esperada && q.tipo === "opcao" && !opcoes.some((o) => semAcento(o) === semAcento(esperada ?? "")))
        esperada = null;
      perguntas.push({ momento: q.momento, texto, tipo: q.tipo, opcoes, esperada, pedeFoto: q.pede_foto });
    }
    return perguntas;
  };
  for (const r of saida.riscos) {
    const codigo = r.projeto.trim();
    const p = projetos.get(codigo) ?? projetos.get(codigo.split(/\s+/)[0] ?? "");
    const trecho = espacos(r.projeto_trecho);
    let motivo: string | null = null;
    if (!fases.has(r.fase_uid)) motivo = "a fase não está no cronograma";
    else if (!p) motivo = "o projeto não está no material do cruzamento";
    else if (trecho.length < 3 || !p.textos.some((t) => espacos(t).includes(trecho)))
      motivo = "o trecho citado não aparece no projeto";
    if (motivo || !p) {
      descartados.push({ titulo: r.titulo, motivo: motivo ?? "" });
      continue;
    }
    const perguntas = validarPerguntas(r.perguntas);
    riscos.push({
      faseUid: r.fase_uid,
      nivel: r.nivel,
      tipo: "projeto",
      projetoReferencia: null,
      titulo: cortarNaPalavra(espacos(r.titulo), MAXIMO_DO_TITULO),
      projetoId: p.id,
      projetoTrecho: r.projeto_trecho.trim(),
      cronogramaOrdem:
        r.cronograma_linha !== null && m.linhas.has(r.cronograma_linha) ? r.cronograma_linha : null,
      cronogramaTrecho: espacos(r.cronograma_trecho),
      consequencia: cortarNaPalavra(espacos(r.consequencia), MAXIMO_DA_CONSEQUENCIA),
      perguntas,
    });
  }

  const porLinha = new Map((m.cronograma ?? []).map((l) => [l.ordem, l]));
  const faseDaLinha = new Map<number, number>();
  for (const f of m.fases) {
    if (f.ordem !== undefined) faseDaLinha.set(f.ordem, f.uid);
    for (const t of f.tarefas ?? []) faseDaLinha.set(t.ordem, f.uid);
  }
  const descreve = (l: LinhaDoCronograma) =>
    `${l.inicio ?? "sem início"} a ${l.termino ?? "sem término"} · ${l.percentual}%`;
  const vistas = new Set<string>();
  for (const p of saida.passagens ?? []) {
    const anterior = porLinha.get(p.anterior_linha);
    const proxima = porLinha.get(p.proxima_linha);
    const faseUid = faseDaLinha.get(p.proxima_linha);
    const perguntas = validarPerguntas(p.perguntas);
    let motivo: string | null = null;
    if (!anterior || !proxima || anterior.ordem === proxima.ordem)
      motivo = "as linhas da passagem não estão no cronograma";
    else if (faseUid === undefined) motivo = "a tarefa que vai começar não está numa fase";
    else if (anterior.percentual >= 100) motivo = "a tarefa anterior já está pronta";
    else if (proxima.percentual >= 100) motivo = "a tarefa seguinte já terminou";
    else if (vistas.has(`${anterior.ordem}>${proxima.ordem}`)) motivo = "passagem repetida";
    else if (perguntas.length === 0) motivo = "passagem sem pergunta válida";
    if (motivo || !anterior || !proxima || faseUid === undefined) {
      descartados.push({ titulo: p.titulo, motivo: motivo ?? "" });
      continue;
    }
    vistas.add(`${anterior.ordem}>${proxima.ordem}`);
    riscos.push({
      faseUid,
      nivel: p.nivel,
      tipo: "sequencia",
      titulo: cortarNaPalavra(espacos(p.titulo), MAXIMO_DO_TITULO),
      projetoId: null,
      projetoTrecho: anterior.nome,
      projetoReferencia: `linha ${anterior.ordem} · ${descreve(anterior)}`,
      cronogramaOrdem: proxima.ordem,
      cronogramaTrecho: `${proxima.nome} · ${descreve(proxima)}`,
      consequencia: cortarNaPalavra(espacos(p.consequencia), MAXIMO_DA_CONSEQUENCIA),
      perguntas,
    });
  }
  return { riscos, descartados };
}

/**
 * Mesmo risco entre cruzamentos: a mesma fase, o mesmo projeto e o mesmo trecho citado. Na passagem
 * entre tarefas, a mesma fase e a mesma tarefa anterior (pelo nome).
 */
const chaveDoRisco = (faseUid: number, projetoId: string | null, trecho: string, tipo = "projeto") =>
  `${faseUid}|${tipo === "sequencia" ? "sequencia" : projetoId}|${espacos(trecho)}`;

/**
 * Job `cruzar_cronograma`. Só um job por vez: ele TOMA o cruzamento (pendente, ou processando
 * parado há mais de 15 minutos) e só grava enquanto for o dono. Sem LLM configurado: `falhou`
 * com o motivo (sem retry). Erro de rede ou 5xx da IA: volta para `pendente` e o BullMQ tenta de
 * novo. Versão que deixou de ser a vigente, ou cruzamento mais novo já concluído: `falhou` como
 * substituído, sem gravar riscos.
 */
export async function processarCruzamento(
  tenantId: string,
  cruzamentoId: string,
  llm: Llm | null = llmPadrao(),
): Promise<{ status: "concluida" | "falhou" | "ignorada"; riscos?: number }> {
  if (!uuid.safeParse(cruzamentoId).success) return { status: "ignorada" };
  // ms, não now(): o dono é conferido por igualdade e o Date do JS não guarda microssegundos
  const inicio = new Date();
  const tomado = await withTenant(tenantId, async (tx) => {
    const [c] = await tx
      .update(cruzamento)
      .set({ status: "processando", iniciadoEm: inicio, erro: null })
      .where(
        and(
          eq(cruzamento.id, cruzamentoId),
          or(
            eq(cruzamento.status, "pendente"),
            and(
              eq(cruzamento.status, "processando"),
              lt(cruzamento.iniciadoEm, sql`now() - make_interval(mins => ${MINUTOS_PARA_RETOMAR})`),
            ),
          ),
        ),
      )
      .returning();
    if (!c) return null;
    const projetos = await projetosLidos(tx, c.obraId);
    await tx.update(cruzamento).set({ projetos }).where(eq(cruzamento.id, c.id));
    return { ...c, projetos };
  });
  if (!tomado) return { status: "ignorada" };
  const c = tomado;
  const doDono = and(
    eq(cruzamento.id, cruzamentoId),
    eq(cruzamento.status, "processando"),
    eq(cruzamento.iniciadoEm, inicio),
  );

  /** Marca a falha se ainda for o dono. O custo com a IA fica registrado de qualquer jeito: ele aconteceu. */
  const falharNa = async (tx: Tx, erro: string, usos: UsoLlm[] = [], detalhe?: string) => {
    await registrarCusto(tx, tenantId, c.obraId, usos, VERSAO_CRUZAMENTO);
    const [f] = await tx
      .update(cruzamento)
      .set({ status: "falhou", erro, concluidoEm: new Date() })
      .where(doDono)
      .returning({ id: cruzamento.id });
    if (!f) return { status: "ignorada" as const };
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "ia", id: null },
      acao: "cruzamento.falhou",
      entidade: "cruzamento",
      entidadeId: cruzamentoId,
      depois: { erro, detalhe: detalhe?.slice(0, 500) ?? null },
    });
    return { status: "falhou" as const };
  };
  const falhar = (erro: string, usos: UsoLlm[] = [], detalhe?: string) =>
    withTenant(tenantId, (tx) => falharNa(tx, erro, usos, detalhe));

  if (!llm) return falhar(ERRO_SEM_IA);
  if (!c.projetos.some((p) => p.tipoArquivo === "dwg")) return falhar(ERRO_SEM_PROJETO);

  const { material, projetos, fases, linhas, cronograma } = await montarMaterial(tenantId, c);
  let usos: UsoLlm[] = [];
  let saida: SaidaCruzamento = { riscos: [] };
  let geradoPor: string | null = null;
  // Sem fase ou sem texto de projeto não há o que cruzar: conclui sem gastar com a IA.
  if (material.fases.length > 0 && material.projetos.some((p) => p.textos.length > 0)) {
    let r: Awaited<ReturnType<typeof comNovaTentativa<SaidaCruzamento>>>;
    try {
      r = await comNovaTentativa(llm, tarefaCruzamento(material));
    } catch (e) {
      const desistiu = await withTenant(tenantId, async (tx) => {
        await travarObra(tx, c.obraId);
        // já há outro pendente na obra (pedido depois deste começar): ele cobre este
        const [outro] = await tx
          .select({ id: cruzamento.id })
          .from(cruzamento)
          .where(and(eq(cruzamento.obraId, c.obraId), eq(cruzamento.status, "pendente")))
          .limit(1);
        if (outro) return (await falharNa(tx, ERRO_SUBSTITUIDO)).status === "falhou";
        await tx.update(cruzamento).set({ status: "pendente", iniciadoEm: null }).where(doDono);
        return false;
      });
      if (desistiu) return { status: "falhou" };
      throw e;
    }
    usos = r.usos;
    if (!r.resultado.ok)
      return falhar(ERRO_SAIDA_INVALIDA, usos, `${r.resultado.motivo}: ${r.resultado.detalhe}`);
    saida = r.resultado.saida;
    geradoPor = `${usos.at(-1)?.modelo ?? llm.nome}@${VERSAO_CRUZAMENTO}`;
  }
  const { riscos, descartados } = validarCruzamento(saida, { fases, projetos, linhas, cronograma });

  return withTenant(tenantId, async (tx) => {
    await travarObra(tx, c.obraId);
    const [dono] = await tx.select({ id: cruzamento.id }).from(cruzamento).where(doDono).for("update");
    // Outro job tomou o cruzamento (este ficou parado demais): não grava nada.
    if (!dono) {
      await registrarCusto(tx, tenantId, c.obraId, usos, VERSAO_CRUZAMENTO);
      return { status: "ignorada" };
    }
    const [vigente] = await tx
      .select({ id: cronogramaVersao.id })
      .from(cronogramaVersao)
      .where(and(eq(cronogramaVersao.obraId, c.obraId), eq(cronogramaVersao.vigente, true)));
    const [maisNovo] = await tx
      .select({ id: cruzamento.id })
      .from(cruzamento)
      .where(
        and(
          eq(cruzamento.obraId, c.obraId),
          eq(cruzamento.status, "concluida"),
          sql`(${cruzamento.criadoEm}, ${cruzamento.id}) > (select criado_em, id from cruzamento where id = ${cruzamentoId})`,
        ),
      )
      .limit(1);
    if (vigente?.id !== c.cronogramaVersaoId || maisNovo) return falharNa(tx, ERRO_SUBSTITUIDO, usos);

    // Trava os checks da obra antes de decidir quais são intocáveis (salvar e aprovar travam o check).
    await tx.select({ id: checkFase.id }).from(checkFase).where(eq(checkFase.obraId, c.obraId)).for("update");

    const ordemNaFase = new Map<number, number>();
    const novos = new Map<string, string>();
    const sugeridas = new Map<string, (PerguntaValidada & { riscoId: string })[]>();
    for (const r of riscos) {
      const ordem = (ordemNaFase.get(r.faseUid) ?? 0) + 1;
      ordemNaFase.set(r.faseUid, ordem);
      const { perguntas, ...dados } = r;
      const [novo] = await tx
        .insert(riscoFase)
        .values({ tenantId, obraId: c.obraId, cruzamentoId, ordem, ...dados })
        .returning({ id: riscoFase.id });
      if (!novo) throw new Error("falha ao gravar o risco");
      const chave = chaveDoRisco(r.faseUid, r.projetoId, r.projetoTrecho, r.tipo);
      if (!novos.has(chave)) novos.set(chave, novo.id);
      for (const q of perguntas) {
        const k = `${r.faseUid}:${q.momento}`;
        sugeridas.set(k, [...(sugeridas.get(k) ?? []), { ...q, riscoId: novo.id }]);
      }
    }

    // Pergunta que fica (check aprovado, editado ou enviado) passa a apontar para o mesmo risco
    // na análise nova; sem par, fica sem etiqueta na tela.
    const ligadas = await tx
      .select({
        id: checkPergunta.id,
        faseUid: riscoFase.faseUid,
        projetoId: riscoFase.projetoId,
        trecho: riscoFase.projetoTrecho,
        tipo: riscoFase.tipo,
      })
      .from(checkPergunta)
      .innerJoin(riscoFase, eq(riscoFase.id, checkPergunta.riscoId))
      .where(and(eq(riscoFase.obraId, c.obraId), ne(riscoFase.cruzamentoId, cruzamentoId)));
    let reapontadas = 0;
    for (const p of ligadas) {
      const novo =
        p.projetoId || p.tipo === "sequencia"
          ? novos.get(chaveDoRisco(p.faseUid, p.projetoId, p.trecho, p.tipo))
          : undefined;
      if (!novo) continue;
      await tx.update(checkPergunta).set({ riscoId: novo }).where(eq(checkPergunta.id, p.id));
      reapontadas++;
    }

    // Toda fase ganha os três checks; o que já existe fica como está.
    const responsavelId = await primeiroEncarregado(tx, c.obraId);
    const uids = fases.map((f) => f.uid);
    if (uids.length) {
      await tx
        .insert(checkFase)
        .values(
          fases.flatMap((f) =>
            MOMENTOS.map((momento) => ({
              tenantId,
              obraId: c.obraId,
              faseUid: f.uid,
              momento,
              dias: REGRA_PADRAO[momento].dias,
              hora: REGRA_PADRAO[momento].hora,
              responsavelId,
            })),
          ),
        )
        .onConflictDoNothing();
    }
    const checks = uids.length
      ? await tx
          .select()
          .from(checkFase)
          .where(and(eq(checkFase.obraId, c.obraId), inArray(checkFase.faseUid, uids)))
      : [];
    const comEnvio = new Set(
      checks.length
        ? (
            await tx
              .selectDistinct({ id: checkEnvio.checkId })
              .from(checkEnvio)
              .where(
                inArray(
                  checkEnvio.checkId,
                  checks.map((k) => k.id),
                ),
              )
          ).map((e) => e.id)
        : [],
    );

    let perguntas = 0;
    let preservados = 0;
    for (const k of checks) {
      // aprovado, editado pelo engenheiro ou já enviado: é dele, o cruzamento não mexe
      if (k.aprovadoEm || k.editadoEm || comEnvio.has(k.id)) {
        preservados++;
        continue;
      }
      await tx
        .delete(checkPergunta)
        .where(and(eq(checkPergunta.checkId, k.id), eq(checkPergunta.origem, "ia")));
      const manuais = await tx
        .select({ id: checkPergunta.id })
        .from(checkPergunta)
        .where(and(eq(checkPergunta.checkId, k.id), isNull(checkPergunta.removidaEm)))
        .orderBy(asc(checkPergunta.ordem));
      // O envio leva no máximo MAXIMO_DE_PERGUNTAS, contando as que não são da IA.
      const novas = (sugeridas.get(`${k.faseUid}:${k.momento}`) ?? []).slice(
        0,
        Math.max(0, MAXIMO_DE_PERGUNTAS - manuais.length),
      );
      if (novas.length) {
        await tx.insert(checkPergunta).values(
          novas.map((q, i) => ({
            tenantId,
            checkId: k.id,
            ordem: i + 1,
            texto: q.texto,
            tipoResposta: q.tipo,
            opcoes: q.opcoes,
            esperada: q.esperada,
            pedeFoto: q.pedeFoto,
            riscoId: q.riscoId,
            origem: "ia" as const,
          })),
        );
      }
      for (const [i, m] of manuais.entries()) {
        await tx
          .update(checkPergunta)
          .set({ ordem: novas.length + i + 1 })
          .where(eq(checkPergunta.id, m.id));
      }
      perguntas += novas.length;
    }

    await tx
      .update(cruzamento)
      .set({ status: "concluida", erro: null, geradoPor, concluidoEm: new Date() })
      .where(eq(cruzamento.id, cruzamentoId));
    await registrarCusto(tx, tenantId, c.obraId, usos, VERSAO_CRUZAMENTO);
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "ia", id: null },
      acao: "cruzamento.concluido",
      entidade: "cruzamento",
      entidadeId: cruzamentoId,
      depois: {
        riscos: riscos.length,
        perguntas,
        checksPreservados: preservados,
        perguntasReapontadas: reapontadas,
        descartados,
        geradoPor,
      },
    });
    return { status: "concluida", riscos: riscos.length };
  });
}
