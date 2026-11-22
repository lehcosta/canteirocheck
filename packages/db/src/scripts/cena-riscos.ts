/**
 * Cenas da tela de riscos por fase na obra "Edifício Teste" do banco local (a do seed). Apaga o
 * cronograma, os projetos, os cruzamentos, os riscos, os checks, os envios e as respostas DESSA
 * obra e grava a cena pedida. Idempotente. O texto vem das telas aprovadas (estudo A).
 *
 *   pnpm --filter @canteirocheck/db cena-riscos <cena> [--hoje AAAA-MM-DD]
 *
 * Datas de aprovação, envio e resposta da fase "Pavimentos tipo 1 a 4" são relativas a `--hoje`
 * (com o padrão de cada cena, saem iguais às telas); o resto do histórico é fixo.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, like } from "drizzle-orm";
import { comDono, type DbDono } from "../plataforma";
import * as schema from "../schema";
import { SEED } from "../seed-dados";

type Tx = Parameters<Parameters<DbDono["transaction"]>[0]>[0];
type Momento = "antes" | "durante" | "depois";
type Tipo = "sim_nao" | "opcao" | "data" | "medida" | "texto";

const CENAS = {
  feliz: "2026-11-18",
  "sem-projeto": "2026-11-18",
  cruzando: "2026-11-18",
  "fase-sem-data": "2026-11-18",
  agendado: "2026-11-18",
  "na-obra": "2026-11-20",
  respondido: "2026-11-20",
  "com-alerta": "2026-11-20",
  "durante-com-historico": "2026-12-14",
} as const;
type Cena = keyof typeof CENAS;

// ─────────────────────────── Argumentos ───────────────────────────

const args = process.argv.slice(2);
const cena = args.find((a) => !a.startsWith("--")) as Cena | undefined;
const iHoje = args.indexOf("--hoje");
if (!cena || !(cena in CENAS)) {
  console.error(`Uso: cena-riscos.ts <cena> [--hoje AAAA-MM-DD]\nCenas: ${Object.keys(CENAS).join(", ")}`);
  process.exit(1);
}
const HOJE = iHoje >= 0 ? (args[iHoje + 1] ?? "") : CENAS[cena];
if (!/^\d{4}-\d{2}-\d{2}$/.test(HOJE)) {
  console.error("--hoje precisa ser AAAA-MM-DD");
  process.exit(1);
}
const url = process.env.DATABASE_URL_MIGRATOR;
if (!url || !["localhost", "127.0.0.1", "postgres"].includes(new URL(url).hostname)) {
  console.error("Recusando gravar cena fora do banco local (DATABASE_URL_MIGRATOR).");
  process.exit(1);
}

// ─────────────────────────── Datas ───────────────────────────

const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const somarDias = (data: string, n: number) => iso(ms(data) + n * DIA);
const diaDaSemana = (data: string) => new Date(ms(data)).getUTCDay() || 7;
/** Horário de parede da obra (São Paulo, sem horário de verão). */
const em = (data: string, hora: string) =>
  new Date(`${data}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`);
const relativo = (dias: number, hora: string) => em(somarDias(HOJE, dias), hora);

/** As mesmas regras de packages/core/src/check.ts (o pacote db não depende do core). */
function datasDoCheck(
  momento: Momento,
  dias: number,
  inicio: string | null,
  termino: string | null,
): string[] {
  if (momento === "antes") return inicio ? [somarDias(inicio, -dias)] : [];
  if (momento === "depois") {
    if (!termino) return [];
    let d = termino;
    for (let faltam = dias; faltam > 0; ) {
      d = somarDias(d, 1);
      if (diaDaSemana(d) <= 5) faltam--;
    }
    return [d];
  }
  if (!inicio || !termino) return [];
  const datas: string[] = [];
  for (let d = somarDias(inicio, 1); d <= termino; d = somarDias(d, 1))
    if (diaDaSemana(d) === dias) datas.push(d);
  return datas;
}

const falso = (texto: string) => createHash("sha256").update(`cena-riscos:${texto}`).digest("hex");

// ─────────────────────────── Cronograma ───────────────────────────

const VERSOES = [
  {
    numero: 1,
    arquivo: "Cronograma_EdTeste_rev01.xml",
    tarefas: 131,
    termino: "2027-05-28",
    em: em("2026-11-17", "17:19:01"),
  },
  {
    numero: 2,
    arquivo: "Cronograma_EdTeste_rev02.xml",
    tarefas: 138,
    termino: "2027-06-11",
    em: em("2026-11-17", "17:19:02"),
  },
  {
    numero: 3,
    arquivo: "Cronograma_EdTeste_rev03.xml",
    tarefas: 138,
    termino: "2027-06-18",
    em: em("2026-11-17", "17:19:03"),
  },
  {
    numero: 4,
    arquivo: "Cronograma_EdTeste_rev04.xml",
    tarefas: 142,
    termino: "2027-06-30",
    em: em("2026-11-17", "17:19:04"),
  },
  {
    numero: 5,
    arquivo: "Cronograma_EdTeste_rev05.xml",
    tarefas: 142,
    termino: "2027-06-30",
    em: em("2026-11-17", "18:45"),
  },
];

interface Linha {
  uid: number;
  nome: string;
  nivel: number;
  resumo: boolean;
  marco: boolean;
  inicio: string | null;
  termino: string | null;
  percentual: number;
}

/**
 * A v5 é a saída real do mpp-extractor para o cronograma de exemplo (a mesma fixture dos testes),
 * com os ajustes das telas: % da Infraestrutura e das Fundações e o nome curto do tipo 3.
 */
