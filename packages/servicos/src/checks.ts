import {
  avaliarResposta,
  datasDoCheck,
  type EstadoCheck,
  esperadaValida,
  estadoDoCheck,
  MAXIMO_DA_OPCAO,
  MAXIMO_DE_OPCOES,
  MAXIMO_DE_PERGUNTAS,
  MAXIMO_DO_TEXTO_DA_PERGUNTA,
  MOMENTOS,
  type Momento,
  maiorNivel,
  proximaSaida,
  simOuNao,
  type TipoResposta,
  unidadeDaMedida,
} from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ator, type Contexto, ErroDeCampo, ErroDominio, exigirPapel } from "./contexto";
import {
  type FaseDaVersao,
  hojeNoFuso,
  linhasDaVersao,
  type ProjetoDoCruzamento,
  projetosLidos,
} from "./cruzamentos";
import { uuid } from "./validacao";

const {
  cruzamento,
  riscoFase,
  checkFase,
  checkPergunta,
  checkEnvio,
  checkResposta,
  cronogramaVersao,
  cronogramaTarefa,
  projeto,
  obra,
  obraMembro,
  usuario,
} = schema;

/**
 * Riscos por fase e checks no painel: o Gantt com as contas, a página da fase, a edição e a
 * aprovação das perguntas, e o registro de envio e resposta (para o Flow que ainda vai existir).
 */

type Nivel = "alto" | "medio" | "baixo";
type Entrega = "enviado" | "entregue" | "lido" | "falhou";

// ─────────────────────────── Consultas do painel ───────────────────────────

export interface CheckNoGantt {
  momento: Momento;
  estado: EstadoCheck;
  /** AAAA-MM-DD */
  saiEm: string | null;
  hora: string;
  perguntas: number;
  responsavel: string | null;
}

export interface FaseNoGantt {
  uid: number;
  nivel: Nivel | null;
  riscos: number;
  /** [antes, durante, depois]; [] enquanto nenhum cruzamento criou os checks da fase. */
  checks: CheckNoGantt[];
}

export interface RiscosDoCronograma {
  /** Há projeto com extração concluída. */
  temProjeto: boolean;
  /** O mais recente. */
  cruzamento: {
    id: string;
    status: "pendente" | "processando" | "concluida" | "falhou";
    erro: string | null;
    projetos: number;
    criadoEm: Date;
    concluidoEm: Date | null;
  } | null;
  /** O último cruzamento concluído, que é o que a tela mostra. */
  analise: { concluidoEm: Date; projetos: number; riscos: number; fases: number; perguntas: number } | null;
  /** Uma por fase do cronograma vigente, na ordem do arquivo. */
  fases: FaseNoGantt[];
}

export interface RiscoDaFase {
  id: string;
  /** "R1", "R2"… */
  codigo: string;
  nivel: Nivel;
  titulo: string;
  projeto: { id: string; codigo: string; revisao: string; titulo: string; tipoArquivo: "dwg" | "pdf" } | null;
  projetoTrecho: string;
  projetoReferencia: string | null;
  cronogramaLinha: number | null;
  cronogramaInicio: string | null;
  cronogramaTermino: string | null;
  cronogramaTrecho: string;
  consequencia: string;
  /** Pela última resposta das perguntas ligadas ao risco; null enquanto nenhuma foi respondida. */
  situacao: { tipo: "sem_alerta" | "em_aberto"; momento: Momento } | null;
}

export interface PerguntaDoCheck {
  id: string;
  ordem: number;
  texto: string;
  tipo: TipoResposta;
  opcoes: string[];
  esperada: string | null;
  pedeFoto: boolean;
  /** Códigos dos riscos ligados ("R1"). */
  riscos: string[];
}

export interface RespostaDoCheck {
  perguntaId: string;
  texto: string;
  valor: string;
  dentro: boolean | null;
  observacao: string | null;
  temFoto: boolean;
  riscos: string[];
}

export interface EnvioDoCheck {
  id: string;
  previstoPara: string;
  enviadoEm: Date | null;
  /** Do status da mensagem do WhatsApp, quando há mensagem. */
  entrega: Entrega | null;
  lidoEm: Date | null;
  respondidoEm: Date | null;
  respondidoPor: string | null;
  foraDoEsperado: number | null;
  /** Perguntas do envio: as respondidas, ou as da lista enquanto não há resposta. */
  total: number;
  respostas: RespostaDoCheck[];
}

export interface CheckDaFase {
  id: string;
  momento: Momento;
  estado: EstadoCheck;
  dias: number;
  hora: string;
  datas: string[];
  proxima: string | null;
  responsavel: { id: string; nome: string } | null;
  aprovadoPor: string | null;
  aprovadoEm: Date | null;
  perguntas: PerguntaDoCheck[];
  /** Do mais novo para o mais antigo. */
  envios: EnvioDoCheck[];
}

