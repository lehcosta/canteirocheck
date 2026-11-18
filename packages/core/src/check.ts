import Decimal from "decimal.js";
import { lerNumero } from "./numero";

/**
 * Checks por fase do cronograma: quando cada um sai, em que estado está e se a resposta da obra
 * bate com a esperada. PURO: só datas (AAAA-MM-DD, sem fuso) e texto.
 */

export type Momento = "antes" | "durante" | "depois";
export type EstadoCheck = "sugerido" | "aprovar" | "agendado" | "naobra" | "ok" | "alerta";
export type TipoResposta = "sim_nao" | "opcao" | "data" | "medida" | "texto";
export type Nivel = "alto" | "medio" | "baixo";

export const MOMENTOS: readonly Momento[] = ["antes", "durante", "depois"];
export const DIAS_PARA_PEDIR_APROVACAO = 7;
/** O que cabe num envio do WhatsApp. */
export const MAXIMO_DE_PERGUNTAS = 9;
/** Caracteres por opção (limite do Flow). */
export const MAXIMO_DA_OPCAO = 30;
export const MAXIMO_DE_OPCOES = 10;
export const MAXIMO_DO_TEXTO_DA_PERGUNTA = 300;
/** Pergunta de medida leva a unidade em `opcoes[0]`. */
export const UNIDADES_DE_MEDIDA = ["m", "cm", "mm"] as const;
export type UnidadeDeMedida = (typeof UNIDADES_DE_MEDIDA)[number];

/** Regra de um check novo: antes = 3 dias corridos; durante = toda segunda; depois = 1 dia útil. */
export const REGRA_PADRAO: Record<Momento, { dias: number; hora: string }> = {
  antes: { dias: 3, hora: "07:00" },
  durante: { dias: 1, hora: "07:00" },
  depois: { dias: 1, hora: "07:00" },
};

const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** 1 = segunda … 7 = domingo. */
const diaDaSemana = (t: number) => new Date(t).getUTCDay() || 7;

/** Datas (AAAA-MM-DD) em que o check sai. [] quando a fase não tem a data de que a regra precisa. */
export function datasDoCheck(
  regra: { momento: Momento; dias: number },
  fase: { inicio: string | null; termino: string | null },
): string[] {
  if (regra.momento === "antes") {
    return fase.inicio ? [iso(ms(fase.inicio) - regra.dias * DIA)] : [];
  }
  if (regra.momento === "depois") {
    if (!fase.termino) return [];
    let t = ms(fase.termino);
    for (let faltam = regra.dias; faltam > 0; ) {
      t += DIA;
      if (diaDaSemana(t) <= 5) faltam--;
    }
    return [iso(t)];
  }
  if (!fase.inicio || !fase.termino) return [];
  // o dia do início não conta: o primeiro envio é na semana seguinte ao começo
  const datas: string[] = [];
  const fim = ms(fase.termino);
  let t = ms(fase.inicio) + DIA;
  while (t <= fim && diaDaSemana(t) !== regra.dias) t += DIA;
  for (; t <= fim; t += 7 * DIA) datas.push(iso(t));
  return datas;
}

/** A primeira data de hoje em diante; se todas já passaram, a última; null sem datas. */
export function proximaSaida(datas: string[], hoje: string): string | null {
  const ordenadas = [...datas].sort();
  return ordenadas.find((d) => d >= hoje) ?? ordenadas.at(-1) ?? null;
}

/**
 * Pelo envio enviado mais recente: com resposta fora do esperado = alerta; respondido = ok; sem
 * resposta = na obra. Sem envio: aprovado = agendado; senão, para aprovar quando a próxima saída
 * está a até 7 dias de hoje (antes ou depois); fora disso, sugerido.
 */