function linhasDaV5(): Linha[] {
  const leitura = JSON.parse(
    readFileSync(new URL("../../../servicos/test/fixtures/cronograma.leitura.json", import.meta.url), "utf8"),
  ) as { tarefas: Linha[] };
  const linhas = leitura.tarefas.map((t) => ({ ...t }));
  const ajustar = (ordem: number, campos: Partial<Linha>) => Object.assign(linhas[ordem] ?? {}, campos);
  ajustar(0, { percentual: 92 });
  ajustar(8, { percentual: 85 });
  ajustar(35, { nome: "Pavimento tipo 3" });
  // em 14/12 a fase já andou o que o prazo pede (22 de 68 dias): em andamento, sem atraso, como na tela
  if (cena === "durante-com-historico") ajustar(32, { percentual: 32 });
  if (cena === "fase-sem-data") {
    // Cobertura e reservatório (48) e as tarefas dela saem sem data
    for (let ordem = 48; ordem <= 54; ordem++) ajustar(ordem, { inicio: null, termino: null });
  }
  if (linhas.length !== 142) throw new Error("a fixture do cronograma mudou: esperava 142 linhas");
  return linhas;
}

// ─────────────────────────── Projetos ───────────────────────────

const PROJETOS = [
  {
    codigo: "EST-01",
    revisao: "R01",
    titulo: "Fundações e baldrames",
    disciplina: "estrutura",
    tipo: "dwg",
    textos: [
      "Reaterro somente após a cura da impermeabilização do baldrame (mínimo de 7 dias).",
      "Concreto das estacas: fck 30 MPa.",
      "Cota de arrasamento conforme a planta de locação.",
    ],
  },
  {
    codigo: "EST-03",
    revisao: "R02",
    titulo: "Formas e escoramento do pavimento tipo",
    disciplina: "estrutura",
    tipo: "dwg",
    textos: [
      "Manter o escoramento por 21 dias após a concretagem.",
      "Mesma cota de nível nos dois lados da emenda.",
      "Cura úmida da laje por 7 dias, no mínimo.",
      "Furos em vigas somente com aprovação do calculista.",
    ],
  },
  {
    codigo: "ARQ-02",
    revisao: "R03",
    titulo: "Planta do pavimento tipo",
    disciplina: "arquitetura",
    tipo: "dwg",
    textos: [
      "Encunhamento somente 14 dias após a elevação da alvenaria.",
      "Vergas e contravergas em todos os vãos, com 30 cm de apoio de cada lado.",
      "Altura dos pontos elétricos conforme o layout de interiores (a definir).",
      "Piso das áreas comuns a definir.",
      "Esquadrias de alumínio: modelo a definir com o fornecedor.",
    ],
  },
  {
    codigo: "ARQ-05",
    revisao: "R00",
    titulo: "Cobertura e impermeabilização",
    disciplina: "arquitetura",
    tipo: "dwg",
    textos: [
      "Teste de estanqueidade com lâmina d'água por 72 h antes da proteção mecânica.",
      "Posição dos ralos a definir com o projeto de águas pluviais.",
    ],
  },
  {
    codigo: "INS-01",
    revisao: "R01",
    titulo: "Prumadas e furações",
    disciplina: "instalacoes",
    tipo: "pdf",
    textos: [],
  },
] as const;
type CodigoProjeto = (typeof PROJETOS)[number]["codigo"];

// ─────────────────────────── Riscos e perguntas ───────────────────────────

interface RiscoDaCena {
  nivel: "alto" | "medio" | "baixo";
  titulo: string;
  projeto: CodigoProjeto;
  trecho: string;
  referencia?: string;
  linha: number | null;
  cronograma: string;
  consequencia: string;
}
/** [texto, tipo, esperada, pede foto, risco (1, 2, 3 da fase) ou null, opções (na medida, a unidade)] */
type PerguntaDaCena = [string, Tipo, string | null, boolean, number | null, string[]?];
interface FaseDaCena {
  ordem: number;
  riscos: RiscoDaCena[];
  perguntas: Record<Momento, PerguntaDaCena[]>;
  /** As do engenheiro (fase sem risco): origem manual. */
  manual?: boolean;
}