export interface FaseDoCronograma {
  uid: number;
  nome: string;
  etapa: string | null;
  inicio: string | null;
  termino: string | null;
  percentual: number;
  versaoNumero: number;
  /** Número da versão que o cruzamento em uso leu (a linha e as datas citadas são dela); null sem análise. */
  versaoCruzada: number | null;
  nivel: Nivel | null;
  riscos: RiscoDaFase[];
  /** [antes, durante, depois] */
  checks: CheckDaFase[];
  /** Encarregados da equipe da obra. */
  responsaveis: { id: string; nome: string; papel: string }[];
}

const codigoDoRisco = (ordem: number) => `R${ordem}`;

async function vigenteDaObra(tx: Tx, obraId: string) {
  const [v] = await tx
    .select({ id: cronogramaVersao.id, numero: cronogramaVersao.numero })
    .from(cronogramaVersao)
    .where(and(eq(cronogramaVersao.obraId, obraId), eq(cronogramaVersao.vigente, true)));
  return v ?? null;
}

async function ultimoConcluido(tx: Tx, obraId: string) {
  const [c] = await tx
    .select()
    .from(cruzamento)
    .where(and(eq(cruzamento.obraId, obraId), eq(cruzamento.status, "concluida")))
    // o pedido por último: um antigo que termine depois não toma o lugar da análise
    .orderBy(desc(cruzamento.criadoEm), desc(cruzamento.id))
    .limit(1);
  return c ?? null;
}

/** Contas de um check a partir da regra, das datas da fase e dos envios. */
function contas(
  k: { momento: Momento; dias: number; aprovadoEm: Date | null },
  fase: { inicio: string | null; termino: string | null },
  envios: {
    previstoPara: string;
    enviadoEm: Date | null;
    respondidoEm: Date | null;
    foraDoEsperado: number | null;
  }[],
  hoje: string,
) {
  const datas = datasDoCheck({ momento: k.momento, dias: k.dias }, fase);
  const estado = estadoDoCheck(
    {
      aprovado: k.aprovadoEm !== null,
      datas,
      envios: envios.map((e) => ({
        previstoPara: e.previstoPara,
        enviado: e.enviadoEm !== null,
        respondido: e.respondidoEm !== null,
        foraDoEsperado: e.foraDoEsperado,
      })),
    },
    hoje,
  );
  return { datas, estado, proxima: proximaSaida(datas, hoje) };
}

export async function obterRiscosDoCronograma(
  ctx: Contexto,
  obraId: string,
  hoje: string,
): Promise<RiscosDoCronograma> {
  if (!uuid.safeParse(obraId).success)
    return { temProjeto: false, cruzamento: null, analise: null, fases: [] };
  return withTenant(ctx.tenantId, async (tx) => {
    const [lido] = await tx
      .select({ id: projeto.id })
      .from(projeto)
      .where(
        and(
          eq(projeto.obraId, obraId),
          eq(projeto.tipoArquivo, "dwg"),
          eq(projeto.statusExtracao, "concluida"),
          isNull(projeto.substituidoPorId),
        ),
      )
      .limit(1);
    const [ultimo] = await tx
      .select()
      .from(cruzamento)
      .where(eq(cruzamento.obraId, obraId))
      .orderBy(desc(cruzamento.criadoEm))
      .limit(1);
    const concluido = await ultimoConcluido(tx, obraId);
    const vigente = await vigenteDaObra(tx, obraId);
    const fases = vigente ? (await linhasDaVersao(tx, vigente.id)).fases : [];

    const riscos = concluido
      ? await tx
          .select({ faseUid: riscoFase.faseUid, nivel: riscoFase.nivel })
          .from(riscoFase)
          .where(and(eq(riscoFase.cruzamentoId, concluido.id), isNull(riscoFase.descartadoEm)))
      : [];
    const checks = await tx
      .select({ k: checkFase, responsavel: usuario.nome })
      .from(checkFase)
      .leftJoin(usuario, eq(usuario.id, checkFase.responsavelId))
      .where(eq(checkFase.obraId, obraId));
    const ids = checks.map((c) => c.k.id);
    const contagem = new Map(
      ids.length
        ? (
            await tx
              .select({ checkId: checkPergunta.checkId, n: sql<number>`count(*)::int` })
              .from(checkPergunta)
              .where(and(inArray(checkPergunta.checkId, ids), isNull(checkPergunta.removidaEm)))
              .groupBy(checkPergunta.checkId)
          ).map((l) => [l.checkId, l.n])
        : [],
    );
    const envios = ids.length
      ? await tx.select().from(checkEnvio).where(inArray(checkEnvio.checkId, ids))
      : [];

    let perguntas = 0;
    const fasesNoGantt = fases.map((f): FaseNoGantt => {
      const daFase = riscos.filter((r) => r.faseUid === f.uid);
      const doGantt = MOMENTOS.flatMap((m) =>
        checks.filter((c) => c.k.faseUid === f.uid && c.k.momento === m),
      );
      return {
        uid: f.uid,
        nivel: maiorNivel(daFase.map((r) => r.nivel)),
        riscos: daFase.length,
        checks: doGantt.map(({ k, responsavel }) => {
          const n = contagem.get(k.id) ?? 0;
          perguntas += n;
          const { estado, proxima } = contas(
            k,
            f,
            envios.filter((e) => e.checkId === k.id),
            hoje,
          );
          return { momento: k.momento, estado, saiEm: proxima, hora: k.hora, perguntas: n, responsavel };
        }),
      };
    });

    return {
      temProjeto: Boolean(lido),
      cruzamento: ultimo
        ? {
            id: ultimo.id,
            // "nao_aplicavel" é do PDF de projeto; o cruzamento nunca recebe esse valor
            status: ultimo.status as NonNullable<RiscosDoCronograma["cruzamento"]>["status"],
            erro: ultimo.erro,
            // o retrato é tirado quando o job começa; até lá, os projetos lidos que ele vai usar
            projetos:
              ultimo.status === "pendente"
                ? (await projetosLidos(tx, obraId)).length
                : (ultimo.projetos as ProjetoDoCruzamento[]).length,
            criadoEm: ultimo.criadoEm,
            concluidoEm: ultimo.concluidoEm,
          }
        : null,
      analise: concluido
        ? {
            concluidoEm: concluido.concluidoEm ?? concluido.criadoEm,
            projetos: (concluido.projetos as ProjetoDoCruzamento[]).length,
            riscos: riscos.length,
            fases: new Set(riscos.map((r) => r.faseUid)).size,
            perguntas,
          }
        : null,
      fases: fasesNoGantt,
    };
  });
}

