import type Decimal from "decimal.js";
import { dec, formatarNumero, paraBanco } from "./numero";

/**
 * Comparação medido × projetado. Código determinístico: nenhuma IA neste caminho.
 * Tolerâncias e medidas estão na unidade do ponto.
 */

export type Grandeza = "nivel" | "distancia" | "prumo" | "esquadro" | "existencia";
export type Unidade = "m" | "cm" | "mm" | "booleano";

export interface PontoAvaliavel {
  grandeza: Grandeza;
  unidade: Unidade;
  valorEsperado: string | null; // null só para "existencia"
  toleranciaMais: string; // já resolvida (ponto ou padrão do tenant), ≥ 0
  toleranciaMenos: string;
  ehInterface: boolean;
}

export type EntradaMedida =
  | { tipo: "valor"; valor: Decimal }
  | { tipo: "interface"; referencia: Decimal; novo: Decimal; mesmaReferenciaNivel: boolean }
  | { tipo: "existencia"; existe: boolean };

export type MotivoReprovacao =
  | "fora_da_tolerancia" // medida simples fora de esperado ± tolerância
  | "nao_existe" // grandeza "existencia" respondida com não
  | "referencia_diferente" // interface medida com RN diferente: não dá para comparar
  | "desalinhado" // interface: lado novo − lado executado fora da tolerância
  | "fora_do_projeto"; // interface alinhada, mas o lado novo está fora do valor de projeto

export interface Avaliacao {
  dentro: boolean;
  motivo: MotivoReprovacao | null;
  /** Para gravar em `verificacao` (strings para `numeric`). */
  valorMedido: string | null;
  valorReferencia: string | null;
  mesmaReferenciaNivel: boolean | null;
  /** Simples: medido − esperado. Interface: novo − referência. */
  diferenca: string | null;
}

export class EntradaIncompativel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EntradaIncompativel";
  }
}

function dentroDaFaixa(desvio: Decimal, mais: Decimal, menos: Decimal): boolean {
  return desvio.lessThanOrEqualTo(mais) && desvio.greaterThanOrEqualTo(menos.negated());
}

export function avaliar(ponto: PontoAvaliavel, entrada: EntradaMedida): Avaliacao {
  const mais = dec(ponto.toleranciaMais);
  const menos = dec(ponto.toleranciaMenos);
  if (mais.isNegative() || menos.isNegative()) throw new EntradaIncompativel("tolerância negativa");

  if (ponto.grandeza === "existencia") {
    if (entrada.tipo !== "existencia") throw new EntradaIncompativel("ponto de existência espera sim/não");
    return {
      dentro: entrada.existe,
      motivo: entrada.existe ? null : "nao_existe",
      valorMedido: null,
      valorReferencia: null,
      mesmaReferenciaNivel: null,
      diferenca: null,
    };
  }

  if (ponto.valorEsperado === null) throw new EntradaIncompativel("ponto sem valor esperado");
  const esperado = dec(ponto.valorEsperado);

  if (ponto.ehInterface) {
    if (entrada.tipo !== "interface")
      throw new EntradaIncompativel("ponto de interface espera os dois lados");
    const diferenca = entrada.novo.minus(entrada.referencia);
    const base = {
      valorMedido: paraBanco(entrada.novo),
      valorReferencia: paraBanco(entrada.referencia),
      mesmaReferenciaNivel: entrada.mesmaReferenciaNivel,
      diferenca: paraBanco(diferenca),
    };
    // Sem a mesma referência de nível os dois números não são comparáveis.
    if (!entrada.mesmaReferenciaNivel) return { ...base, dentro: false, motivo: "referencia_diferente" };
    if (!dentroDaFaixa(diferenca, mais, menos)) return { ...base, dentro: false, motivo: "desalinhado" };
    // Alinhado com o lado executado, mas fora do projeto: o engenheiro precisa decidir.
    if (!dentroDaFaixa(entrada.novo.minus(esperado), mais, menos)) {
      return { ...base, dentro: false, motivo: "fora_do_projeto" };
    }
    return { ...base, dentro: true, motivo: null };
  }

  if (entrada.tipo !== "valor") throw new EntradaIncompativel("ponto simples espera um valor");
  const diferenca = entrada.valor.minus(esperado);
  const dentro = dentroDaFaixa(diferenca, mais, menos);
  return {
    dentro,
    motivo: dentro ? null : "fora_da_tolerancia",
    valorMedido: paraBanco(entrada.valor),
    valorReferencia: null,
    mesmaReferenciaNivel: null,
    diferenca: paraBanco(diferenca),
  };
}