const SN = "sim_nao" as const;
const FASES: FaseDaCena[] = [
  {
    ordem: 1, // Serviços preliminares
    manual: true,
    riscos: [],
    perguntas: {
      antes: [["O canteiro está liberado para a mobilização?", SN, "Sim", false, null]],
      durante: [["O tapume e os acessos estão íntegros?", SN, "Sim", true, null]],
      depois: [["A locação da obra foi conferida com a topografia?", SN, "Sim", false, null]],
    },
  },
  {
    ordem: 8, // Fundações
    riscos: [
      {
        nivel: "alto",
        titulo:
          "O projeto pede 7 dias de cura da impermeabilização do baldrame; o cronograma reaterra o 1º pavimento em 3",
        projeto: "EST-01",
        trecho: "Reaterro somente após a cura da impermeabilização do baldrame (mínimo de 7 dias).",
        linha: 22,
        cronograma:
          "Reaterro e compactação, 1º pavimento: começa em 26/10/26, 3 dias depois do fim da impermeabilização (linha 21).",
        consequencia:
          "O baldrame é reaterrado com a impermeabilização sem cura e a umidade sobe pelas paredes do térreo.",
      },
    ],
    perguntas: {
      antes: [["A manta de impermeabilização do baldrame já está na obra?", SN, "Sim", true, 1]],
      durante: [
        ["O baldrame reaterrado nesta semana estava com a impermeabilização curada?", SN, "Sim", true, 1],
        ["Mudou alguma coisa em relação ao projeto nesta semana?", "texto", null, false, null],
      ],
      depois: [["Apareceu umidade ou fissura no baldrame depois do reaterro?", SN, "Não", true, 1]],
    },
  },
  {
    ordem: 24, // Térreo e garagem
    riscos: [
      {
        nivel: "alto",
        titulo:
          "O projeto pede 7 dias de cura úmida; o cronograma desforma a laje do térreo 3 dias depois de concretar",
        projeto: "EST-03",
        trecho: "Cura úmida da laje por 7 dias, no mínimo.",
        linha: 31,
        cronograma:
          "Desforma e cura: de 16/11/26 a 20/11/26, logo depois da concretagem da laje, que termina em 13/11/26.",
        consequencia: "A laje do térreo perde resistência e fissura na desforma.",
      },
      {
        nivel: "medio",
        titulo: "Os furos das vigas do térreo não têm a aprovação do calculista antes da armação da laje",
        projeto: "EST-03",
        trecho: "Furos em vigas somente com aprovação do calculista.",
        linha: 29,
        cronograma: "Armação da laje: de 06/11/26 a 10/11/26, sem linha para a compatibilização dos furos.",
        consequencia: "Os passantes são abertos na viga já concretada, com corte de armadura.",
      },
    ],
    perguntas: {
      antes: [
        ["A cura úmida da laje do térreo está programada por 7 dias?", SN, "Sim", false, 1],
        ["Os furos das vigas do térreo foram aprovados pelo calculista?", SN, "Sim", false, 2],
      ],
      durante: [
        ["A laje foi molhada todos os dias desta semana?", SN, "Sim", true, 1],
        ["Abriram algum furo em viga sem a aprovação do calculista?", SN, "Não", true, 2],
      ],
      depois: [["Apareceu fissura na laje do térreo depois da desforma?", SN, "Não", true, 1]],
    },
  },
  {
    ordem: 32, // Pavimentos tipo 1 a 4: RISCOS_FASE, P_ANTES, P_DURANTE e P_DEPOIS das telas
    riscos: [
      {
        nivel: "alto",
        titulo: "Furos de prumada sem definição a 5 dias da forma da laje",
        projeto: "INS-01",
        trecho: "Furos de prumada a definir após compatibilização com a estrutura.",
        referencia: "PDF, folha 2",
        linha: 33,
        cronograma: "o tipo 1 começa em 23/11.",
        consequencia:
          "A laje do tipo 1 é concretada sem os passantes e precisa ser furada depois, com corte de armadura.",
      },
      {
        nivel: "alto",
        titulo: "O projeto pede 21 dias de escoramento; o cronograma carrega a laje do térreo em 10",
        projeto: "EST-03",
        trecho: "Manter o escoramento por 21 dias após a concretagem.",
        linha: 30,
        cronograma: "concretagem até 13/11, tipo 1 em 23/11.",
        consequencia:
          "A laje do térreo recebe o peso do tipo 1 antes da hora e pode fissurar ou ganhar flecha.",
      },
      {
        nivel: "medio",
        titulo: "O tipo 4 está sem data: a emenda com a laje do tipo 3 fica sem dia de conferência",
        projeto: "EST-03",
        trecho: "Mesma cota de nível nos dois lados da emenda.",
        linha: 36,
        cronograma: "Pavimento tipo 4 sem início nem término.",
        consequencia:
          "A emenda entre as lajes do tipo 3 e do tipo 4 é concretada sem conferir o nível e fica um degrau no piso.",
      },
    ],
    perguntas: {
      antes: [
        ["Os furos de prumada do tipo 1 já estão marcados na forma, conforme a INS-01?", SN, "Sim", true, 1],
        ["Qual revisão da prancha INS-01 está na obra?", "opcao", "R01", false, 1, ["R00", "R01", "não sei"]],
        ["O reescoramento do térreo está montado conforme a EST-03?", SN, "Sim", true, 2],
        ["Em que dia terminou a concretagem da laje do térreo?", "data", "<=2026-11-02", false, 2],
        [
          "Qual referência de nível vai ser usada na forma do tipo 1?",
          "opcao",
          "RN-01",
          false,
          3,
          ["RN-01", "outra"],
        ],
      ],
      durante: [
        ["Os passantes foram conferidos antes de liberar o concreto da laje?", SN, "Sim", true, 1],
        ["As escoras do pavimento de baixo continuam no lugar?", SN, "Sim", true, 2],
        ["Nível do fundo da forma no encontro com a laje vizinha", "medida", "5.995..6.005", false, 3, ["m"]],
        ["Mudou alguma coisa em relação ao projeto nesta semana?", "texto", null, false, null],
      ],
      depois: [
        ["Depois da desforma, todos os passantes estão desobstruídos?", SN, "Sim", true, 1],
        ["Apareceu fissura ou flecha visível na laje de baixo?", SN, "Não", true, 2],
        ["Diferença de nível medida na emenda entre as lajes", "medida", "-5..5", false, 3, ["mm"]],
      ],
    },
  },
  {
    ordem: 48, // Cobertura e reservatório
    riscos: [
      {
        nivel: "medio",
        titulo:
          "O projeto pede 72 h de teste de estanqueidade; o cronograma não reserva dia para o teste na cobertura",
        projeto: "ARQ-05",
        trecho: "Teste de estanqueidade com lâmina d'água por 72 h antes da proteção mecânica.",
        linha: 53,
        cronograma:
          "Impermeabilização da cobertura, térreo: de 18/02/27 a 19/02/27; a linha seguinte começa em 22/02/27.",
        consequencia:
          "A proteção mecânica cobre a manta sem teste e o vazamento só aparece com o reservatório cheio.",
      },
      {
        nivel: "baixo",
        titulo: "A posição dos ralos está a definir e a laje de cobertura começa em 01/02",
        projeto: "ARQ-05",
        trecho: "Posição dos ralos a definir com o projeto de águas pluviais.",
        linha: 49,
        cronograma: "Laje de cobertura, térreo: de 01/02/27 a 04/02/27.",
        consequencia: "Os ralos ficam fora do caimento e a laje precisa ser furada depois.",
      },
    ],
    perguntas: {
      antes: [
        [
          "O teste de estanqueidade de 72 h está programado para a semana da impermeabilização?",
          SN,
          "Sim",
          false,
          1,
        ],
        ["A posição dos ralos da cobertura já foi definida?", SN, "Sim", false, 2],
      ],
      durante: [["A lâmina d'água do teste ficou 72 h sem baixar?", SN, "Sim", true, 1]],
      depois: [["Apareceu mancha de umidade no teto do último pavimento?", SN, "Não", true, 1]],
    },
  },
  {
    ordem: 56, // Alvenaria
    riscos: [
      {
        nivel: "medio",
        titulo: "O projeto pede 14 dias entre elevação e encunhamento; o cronograma encunha o térreo em 7",
        projeto: "ARQ-02",
        trecho: "Encunhamento somente 14 dias após a elevação da alvenaria.",
        linha: 60,
        cronograma:
          "Encunhamento, térreo: começa em 21/12/26, 7 dias depois do fim da elevação (linha 58, 14/12/26).",
        consequencia: "A alvenaria trinca no encontro com a viga quando a estrutura acomoda.",
      },
      {
        nivel: "baixo",
        titulo:
          "O projeto pede vergas com 30 cm de apoio; o cronograma junta vergas e encunhamento do térreo na mesma semana",
        projeto: "ARQ-02",
        trecho: "Vergas e contravergas em todos os vãos, com 30 cm de apoio de cada lado.",
        linha: 59,
        cronograma: "Vergas e contravergas, térreo: de 15/12/26 a 18/12/26, logo antes do encunhamento.",
        consequencia: "Vão sem verga ou com apoio curto abre fissura a 45° nos cantos das janelas.",
      },
    ],
    perguntas: {
      antes: [
        ["O encunhamento do térreo está programado para 14 dias depois da elevação?", SN, "Sim", false, 1],
        ["As vergas e contravergas pré-moldadas já estão na obra?", SN, "Sim", false, 2],
      ],
      durante: [["O encunhamento desta semana esperou 14 dias depois da elevação?", SN, "Sim", false, 1]],
      depois: [["Apareceu fissura nos cantos das janelas?", SN, "Não", true, 2]],
    },
  },
  {
    ordem: 79, // Elétrica e hidráulica
    riscos: [
      {
        nivel: "medio",
        titulo: "O diâmetro das prumadas de esgoto está a confirmar e a prumada do térreo começa em 08/01",
        projeto: "INS-01",
        trecho: "Diâmetro das prumadas de esgoto a confirmar.",
        referencia: "PDF, folha 3",
        linha: 81,
        cronograma: "Prumadas de esgoto, térreo: de 08/01/27 a 11/01/27.",
        consequencia: "A prumada é montada com o diâmetro errado e precisa ser trocada com a parede fechada.",
      },
      {
        nivel: "baixo",
        titulo: "A altura dos pontos elétricos depende do layout de interiores, que está a definir",
        projeto: "ARQ-02",
        trecho: "Altura dos pontos elétricos conforme o layout de interiores (a definir).",
        linha: 82,
        cronograma: "Eletrodutos e caixas, térreo: de 12/01/27 a 15/01/27.",
        consequencia: "As caixas ficam fora da altura dos móveis e a parede é quebrada para mudar.",
      },
    ],
    perguntas: {
      antes: [["O diâmetro das prumadas de esgoto foi confirmado na INS-01?", SN, "Sim", false, 1]],
      durante: [["As caixas elétricas desta semana seguiram o layout de interiores?", SN, "Sim", true, 2]],
      depois: [["O teste de estanqueidade das prumadas passou?", SN, "Sim", true, 1]],
    },
  },
  {
    ordem: 108, // Revestimentos e pisos
    riscos: [
      {
        nivel: "medio",
        titulo: "O piso das áreas comuns está a definir e o contrapiso do térreo começa em 19/03",
        projeto: "ARQ-02",
        trecho: "Piso das áreas comuns a definir.",
        linha: 110,
        cronograma: "Contrapiso, térreo: de 19/03/27 a 22/03/27.",
        consequencia: "O contrapiso sai no nível errado para o piso escolhido e precisa ser refeito.",
      },
    ],
    perguntas: {
      antes: [["O piso das áreas comuns já foi definido?", SN, "Sim", false, 1]],
      durante: [["Espessura do contrapiso medida hoje", "medida", "3..5", false, 1, ["cm"]]],
      depois: [["Apareceu som cavo no piso assentado?", SN, "Não", false, 1]],
    },
  },
  {
    ordem: 126, // Esquadrias e pintura
    riscos: [
      {
        nivel: "baixo",
        titulo: "O modelo das esquadrias está a definir e os contramarcos do térreo começam em 19/04",
        projeto: "ARQ-02",
        trecho: "Esquadrias de alumínio: modelo a definir com o fornecedor.",
        linha: 127,
        cronograma: "Contramarcos, térreo: de 19/04/27 a 22/04/27.",
        consequencia: "Os contramarcos ficam fora da medida do modelo escolhido e o vão precisa de ajuste.",
      },
    ],
    perguntas: {
      antes: [["O modelo das esquadrias já foi definido com o fornecedor?", SN, "Sim", false, 1]],
      durante: [["Os contramarcos desta semana estão no prumo e no nível?", SN, "Sim", true, 1]],
      depois: [["Alguma janela ficou com folga ou entrada de água?", SN, "Não", false, 1]],
    },
  },
];