/** Situação de cada risco pela última resposta das perguntas ligadas a ele. */
function situacaoDoRisco(
  riscoId: string,
  perguntas: { id: string; riscoId: string | null }[],
  envios: { id: string; checkId: string; respondidoEm: Date | null }[],
  respostas: { envioId: string; perguntaId: string; dentroDoEsperado: boolean | null }[],
  momentoDoCheck: Map<string, Momento>,
): RiscoDaFase["situacao"] {
  const ligadas = new Set(perguntas.filter((p) => p.riscoId === riscoId).map((p) => p.id));
  let ultima: { em: Date; checkId: string; fora: boolean } | null = null;
  for (const e of envios) {
    if (!e.respondidoEm) continue;
    const rs = respostas.filter((r) => r.envioId === e.id && ligadas.has(r.perguntaId));
    if (rs.length === 0 || (ultima && ultima.em >= e.respondidoEm)) continue;
    ultima = { em: e.respondidoEm, checkId: e.checkId, fora: rs.some((r) => r.dentroDoEsperado === false) };
  }
  const momento = ultima && momentoDoCheck.get(ultima.checkId);
  return ultima && momento ? { tipo: ultima.fora ? "em_aberto" : "sem_alerta", momento } : null;
}

async function equipeDeEncarregados(tx: Tx, obraId: string) {
  return tx
    .select({ id: usuario.id, nome: usuario.nome, papel: obraMembro.papel })
    .from(obraMembro)
    .innerJoin(usuario, eq(usuario.id, obraMembro.usuarioId))
    .where(and(eq(obraMembro.obraId, obraId), eq(obraMembro.papel, "encarregado"), eq(usuario.ativo, true)))
    .orderBy(asc(usuario.criadoEm), asc(usuario.id));
}