// ─────────────────────────── Exibição ───────────────────────────

const ROTULO_UNIDADE: Record<Unidade, string> = { m: "m", cm: "cm", mm: "mm", booleano: "" };

/** Comprimento na unidade do ponto → texto curto. Em metros, tolerâncias saem em cm. */
export function formatarComprimento(valor: string | Decimal, unidade: Unidade, casas?: number): string {
  if (unidade === "booleano") return dec(valor).isZero() ? "não" : "sim";
  const c = casas ?? (unidade === "m" ? 3 : unidade === "cm" ? 1 : 0);
  return `${formatarNumero(valor, c)} ${ROTULO_UNIDADE[unidade]}`;
}

function formatarDesvio(valor: Decimal, unidade: Unidade): string {
  // 0,01 m → "1 cm"; 0,005 m → "0,5 cm"
  if (unidade === "m" && valor.abs().lessThan(1)) return `${formatarNumero(valor.times(100))} cm`;
  return `${formatarNumero(valor)} ${ROTULO_UNIDADE[unidade]}`;
}

/** "± 1 cm" ou "+1 cm / −0,5 cm". */
export function formatarTolerancia(
  ponto: Pick<PontoAvaliavel, "toleranciaMais" | "toleranciaMenos" | "unidade">,
) {
  const mais = dec(ponto.toleranciaMais);
  const menos = dec(ponto.toleranciaMenos);
  if (mais.equals(menos)) return `± ${formatarDesvio(mais, ponto.unidade)}`;
  return `+${formatarDesvio(mais, ponto.unidade)} / −${formatarDesvio(menos, ponto.unidade)}`;
}

/** "6,000 m ± 1 cm" — o que o encarregado vê na tela. */
export function formatarEsperado(ponto: PontoAvaliavel): string {
  if (ponto.grandeza === "existencia" || ponto.valorEsperado === null) return "deve existir";
  return `${formatarComprimento(ponto.valorEsperado, ponto.unidade)} ${formatarTolerancia(ponto)}`;
}

/** Diferença com sinal, para o resumo: "+4 cm", "−0,5 cm". */
export function formatarDiferenca(diferenca: string, unidade: Unidade): string {
  const d = dec(diferenca);
  const texto = formatarDesvio(d.abs(), unidade);
  if (d.isZero()) return texto;
  return `${d.isNegative() ? "−" : "+"}${texto}`;
}

export const TEXTO_MOTIVO: Record<MotivoReprovacao, string> = {
  fora_da_tolerancia: "fora da tolerância",
  nao_existe: "item não executado",
  referencia_diferente: "lados medidos com referências de nível diferentes",
  desalinhado: "lados desalinhados",
  fora_do_projeto: "alinhado com o lado executado, mas fora do projeto",
};

// ─────────────────────────── Unidades ───────────────────────────

const EM_METROS: Record<Exclude<Unidade, "booleano">, string> = { m: "1", cm: "0.01", mm: "0.001" };

/** Converte comprimentos entre m, cm e mm (exato, em Decimal). */
export function converter(valor: string | Decimal, de: Unidade, para: Unidade): Decimal {
  if (de === para) return dec(valor);
  if (de === "booleano" || para === "booleano")
    throw new EntradaIncompativel("unidade booleana não converte");
  return dec(valor).times(EM_METROS[de]).div(EM_METROS[para]);
}