/** Resposta dentro do esperado para uma pergunta. Sim ou não é gravado como "sim" / "nao". */
function respostaCerta(tipo: Tipo, esperada: string | null): string {
  if (tipo === "texto" || !esperada) return "Nada mudou";
  if (tipo === "sim_nao") return esperada.toLowerCase() === "sim" ? "sim" : "nao";
  if (tipo === "data") return esperada.slice(2);
  if (tipo === "medida") {
    const [min = "0", max = "0"] = esperada.split("..");
    const casas = Math.max(...[min, max].map((n) => n.split(".")[1]?.length ?? 0));
    return ((Number(min) + Number(max)) / 2).toFixed(casas);
  }
  return esperada;
}

// ─────────────────────────── Gravação ───────────────────────────

interface Contexto {
  tx: Tx;
  tenantId: string;
  obraId: string;
  anaId: string;
  joaoId: string;
}

async function limpar({ tx, obraId }: Contexto) {
  const { checkFase, checkPergunta, checkEnvio, checkResposta, midia, riscoFase, cruzamento } = schema;
  const checks = (
    await tx.select({ id: checkFase.id }).from(checkFase).where(eq(checkFase.obraId, obraId))
  ).map((c) => c.id);
  if (checks.length) {
    const envios = (
      await tx.select({ id: checkEnvio.id }).from(checkEnvio).where(inArray(checkEnvio.checkId, checks))
    ).map((e) => e.id);
    if (envios.length) {
      const fotos = (
        await tx
          .select({ id: checkResposta.midiaId })
          .from(checkResposta)
          .where(inArray(checkResposta.envioId, envios))
      ).flatMap((r) => (r.id ? [r.id] : []));
      await tx.delete(checkResposta).where(inArray(checkResposta.envioId, envios));
      // só as fotos que a própria cena criou
      if (fotos.length)
        await tx.delete(midia).where(and(inArray(midia.id, fotos), like(midia.storageKey, "cena/%")));
      await tx.delete(checkEnvio).where(inArray(checkEnvio.id, envios));
    }
    await tx.delete(checkPergunta).where(inArray(checkPergunta.checkId, checks));
    await tx.delete(checkFase).where(inArray(checkFase.id, checks));
  }
  await tx.delete(riscoFase).where(eq(riscoFase.obraId, obraId));
  await tx.delete(cruzamento).where(eq(cruzamento.obraId, obraId));

  const versoes = (
    await tx
      .select({ id: schema.cronogramaVersao.id })
      .from(schema.cronogramaVersao)
      .where(eq(schema.cronogramaVersao.obraId, obraId))
  ).map((v) => v.id);
  if (versoes.length) {
    await tx.delete(schema.cronogramaTarefa).where(inArray(schema.cronogramaTarefa.versaoId, versoes));
    await tx.delete(schema.cronogramaVersao).where(inArray(schema.cronogramaVersao.id, versoes));
  }

  // "sem-projeto" precisa da obra sem nenhum projeto: saem todos os da obra (os pontos de controle ficam, sem o vínculo)
  const projetos = (
    await tx.select({ id: schema.projeto.id }).from(schema.projeto).where(eq(schema.projeto.obraId, obraId))
  ).map((p) => p.id);
  if (projetos.length) {
    await tx.delete(schema.extracaoProjeto).where(inArray(schema.extracaoProjeto.projetoId, projetos));
    await tx.delete(schema.pendencia).where(inArray(schema.pendencia.projetoId, projetos));
    await tx
      .update(schema.pontoControle)
      .set({ projetoId: null })
      .where(inArray(schema.pontoControle.projetoId, projetos));
    await tx.update(schema.projeto).set({ substituidoPorId: null }).where(eq(schema.projeto.obraId, obraId));
    await tx.delete(schema.projeto).where(inArray(schema.projeto.id, projetos));
  }
}