export async function obterFase(
  ctx: Contexto,
  obraId: string,
  faseUid: number,
  hoje: string,
): Promise<FaseDoCronograma | null> {
  if (!uuid.safeParse(obraId).success || !Number.isSafeInteger(faseUid)) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const vigente = await vigenteDaObra(tx, obraId);
    if (!vigente) return null;
    const fase = (await linhasDaVersao(tx, vigente.id)).fases.find((f) => f.uid === faseUid);
    if (!fase) return null;

    const concluido = await ultimoConcluido(tx, obraId);
    const [cruzada] = concluido
      ? await tx
          .select({ numero: cronogramaVersao.numero })
          .from(cronogramaVersao)
          .where(eq(cronogramaVersao.id, concluido.cronogramaVersaoId))
      : [];
    const riscos = concluido
      ? await tx
          .select()
          .from(riscoFase)
          .where(
            and(
              eq(riscoFase.cruzamentoId, concluido.id),
              eq(riscoFase.faseUid, faseUid),
              isNull(riscoFase.descartadoEm),
            ),
          )
          .orderBy(asc(riscoFase.ordem))
      : [];
    const idsProjetos = [...new Set(riscos.flatMap((r) => (r.projetoId ? [r.projetoId] : [])))];
    const projetos = new Map(
      idsProjetos.length
        ? (
            await tx
              .select({
                id: projeto.id,
                codigo: projeto.codigo,
                revisao: projeto.revisao,
                titulo: projeto.titulo,
                tipoArquivo: projeto.tipoArquivo,
              })
              .from(projeto)
              .where(inArray(projeto.id, idsProjetos))
          ).map((p) => [p.id, p])
        : [],
    );
    // A linha citada é a da versão que foi cruzada.
    const ordensCitadas = [
      ...new Set(riscos.flatMap((r) => (r.cronogramaOrdem === null ? [] : [r.cronogramaOrdem]))),
    ];
    const citadas = new Map(
      concluido && ordensCitadas.length
        ? (
            await tx
              .select({
                ordem: cronogramaTarefa.ordem,
                inicio: cronogramaTarefa.inicio,
                termino: cronogramaTarefa.termino,
              })
              .from(cronogramaTarefa)
              .where(
                and(
                  eq(cronogramaTarefa.versaoId, concluido.cronogramaVersaoId),
                  inArray(cronogramaTarefa.ordem, ordensCitadas),
                ),
              )
          ).map((l) => [l.ordem, l])
        : [],
    );

    const checks = await tx
      .select()
      .from(checkFase)
      .where(and(eq(checkFase.obraId, obraId), eq(checkFase.faseUid, faseUid)));
    const idsChecks = checks.map((k) => k.id);
    const perguntas = idsChecks.length
      ? await tx
          .select()
          .from(checkPergunta)
          .where(inArray(checkPergunta.checkId, idsChecks))
          .orderBy(asc(checkPergunta.ordem), asc(checkPergunta.id))
      : [];
    const envios = idsChecks.length
      ? await tx
          .select()
          .from(checkEnvio)
          .where(inArray(checkEnvio.checkId, idsChecks))
          .orderBy(desc(checkEnvio.previstoPara))
      : [];
    const respostas = envios.length
      ? await tx
          .select()
          .from(checkResposta)
          .where(
            inArray(
              checkResposta.envioId,
              envios.map((e) => e.id),
            ),
          )
      : [];

    // Só os riscos da análise atual dão etiqueta: pergunta ligada a risco sem par nela fica sem.
    const codigos = new Map(riscos.map((r) => [r.id, codigoDoRisco(r.ordem)]));
    const riscosDa = (p: { riscoId: string | null }) => {
      const c = p.riscoId ? codigos.get(p.riscoId) : undefined;
      return c ? [c] : [];
    };

    const idsUsuarios = [
      ...new Set(
        [
          ...checks.flatMap((k) => [k.responsavelId, k.aprovadoPorId]),
          ...envios.map((e) => e.respondidoPorId),
        ].filter((id): id is string => id !== null),
      ),
    ];
    const nomes = new Map(
      idsUsuarios.length
        ? (
            await tx
              .select({ id: usuario.id, nome: usuario.nome })
              .from(usuario)
              .where(inArray(usuario.id, idsUsuarios))
          ).map((u) => [u.id, u.nome])
        : [],
    );
    const nomeDe = (id: string | null) => (id ? (nomes.get(id) ?? null) : null);
    const momentoDoCheck = new Map(checks.map((k) => [k.id, k.momento]));
    const porPergunta = new Map(perguntas.map((p) => [p.id, p]));

    const riscosDaFase: RiscoDaFase[] = riscos.map((r) => {
      const p = r.projetoId ? projetos.get(r.projetoId) : undefined;
      const linha = r.cronogramaOrdem === null ? undefined : citadas.get(r.cronogramaOrdem);
      return {
        id: r.id,
        codigo: codigoDoRisco(r.ordem),
        nivel: r.nivel,
        titulo: r.titulo,
        projeto: p ?? null,
        projetoTrecho: r.projetoTrecho,
        projetoReferencia: r.projetoReferencia,
        cronogramaLinha: r.cronogramaOrdem,
        cronogramaInicio: linha?.inicio ?? null,
        cronogramaTermino: linha?.termino ?? null,
        cronogramaTrecho: r.cronogramaTrecho,
        consequencia: r.consequencia,
        situacao: situacaoDoRisco(r.id, perguntas, envios, respostas, momentoDoCheck),
      };
    });

    const checksDaFase = MOMENTOS.flatMap((m) => checks.filter((k) => k.momento === m)).map(
      (k): CheckDaFase => {
        const ativas = perguntas.filter((p) => p.checkId === k.id && p.removidaEm === null);
        const doCheck = envios.filter((e) => e.checkId === k.id);
        const { datas, estado, proxima } = contas(k, fase, doCheck, hoje);
        const responsavel = nomeDe(k.responsavelId);
        return {
          id: k.id,
          momento: k.momento,
          estado,
          dias: k.dias,
          hora: k.hora,
          datas,
          proxima,
          responsavel: k.responsavelId && responsavel ? { id: k.responsavelId, nome: responsavel } : null,
          aprovadoPor: nomeDe(k.aprovadoPorId),
          aprovadoEm: k.aprovadoEm,
          perguntas: ativas.map((p) => ({
            id: p.id,
            ordem: p.ordem,
            texto: p.texto,
            tipo: p.tipoResposta,
            opcoes: p.opcoes,
            esperada: p.esperada,
            pedeFoto: p.pedeFoto,
            riscos: riscosDa(p),
          })),
          envios: doCheck.map((e) => {
            const rs = respostas
              .filter((r) => r.envioId === e.id)
              .flatMap((r) => {
                const p = porPergunta.get(r.perguntaId);
                return p ? [{ r, p }] : [];
              })
              .sort((a, b) => a.p.ordem - b.p.ordem);
            return {
              id: e.id,
              previstoPara: e.previstoPara,
              enviadoEm: e.enviadoEm,
              entrega: e.entrega as Entrega | null,
              lidoEm: e.lidoEm,
              respondidoEm: e.respondidoEm,
              respondidoPor: nomeDe(e.respondidoPorId),
              foraDoEsperado: e.foraDoEsperado,
              total: e.respondidoEm ? rs.length : ativas.length,
              respostas: rs.map(({ r, p }) => ({
                perguntaId: p.id,
                texto: p.texto,
                valor: r.valor,
                dentro: r.dentroDoEsperado,
                observacao: r.observacao,
                temFoto: r.midiaId !== null,
                riscos: riscosDa(p),
              })),
            };
          }),
        };
      },
    );

    return {
      uid: fase.uid,
      nome: fase.nome,
      etapa: fase.etapa,
      inicio: fase.inicio,
      termino: fase.termino,
      percentual: fase.percentual,
      versaoNumero: vigente.numero ?? 0,
      versaoCruzada: cruzada?.numero ?? null,
      nivel: maiorNivel(riscosDaFase.map((r) => r.nivel)),
      riscos: riscosDaFase,
      checks: checksDaFase,
      responsaveis: await equipeDeEncarregados(tx, obraId),
    };
  });
}