export function estadoDoCheck(
  c: {
    aprovado: boolean;
    datas: string[];
    envios: { previstoPara: string; enviado: boolean; respondido: boolean; foraDoEsperado: number | null }[];
  },
  hoje: string,
): EstadoCheck {
  const ultimo = c.envios
    .filter((e) => e.enviado)
    .sort((a, b) => b.previstoPara.localeCompare(a.previstoPara))[0];
  if (ultimo) {
    if (!ultimo.respondido) return "naobra";
    return (ultimo.foraDoEsperado ?? 0) > 0 ? "alerta" : "ok";
  }
  if (c.aprovado) return "agendado";
  const proxima = proximaSaida(c.datas, hoje);
  if (!proxima) return "sugerido";
  // perto da saída (para um lado ou para o outro) pede decisão; data vencida há tempo não
  const dias = (ms(proxima) - ms(hoje)) / DIA;
  return Math.abs(dias) <= DIAS_PARA_PEDIR_APROVACAO ? "aprovar" : "sugerido";
}

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** "2026-11-02" ou "02/11/2026" → "2026-11-02"; null se não for data. */
function lerData(valor: string): string | null {
  const v = valor.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  const candidata = br ? `${br[3]}-${br[2]}-${br[1]}` : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidata)) return null;
  return Number.isNaN(ms(candidata)) || iso(ms(candidata)) !== candidata ? null : candidata;
}

/** A unidade de uma pergunta de medida (`opcoes[0]`), ou null se não for m, cm nem mm. */
export function unidadeDaMedida(opcoes: readonly string[]): UnidadeDeMedida | null {
  const u = opcoes[0]?.trim().toLowerCase();
  return UNIDADES_DE_MEDIDA.find((x) => x === u) ?? null;
}

/** Resposta de sim ou não como fica gravada ("sim" / "nao"); null se não for nenhuma das duas. */
export function simOuNao(valor: string): "sim" | "nao" | null {
  const v = normalizar(valor);
  return v === "sim" || v === "nao" ? v : null;
}

/**
 * Formato da esperada por tipo: `sim_nao` "Sim" ou "Não"; `opcao` uma das opções; `data`
 * "<=AAAA-MM-DD" ou ">=AAAA-MM-DD"; `medida` "min..max" (número com ponto, na unidade de
 * `opcoes[0]`); `texto` sem esperada.
 */
export function esperadaValida(tipo: TipoResposta, esperada: string): boolean {
  if (tipo === "sim_nao") return ["sim", "nao"].includes(normalizar(esperada));
  if (tipo === "data") {
    const m = /^(<=|>=)(.+)$/.exec(esperada.trim());
    return m?.[2] !== undefined && lerData(m[2]) !== null;
  }
  if (tipo === "medida") {
    const m = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(esperada.trim());
    return m?.[1] !== undefined && m[2] !== undefined && new Decimal(m[1]).lessThanOrEqualTo(m[2]);
  }
  return tipo === "opcao" && esperada.trim().length > 0;
}

/** true/false quando dá para comparar com a esperada; null quando a pergunta não tem esperada comparável. */
export function avaliarResposta(
  p: { tipo: TipoResposta; esperada: string | null },
  valor: string,
): boolean | null {
  const esperada = p.esperada?.trim();
  if (!esperada || p.tipo === "texto" || !esperadaValida(p.tipo, esperada)) return null;
  if (p.tipo === "sim_nao" || p.tipo === "opcao") return normalizar(valor) === normalizar(esperada);
  if (p.tipo === "data") {
    const limite = lerData(esperada.slice(2));
    const data = lerData(valor);
    if (!limite || !data) return false;
    return esperada.startsWith("<=") ? data <= limite : data >= limite;
  }
  const [min = "0", max = "0"] = esperada.split("..");
  const lido = lerNumero(valor);
  if (!lido.ok) return false;
  return lido.valor.greaterThanOrEqualTo(min) && lido.valor.lessThanOrEqualTo(max);
}

const PESO: Record<Nivel, number> = { baixo: 1, medio: 2, alto: 3 };

/** O maior nível de uma lista (null quando não há nenhum). */
export function maiorNivel(niveis: (Nivel | null)[]): Nivel | null {
  return niveis.reduce<Nivel | null>(
    (maior, n) => (n && (!maior || PESO[n] > PESO[maior]) ? n : maior),
    null,
  );
}

/** O que a etapa recolhida mostra: maior nível, soma dos riscos, quantos checks pedem aprovação e quantos vieram com alerta. */
export function resumoDaEtapa(fases: { nivel: Nivel | null; riscos: number; checks: EstadoCheck[] }[]): {
  nivel: Nivel | null;
  riscos: number;
  aprovar: number;
  alerta: number;
} {
  const checks = fases.flatMap((f) => f.checks);
  return {
    nivel: maiorNivel(fases.map((f) => f.nivel)),
    riscos: fases.reduce((soma, f) => soma + f.riscos, 0),
    aprovar: checks.filter((e) => e === "aprovar").length,
    alerta: checks.filter((e) => e === "alerta").length,
  };
}