async function gravarCronograma({ tx, tenantId, obraId }: Contexto, adminId: string) {
  let v5 = "";
  for (const v of VERSOES) {
    const [criada] = await tx
      .insert(schema.cronogramaVersao)
      .values({
        tenantId,
        obraId,
        numero: v.numero,
        vigente: v.numero === 5,
        arquivoNome: v.arquivo,
        tipoArquivo: "xml",
        arquivoKey: `cena/cronogramas/${v.arquivo}`,
        arquivoSha256: falso(v.arquivo),
        statusLeitura: "concluida",
        totalTarefas: v.tarefas,
        inicio: "2026-08-03",
        termino: v.termino,
        versaoLeitor: "cena-riscos",
        enviadoPorId: adminId,
        criadoEm: v.em,
      })
      .returning({ id: schema.cronogramaVersao.id });
    if (criada && v.numero === 5) v5 = criada.id;
  }
  const linhas = linhasDaV5();
  await tx
    .insert(schema.cronogramaTarefa)
    .values(linhas.map((l, ordem) => ({ tenantId, versaoId: v5, ordem, ...l })));
  return { v5, linhas };
}

async function gravarProjetos({ tx, tenantId, obraId, anaId }: Contexto) {
  const ids = new Map<CodigoProjeto, string>();
  for (const [i, p] of PROJETOS.entries()) {
    const [criado] = await tx
      .insert(schema.projeto)
      .values({
        tenantId,
        obraId,
        disciplina: p.disciplina,
        titulo: p.titulo,
        codigo: p.codigo,
        revisao: p.revisao,
        tipoArquivo: p.tipo,
        arquivoKey: `cena/projetos/${p.codigo}-${p.revisao}.${p.tipo}`,
        arquivoSha256: falso(p.codigo),
        statusExtracao: p.tipo === "dwg" ? "concluida" : "nao_aplicavel",
        enviadoPorId: anaId,
        criadoEm: em("2026-11-17", `16:${String(10 + i * 5).padStart(2, "0")}`),
      })
      .returning({ id: schema.projeto.id });
    if (!criado) throw new Error(`falha ao criar ${p.codigo}`);
    ids.set(p.codigo, criado.id);
    if (p.tipo !== "dwg") continue;
    await tx.insert(schema.extracaoProjeto).values({
      tenantId,
      projetoId: criado.id,
      textos: p.textos.map((texto, n) => ({
        texto,
        tipo: "MTEXT",
        camada: "NOTAS",
        bloco: null,
        tag: null,
        x: 10,
        y: 100 - n * 5,
      })),
      camadas: [{ nome: "NOTAS", desligada: false, congelada: false, entidades: p.textos.length }],
      blocos: [],
      cotasNivel: [],
      ambientes: [],
      carimbo: {
        cliente: "Construtora Exemplo",
        obra: "Edifício Teste",
        titulo: p.titulo,
        fase: "EXECUTIVO",
        revisao: p.revisao,
        data: "10/11/2026",
        folha: "01/01",
        escala: null,
        responsavel: null,
        atributos: {},
        notas: p.textos.map((texto) => ({
          texto,
          camada: "NOTAS",
          pareceDependencia: /a definir|a confirmar/i.test(texto),
        })),
        unidades: { codigo: "6", metrosPorUnidade: 1, assumida: false },
      },
      versaoExtrator: "cena-riscos",
    });
  }
  return ids;
}