// ─────────────────────────── Ações do painel ───────────────────────────

export interface EntradaCheck {
  dias: number;
  hora: string;
  responsavelId: string | null;
  perguntas: {
    id?: string;
    texto: string;
    tipo: TipoResposta;
    opcoes: string[];
    esperada: string | null;
    pedeFoto: boolean;
  }[];
}

const PAPEIS = ["admin", "engenheiro"] as const;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIPOS: readonly TipoResposta[] = ["sim_nao", "opcao", "data", "medida", "texto"];
const MENSAGEM_ESPERADA: Record<TipoResposta, string> = {
  sim_nao: "A resposta esperada é Sim ou Não.",
  opcao: "A resposta esperada precisa ser uma das opções.",
  data: 'Use "<=AAAA-MM-DD" (até o dia) ou ">=AAAA-MM-DD" (a partir do dia).',
  medida: 'Use o intervalo "mínimo..máximo" com ponto decimal, ex.: 5.995..6.005.',
  texto: "",
};

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

interface PerguntaEntrada {
  id: string | undefined;
  texto: string;
  tipo: TipoResposta;
  opcoes: string[];
  esperada: string | null;
  pedeFoto: boolean;
}

function validarEntrada(momento: Momento, e: EntradaCheck): PerguntaEntrada[] {
  if (!Number.isInteger(e.dias)) throw new ErroDeCampo("dias", "Informe quando o check sai.");
  if (momento === "durante" ? e.dias < 1 || e.dias > 7 : e.dias < 0 || e.dias > 60)
    throw new ErroDeCampo("dias", momento === "durante" ? "Escolha o dia da semana." : "Use de 0 a 60 dias.");
  if (!HORA.test(e.hora ?? "")) throw new ErroDeCampo("hora", "Use a hora no formato HH:MM, ex.: 07:00.");
  const lista = Array.isArray(e.perguntas) ? e.perguntas : [];
  if (lista.length > MAXIMO_DE_PERGUNTAS)
    throw new ErroDeCampo(
      "perguntas",
      `No máximo ${MAXIMO_DE_PERGUNTAS} perguntas: é o que cabe num envio do WhatsApp.`,
    );
  const vistas = new Set<string>();
  return lista.map((p, i) => {
    const campo = (c: string) => `perguntas.${i}.${c}`;
    const texto = (p.texto ?? "").replace(/\s+/g, " ").trim();
    if (!texto) throw new ErroDeCampo(campo("texto"), "Escreva a pergunta ou tire-a da lista.");
    if (texto.length > MAXIMO_DO_TEXTO_DA_PERGUNTA)
      throw new ErroDeCampo(
        campo("texto"),
        `A pergunta pode ter até ${MAXIMO_DO_TEXTO_DA_PERGUNTA} caracteres.`,
      );
    if (!TIPOS.includes(p.tipo)) throw new ErroDeCampo(campo("tipo"), "Escolha o tipo de resposta.");
    const opcoes: string[] = [];
    if (p.tipo === "opcao") {
      for (const [j, bruta] of (p.opcoes ?? []).entries()) {
        const o = bruta.replace(/\s+/g, " ").trim();
        if (o.length > MAXIMO_DA_OPCAO)
          throw new ErroDeCampo(
            campo(`opcoes.${j}`),
            `Cada opção pode ter até ${MAXIMO_DA_OPCAO} caracteres.`,
          );
        if (o) opcoes.push(o);
      }
      if (opcoes.length < 2) throw new ErroDeCampo(campo("opcoes"), "Dê pelo menos duas opções.");
      if (opcoes.length > MAXIMO_DE_OPCOES)
        throw new ErroDeCampo(campo("opcoes"), `No máximo ${MAXIMO_DE_OPCOES} opções.`);
    } else if (p.tipo === "medida") {
      const unidade = unidadeDaMedida(p.opcoes ?? []);
      if (!unidade) throw new ErroDeCampo(campo("opcoes"), "Escolha a unidade da medida: m, cm ou mm.");
      opcoes.push(unidade);
    }
    const esperada = p.tipo === "texto" ? null : p.esperada?.trim() || null;
    if (
      esperada &&
      (!esperadaValida(p.tipo, esperada) ||
        (p.tipo === "opcao" && !opcoes.some((o) => semAcento(o) === semAcento(esperada))))
    )
      throw new ErroDeCampo(campo("esperada"), MENSAGEM_ESPERADA[p.tipo]);
    if (p.id !== undefined) {
      if (vistas.has(p.id)) throw new ErroDeCampo(campo("id"), "A pergunta aparece duas vezes na lista.");
      vistas.add(p.id);
    }
    return { id: p.id, texto, tipo: p.tipo, opcoes, esperada, pedeFoto: Boolean(p.pedeFoto) };
  });
}

async function travarCheck(tx: Tx, checkId: string) {
  if (!uuid.safeParse(checkId).success) throw new ErroDominio("invalido", "Check inválido.");
  const [k] = await tx.select().from(checkFase).where(eq(checkFase.id, checkId)).for("update");
  if (!k) throw new ErroDominio("nao_encontrado", "Check não encontrado.");
  return k;
}

async function jaSaiu(tx: Tx, checkId: string): Promise<boolean> {
  const [e] = await tx
    .select({ id: checkEnvio.id })
    .from(checkEnvio)
    .where(and(eq(checkEnvio.checkId, checkId), isNotNull(checkEnvio.enviadoEm)))
    .limit(1);
  return Boolean(e);
}

async function ehEncarregadoDaObra(tx: Tx, obraId: string, usuarioId: string): Promise<boolean> {
  if (!uuid.safeParse(usuarioId).success) return false;
  return (await equipeDeEncarregados(tx, obraId)).some((u) => u.id === usuarioId);
}

/** A fase do check no cronograma vigente (as datas da regra vêm dela). */
async function faseDoCheck(tx: Tx, k: { obraId: string; faseUid: number }): Promise<FaseDaVersao | null> {
  const vigente = await vigenteDaObra(tx, k.obraId);
  if (!vigente) return null;
  return (await linhasDaVersao(tx, vigente.id)).fases.find((f) => f.uid === k.faseUid) ?? null;
}

const mesmaPergunta = (
  a: {
    texto: string;
    tipoResposta: TipoResposta;
    opcoes: string[];
    esperada: string | null;
    pedeFoto: boolean;
  },
  b: PerguntaEntrada,
) =>
  a.texto === b.texto &&
  a.tipoResposta === b.tipo &&
  JSON.stringify(a.opcoes) === JSON.stringify(b.opcoes) &&
  a.esperada === b.esperada &&
  a.pedeFoto === b.pedeFoto;

/**
 * Salva quando o check sai, quem responde e as perguntas, na ordem da lista. O check passa a ser do
 * engenheiro (`editado_em`): um cruzamento novo não troca mais as perguntas dele. Pergunta que saiu
 * da lista é apagada, ou só sai da lista se já tem resposta ou se o check já foi enviado; editada
 * nesses casos, a antiga sai da lista e entra uma nova, para a resposta continuar ligada ao que foi
 * perguntado. Editar um check aprovado que ainda não saiu tira a aprovação.
 */