/** Fotos de resposta: só a linha (a cena não grava arquivo no bucket). */
async function foto(tx: Tx, tenantId: string, nome: string) {
  const [m] = await tx
    .insert(schema.midia)
    .values({
      tenantId,
      origem: "flow_cdn",
      status: "armazenada",
      storageKey: `cena/fotos/${nome}.jpg`,
      sha256: falso(nome),
      mimeType: "image/jpeg",
      tamanhoBytes: 180_000,
    })
    .returning({ id: schema.midia.id });
  return m?.id ?? null;
}

interface PerguntaGravada {
  id: string;
  tipo: Tipo;
  esperada: string | null;
  pedeFoto: boolean;
}

interface Envio {
  previstoPara: string;
  enviadoEm: Date;
  entrega?: "enviado" | "entregue" | "lido";
  lidoEm?: Date | null;
  /** Sem resposta: o check fica "na obra". */
  resposta?: {
    em: Date;
    /** Por índice da pergunta: o que muda em relação à resposta certa (fora do esperado, se não disser). */
    trocas?: Record<number, { valor: string; dentro?: boolean; observacao?: string; foto?: boolean }>;
  };
}

async function gravarEnvio(c: Contexto, checkId: string, perguntas: PerguntaGravada[], e: Envio) {
  const [envio] = await c.tx
    .insert(schema.checkEnvio)
    .values({
      tenantId: c.tenantId,
      checkId,
      previstoPara: e.previstoPara,
      enviadoEm: e.enviadoEm,
      entrega: e.entrega ?? "lido",
      lidoEm: e.entrega === "entregue" ? null : (e.lidoEm ?? new Date(e.enviadoEm.getTime() + 26 * 60_000)),
      criadoEm: e.enviadoEm,
    })
    .returning({ id: schema.checkEnvio.id });
  if (!envio || !e.resposta) return;
  let fora = 0;
  for (const [i, p] of perguntas.entries()) {
    const troca = e.resposta.trocas?.[i];
    const comparavel = p.tipo !== "texto" && p.esperada !== null;
    const dentro = comparavel ? (troca?.dentro ?? !troca) : null;
    if (dentro === false) fora++;
    const comFoto = troca?.foto ?? p.pedeFoto;
    await c.tx.insert(schema.checkResposta).values({
      tenantId: c.tenantId,
      envioId: envio.id,
      perguntaId: p.id,
      valor: troca?.valor ?? respostaCerta(p.tipo, p.esperada),
      dentroDoEsperado: dentro,
      observacao: troca?.observacao ?? null,
      midiaId: comFoto ? await foto(c.tx, c.tenantId, `${envio.id}-${i + 1}`) : null,
      criadoEm: e.resposta.em,
    });
  }
  await c.tx
    .update(schema.checkEnvio)
    .set({ respondidoEm: e.resposta.em, respondidoPorId: c.joaoId, foraDoEsperado: fora })
    .where(eq(schema.checkEnvio.id, envio.id));
}