export async function salvarCheck(ctx: Contexto, checkId: string, entrada: EntradaCheck): Promise<void> {
  exigirPapel(ctx, PAPEIS);
  await withTenant(ctx.tenantId, async (tx) => {
    const k = await travarCheck(tx, checkId);
    const lista = validarEntrada(k.momento, entrada);
    const responsavelId = entrada.responsavelId || null;
    if (responsavelId && !(await ehEncarregadoDaObra(tx, k.obraId, responsavelId)))
      throw new ErroDeCampo("responsavelId", "Escolha um encarregado da equipe da obra.");

    const atuais = await tx
      .select()
      .from(checkPergunta)
      .where(and(eq(checkPergunta.checkId, k.id), isNull(checkPergunta.removidaEm)));
    const porId = new Map(atuais.map((p) => [p.id, p]));
    // As perguntas são lidas depois de travar o check: um cruzamento ou outra edição pode ter
    // trocado a lista desde que a tela abriu.
    if (lista.some((p) => p.id !== undefined && !porId.has(p.id)))
      throw new ErroDominio(
        "conflito",
        "As perguntas deste check mudaram. Recarregue a página e edite de novo.",
      );
    const enviado = await jaSaiu(tx, k.id);
    // Com envio na rua, toda pergunta da lista já foi para a obra: tirar ou editar preserva a antiga.
    const respondidas = new Set(
      enviado
        ? atuais.map((p) => p.id)
        : atuais.length
          ? (
              await tx
                .selectDistinct({ id: checkResposta.perguntaId })
                .from(checkResposta)
                .where(
                  inArray(
                    checkResposta.perguntaId,
                    atuais.map((p) => p.id),
                  ),
                )
            ).map((r) => r.id)
          : [],
    );
    const agora = new Date();
    const tirar = async (id: string) => {
      if (respondidas.has(id)) {
        await tx.update(checkPergunta).set({ removidaEm: agora }).where(eq(checkPergunta.id, id));
      } else {
        await tx.delete(checkPergunta).where(eq(checkPergunta.id, id));
      }
    };

    const ficam = new Set(lista.flatMap((p) => (p.id ? [p.id] : [])));
    for (const p of atuais) if (!ficam.has(p.id)) await tirar(p.id);
    for (const [i, p] of lista.entries()) {
      const conteudo = {
        ordem: i + 1,
        texto: p.texto,
        tipoResposta: p.tipo,
        opcoes: p.opcoes,
        esperada: p.esperada,
        pedeFoto: p.pedeFoto,
      };
      const atual = p.id ? porId.get(p.id) : undefined;
      if (atual && mesmaPergunta(atual, p)) {
        await tx
          .update(checkPergunta)
          .set({ ordem: i + 1 })
          .where(eq(checkPergunta.id, atual.id));
      } else if (atual && !respondidas.has(atual.id)) {
        await tx
          .update(checkPergunta)
          .set({ ...conteudo, origem: "manual" })
          .where(eq(checkPergunta.id, atual.id));
      } else {
        if (atual) await tirar(atual.id);
        await tx.insert(checkPergunta).values({
          tenantId: ctx.tenantId,
          checkId: k.id,
          ...conteudo,
          riscoId: atual?.riscoId ?? null,
          origem: "manual",
        });
      }
    }

    const tirarAprovacao = k.aprovadoEm !== null && !enviado;
    await tx
      .update(checkFase)
      .set({
        dias: entrada.dias,
        hora: entrada.hora,
        responsavelId,
        editadoEm: agora,
        ...(tirarAprovacao ? { aprovadoPorId: null, aprovadoEm: null } : {}),
      })
      .where(eq(checkFase.id, k.id));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "check.salvo",
      entidade: "check_fase",
      entidadeId: k.id,
      antes: {
        dias: k.dias,
        hora: k.hora,
        responsavelId: k.responsavelId,
        aprovado: k.aprovadoEm !== null,
        perguntas: atuais.map((p) => p.texto),
      },
      depois: {
        dias: entrada.dias,
        hora: entrada.hora,
        responsavelId,
        aprovado: k.aprovadoEm !== null && !tirarAprovacao,
        perguntas: lista.map((p) => p.texto),
      },
    });
  });
}

/** Aprova o check para sair na próxima data da regra. Devolve essa data. */
export async function aprovarCheck(ctx: Contexto, checkId: string): Promise<{ saiEm: string | null }> {
  exigirPapel(ctx, PAPEIS);
  return withTenant(ctx.tenantId, async (tx) => {
    const k = await travarCheck(tx, checkId);
    if (k.aprovadoEm) throw new ErroDominio("conflito", "Este check já está aprovado.");
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(checkPergunta)
      .where(and(eq(checkPergunta.checkId, k.id), isNull(checkPergunta.removidaEm)));
    if (n === 0) throw new ErroDominio("invalido", "Ponha pelo menos uma pergunta antes de aprovar.");
    if (!k.responsavelId)
      throw new ErroDominio("invalido", "Escolha quem responde na obra antes de aprovar.");
    if (!(await ehEncarregadoDaObra(tx, k.obraId, k.responsavelId)))
      throw new ErroDominio("invalido", "Quem responde precisa ser um encarregado da equipe da obra.");
    const fase = await faseDoCheck(tx, k);
    const datas = fase ? datasDoCheck({ momento: k.momento, dias: k.dias }, fase) : [];
    if (datas.length === 0)
      throw new ErroDominio("invalido", "A fase não tem no cronograma a data de que este check precisa.");
    const [o] = await tx.select({ fuso: obra.fusoHorario }).from(obra).where(eq(obra.id, k.obraId));
    const saiEm = proximaSaida(datas, hojeNoFuso(o?.fuso ?? "America/Sao_Paulo"));
    await tx
      .update(checkFase)
      .set({ aprovadoPorId: ctx.usuarioId, aprovadoEm: new Date() })
      .where(eq(checkFase.id, k.id));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "check.aprovado",
      entidade: "check_fase",
      entidadeId: k.id,
      depois: { faseUid: k.faseUid, momento: k.momento, perguntas: n, saiEm },
    });
    return { saiEm };
  });
}