/** Aprovação, envios e respostas de cada check, para o estado de cada conta bater com as telas. */
function historicoDa(
  ordem: number,
  momento: Momento,
  datas: string[],
): { aprovadoEm: Date | null; envios: Envio[] } {
  const enviado = (data: string, resposta?: Envio["resposta"]): Envio => ({
    previstoPara: data,
    enviadoEm: em(data, "07:00"),
    resposta,
  });
  const respondido = (data: string, hora = "11:04", trocas?: NonNullable<Envio["resposta"]>["trocas"]) =>
    enviado(data, { em: em(data, hora), trocas });
  const ate = (lista: Envio[]) => lista.filter((e) => e.previstoPara <= HOJE);

  if (ordem === 1) {
    // Serviços preliminares: os três respondidos sem alerta
    return { aprovadoEm: em("2026-07-29", "09:00"), envios: ate(datas.map((d) => respondido(d))) };
  }
  if (ordem === 8 && momento !== "depois") {
    // Fundações: Antes respondido; Durante com alerta no último envio
    const envios = datas.map((d, i) =>
      momento === "durante" && i === datas.length - 1
        ? respondido(d, "10:15", {
            0: { valor: "nao", observacao: "O trecho do eixo C foi reaterrado antes de a manta curar." },
          })
        : respondido(d, "10:15"),
    );
    return { aprovadoEm: em("2026-08-26", "09:10"), envios: ate(envios) };
  }
  if (ordem === 24 && momento !== "depois") {
    // Térreo e garagem: Antes respondido; Durante com o envio da última segunda sem resposta
    const envios = datas.map((d, i) =>
      momento === "durante" && i === datas.length - 1 ? enviado(d) : respondido(d),
    );
    return { aprovadoEm: em("2026-10-14", "08:30"), envios: ate(envios) };
  }
  if (ordem === 56 && momento === "antes") return { aprovadoEm: em("2026-11-16", "15:20"), envios: [] };
  if (ordem === 32) return historicoDosPavimentos(momento);
  return { aprovadoEm: null, envios: [] };
}

const semHistorico = { aprovadoEm: null, envios: [] };

/** Pavimentos tipo 1 a 4: o que muda de uma cena para outra, relativo a `--hoje`. */
function historicoDosPavimentos(momento: Momento): { aprovadoEm: Date | null; envios: Envio[] } {
  const antesNaObra: Envio = {
    previstoPara: HOJE,
    enviadoEm: relativo(0, "07:00"),
    entrega: "lido",
    lidoEm: relativo(0, "07:26"),
  };
  const comAlerta = {
    0: { valor: "nao", observacao: "A hidráulica ainda não veio marcar os furos.", foto: false },
  };
  switch (cena) {
    case "agendado":
      return momento === "antes" ? { aprovadoEm: relativo(0, "10:12"), envios: [] } : semHistorico;
    case "na-obra":
    case "respondido":
    case "com-alerta": {
      if (momento === "durante") return { aprovadoEm: relativo(-2, "10:14"), envios: [] };
      if (momento === "depois") return semHistorico;
      const resposta =
        cena === "na-obra"
          ? undefined
          : { em: relativo(0, "11:04"), trocas: cena === "com-alerta" ? comAlerta : undefined };
      return { aprovadoEm: relativo(-2, "10:12"), envios: [{ ...antesNaObra, resposta }] };
    }
    case "durante-com-historico": {
      if (momento === "antes") {
        const dia = somarDias(HOJE, -24);
        return {
          aprovadoEm: relativo(-26, "10:12"),
          envios: [
            {
              previstoPara: dia,
              enviadoEm: em(dia, "07:00"),
              entrega: "lido",
              resposta: { em: em(dia, "11:04") },
            },
          ],
        };
      }
      if (momento === "depois") return { aprovadoEm: relativo(-14, "08:20"), envios: [] };
      const semana = (dias: number) => somarDias(HOJE, dias);
      return {
        aprovadoEm: relativo(-26, "10:14"),
        envios: [
          {
            previstoPara: semana(-14),
            enviadoEm: relativo(-14, "07:00"),
            resposta: { em: relativo(-14, "09:10") },
          },
          {
            previstoPara: semana(-7),
            enviadoEm: relativo(-7, "07:00"),
            resposta: {
              em: relativo(-7, "09:41"),
              trocas: {
                1: { valor: "nao", observacao: "Tiraram duas escoras para passar o carrinho." },
                2: { valor: "6.002", dentro: true },
              },
            },
          },
          {
            previstoPara: HOJE,
            enviadoEm: relativo(0, "07:00"),
            entrega: "lido",
            lidoEm: relativo(0, "07:26"),
          },
        ],
      };
    }
    default:
      return semHistorico;
  }
}