/** Só enquanto o check não saiu para a obra. */
export async function desfazerAprovacaoDoCheck(ctx: Contexto, checkId: string): Promise<void> {
  exigirPapel(ctx, PAPEIS);
  await withTenant(ctx.tenantId, async (tx) => {
    const k = await travarCheck(tx, checkId);
    if (!k.aprovadoEm) throw new ErroDominio("conflito", "Este check não está aprovado.");
    if (await jaSaiu(tx, k.id))
      throw new ErroDominio(
        "conflito",
        "Este check já saiu para a obra: a aprovação não pode mais ser desfeita.",
      );
    await tx.update(checkFase).set({ aprovadoPorId: null, aprovadoEm: null }).where(eq(checkFase.id, k.id));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "check.aprovacao_desfeita",
      entidade: "check_fase",
      entidadeId: k.id,
      antes: { aprovadoPorId: k.aprovadoPorId, aprovadoEm: k.aprovadoEm },
    });
  });
}

// ─────────────────────────── Envio e resposta ───────────────────────────

/** Registra (ou atualiza) a saída do check numa data. Só check aprovado sai. */
export async function registrarEnvioDoCheck(
  tenantId: string,
  checkId: string,
  e: {
    previstoPara: string;
    enviadoEm: Date;
    mensagemId?: string | null;
    entrega?: Entrega;
    lidoEm?: Date | null;
  },
): Promise<{ id: string }> {
  return withTenant(tenantId, async (tx) => {
    const k = await travarCheck(tx, checkId);
    if (!k.aprovadoEm) throw new ErroDominio("conflito", "Só check aprovado sai para a obra.");
    const valores = {
      enviadoEm: e.enviadoEm,
      mensagemId: e.mensagemId ?? null,
      entrega: e.entrega ?? "enviado",
      lidoEm: e.lidoEm ?? null,
    };
    const [envio] = await tx
      .insert(checkEnvio)
      .values({ tenantId, checkId: k.id, previstoPara: e.previstoPara, ...valores })
      .onConflictDoUpdate({ target: [checkEnvio.checkId, checkEnvio.previstoPara], set: valores })
      .returning({ id: checkEnvio.id });
    if (!envio) throw new Error("falha ao registrar o envio");
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "sistema", id: null },
      acao: "check.enviado",
      entidade: "check_envio",
      entidadeId: envio.id,
      depois: { checkId: k.id, previstoPara: e.previstoPara, entrega: valores.entrega },
    });
    return { id: envio.id };
  });
}

/**
 * Grava as respostas, compara cada uma com a esperada (código, nunca IA) e conta as de fora.
 * Sim ou não fica gravado como "sim" / "nao".
 */
export async function registrarRespostasDoCheck(
  tenantId: string,
  envioId: string,
  r: {
    respondidoPorId: string;
    respondidoEm: Date;
    respostas: { perguntaId: string; valor: string; observacao?: string | null; midiaId?: string | null }[];
  },
): Promise<{ foraDoEsperado: number }> {
  if (!uuid.safeParse(envioId).success) throw new ErroDominio("invalido", "Envio inválido.");
  return withTenant(tenantId, async (tx) => {
    const [envio] = await tx.select().from(checkEnvio).where(eq(checkEnvio.id, envioId)).for("update");
    if (!envio) throw new ErroDominio("nao_encontrado", "Envio não encontrado.");
    if (!envio.enviadoEm) throw new ErroDominio("conflito", "Este check ainda não saiu para a obra.");
    if (envio.respondidoEm) throw new ErroDominio("conflito", "Este envio já foi respondido.");
    const perguntas = new Map(
      (await tx.select().from(checkPergunta).where(eq(checkPergunta.checkId, envio.checkId))).map((p) => [
        p.id,
        p,
      ]),
    );
    let fora = 0;
    for (const resposta of r.respostas) {
      const p = perguntas.get(resposta.perguntaId);
      if (!p) throw new ErroDominio("invalido", "Resposta para uma pergunta que não é deste check.");
      // pergunta tirada da lista depois do envio ainda pode ser respondida; antes dele, não
      if (p.removidaEm && p.removidaEm <= envio.enviadoEm)
        throw new ErroDominio("invalido", "Resposta para uma pergunta que não estava no envio.");
      const bruto = resposta.valor.trim();
      const valor = p.tipoResposta === "sim_nao" ? (simOuNao(bruto) ?? bruto) : bruto;
      const dentro = avaliarResposta({ tipo: p.tipoResposta, esperada: p.esperada }, valor);
      if (dentro === false) fora++;
      await tx.insert(checkResposta).values({
        tenantId,
        envioId,
        perguntaId: p.id,
        valor,
        dentroDoEsperado: dentro,
        observacao: resposta.observacao?.trim() || null,
        midiaId: resposta.midiaId ?? null,
      });
    }
    await tx
      .update(checkEnvio)
      .set({ respondidoEm: r.respondidoEm, respondidoPorId: r.respondidoPorId, foraDoEsperado: fora })
      .where(eq(checkEnvio.id, envioId));
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "usuario", id: r.respondidoPorId },
      acao: "check.respondido",
      entidade: "check_envio",
      entidadeId: envioId,
      depois: { respostas: r.respostas.length, foraDoEsperado: fora },
    });
    return { foraDoEsperado: fora };
  });
}