async function gravarRiscosEChecks(
  c: Contexto,
  versaoId: string,
  linhas: Linha[],
  projetos: Map<CodigoProjeto, string>,
) {
  const [cruz] = await c.tx
    .insert(schema.cruzamento)
    .values({
      tenantId: c.tenantId,
      obraId: c.obraId,
      cronogramaVersaoId: versaoId,
      status: "concluida",
      projetos: retrato(projetos),
      geradoPor: "claude-opus-5-5@cruzamento-v2",
      criadoEm: em("2026-11-17", "18:58"),
      iniciadoEm: em("2026-11-17", "18:59"),
      concluidoEm: em("2026-11-17", "19:02"),
    })
    .returning({ id: schema.cruzamento.id });
  if (!cruz) throw new Error("falha ao criar o cruzamento");

  let perguntas = 0;
  let riscos = 0;
  for (const f of FASES) {
    const fase = linhas[f.ordem];
    if (!fase) throw new Error(`linha ${f.ordem} não existe`);
    const idsRiscos: string[] = [];
    for (const [i, r] of f.riscos.entries()) {
      const [criado] = await c.tx
        .insert(schema.riscoFase)
        .values({
          tenantId: c.tenantId,
          obraId: c.obraId,
          cruzamentoId: cruz.id,
          faseUid: fase.uid,
          ordem: i + 1,
          nivel: r.nivel,
          titulo: r.titulo,
          projetoId: projetos.get(r.projeto) ?? null,
          projetoTrecho: r.trecho,
          projetoReferencia: r.referencia ?? null,
          cronogramaOrdem: r.linha,
          cronogramaTrecho: r.cronograma,
          consequencia: r.consequencia,
        })
        .returning({ id: schema.riscoFase.id });
      if (criado) idsRiscos.push(criado.id);
      riscos++;
    }
    for (const momento of ["antes", "durante", "depois"] as const) {
      const dias = momento === "antes" ? 3 : 1;
      const historico = historicoDa(f.ordem, momento, datasDoCheck(momento, dias, fase.inicio, fase.termino));
      const [check] = await c.tx
        .insert(schema.checkFase)
        .values({
          tenantId: c.tenantId,
          obraId: c.obraId,
          faseUid: fase.uid,
          momento,
          dias,
          hora: "07:00",
          responsavelId: c.joaoId,
          aprovadoPorId: historico.aprovadoEm ? c.anaId : null,
          aprovadoEm: historico.aprovadoEm,
          // as perguntas de Serviços preliminares foram postas pelo engenheiro
          editadoEm: f.manual ? em("2026-07-29", "08:50") : null,
          criadoEm: em("2026-11-17", "19:02"),
        })
        .returning({ id: schema.checkFase.id });
      if (!check) throw new Error("falha ao criar o check");
      const gravadas: PerguntaGravada[] = [];
      for (const [i, [texto, tipo, esperada, pedeFoto, risco, opcoes = []]] of f.perguntas[
        momento
      ].entries()) {
        const [p] = await c.tx
          .insert(schema.checkPergunta)
          .values({
            tenantId: c.tenantId,
            checkId: check.id,
            ordem: i + 1,
            texto,
            tipoResposta: tipo,
            opcoes,
            esperada,
            pedeFoto,
            riscoId: risco ? (idsRiscos[risco - 1] ?? null) : null,
            origem: f.manual ? "manual" : "ia",
          })
          .returning({ id: schema.checkPergunta.id });
        if (p) gravadas.push({ id: p.id, tipo, esperada, pedeFoto });
        perguntas++;
      }
      for (const e of historico.envios) await gravarEnvio(c, check.id, gravadas, e);
    }
  }
  return { riscos, perguntas };
}

const retrato = (projetos: Map<CodigoProjeto, string>) =>
  PROJETOS.map((p) => ({
    id: projetos.get(p.codigo),
    codigo: p.codigo,
    revisao: p.revisao,
    titulo: p.titulo,
    tipoArquivo: p.tipo,
  }));

// ─────────────────────────── Execução ───────────────────────────

const resultado = await comDono(url, async (db) =>
  db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.cnpj, SEED.cnpj));
    if (!t) throw new Error("Construtora Exemplo não encontrada: rode o seed (pnpm db:seed).");
    const [o] = await tx
      .select({ id: schema.obra.id })
      .from(schema.obra)
      .where(and(eq(schema.obra.tenantId, t.id), eq(schema.obra.nome, "Edifício Teste")));
    if (!o) throw new Error("Obra Edifício Teste não encontrada: rode o seed (pnpm db:seed).");
    // pelo WhatsApp: o e-mail do admin costuma ser trocado no banco local para entrar no painel
    const usuarioPor = async (whatsapp: string) => {
      const [u] = await tx
        .select({ id: schema.usuario.id })
        .from(schema.usuario)
        .where(and(eq(schema.usuario.tenantId, t.id), eq(schema.usuario.whatsappE164, whatsapp)));
      if (!u) throw new Error(`usuário do seed não encontrado: ${whatsapp}`);
      return u.id;
    };
    const c: Contexto = {
      tx,
      tenantId: t.id,
      obraId: o.id,
      anaId: await usuarioPor(SEED.ana.whatsappE164),
      joaoId: await usuarioPor(SEED.joao.whatsappE164),
    };
    const adminId = await usuarioPor(SEED.admin.whatsappE164);

    await limpar(c);
    const { v5, linhas } = await gravarCronograma(c, adminId);
    let resumo = "cronograma v5 sem projeto";
    if (cena !== "sem-projeto") {
      const projetos = await gravarProjetos(c);
      if (cena === "cruzando") {
        await tx.insert(schema.cruzamento).values({
          tenantId: c.tenantId,
          obraId: c.obraId,
          cronogramaVersaoId: v5,
          status: "processando",
          projetos: retrato(projetos),
          criadoEm: em("2026-11-17", "19:02"),
          // sem iniciado_em de propósito: assim nenhum job (nem a varredura do worker no ar) o retoma
          iniciadoEm: null,
        });
        resumo = "cruzamento dos 5 projetos com a v5 em andamento";
      } else {
        const r = await gravarRiscosEChecks(c, v5, linhas, projetos);
        resumo = `${r.riscos} riscos e ${r.perguntas} perguntas`;
      }
    }
    await tx.insert(schema.auditLog).values({
      tenantId: c.tenantId,
      atorTipo: "sistema",
      atorId: adminId,
      acao: "seed.cena_riscos",
      entidade: "obra",
      entidadeId: c.obraId,
      depois: { cena, hoje: HOJE },
    });
    const fase = linhas[32];
    return { obraId: c.obraId, faseUid: fase?.uid ?? 33, resumo };
  }),
);

const caminho = `/obras/${resultado.obraId}/cronograma/${resultado.faseUid}`;
console.log(`✓ cena "${cena}" gravada (hoje ${HOJE}): ${resultado.resumo}.`);
console.log(`  Obra: Edifício Teste (${resultado.obraId})`);
console.log(`  Fase: Pavimentos tipo 1 a 4 (uid ${resultado.faseUid})`);
console.log(
  `  Página: ${process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}${caminho}` : caminho}`,
);
