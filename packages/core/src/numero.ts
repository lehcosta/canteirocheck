import Decimal from "decimal.js";

/**
 * Números de medida. Tudo em `Decimal`: 6,005 − 6,000 em float dá 0.004999…,
 * e essa diferença pode decidir uma liberação.
 */

/** O banco guarda `numeric(12,4)`: no máximo 4 casas e 8 dígitos inteiros. */
export const CASAS_MAXIMAS = 4;
const LIMITE = new Decimal("99999999");

export type ErroNumero = "vazio" | "invalido" | "casas_demais" | "grande_demais";

export type LeituraNumero = { ok: true; valor: Decimal } | { ok: false; erro: ErroNumero };

/**
 * Lê um número digitado no canteiro: "6,005", "6.005", "+6,00 m", "1.234,5", "-0,5".
 * Regras: com vírgula e ponto juntos, o último separador é o decimal; só vírgula → decimal;
 * um único ponto → decimal; vários pontos sem vírgula → milhar.
 */
export function lerNumero(texto: string): LeituraNumero {
  const limpo = texto
    .trim()
    .replace(/\s+/g, "")
    .replace(/(mm|cm|m)$/i, "");
  if (!limpo) return { ok: false, erro: "vazio" };
  if (!/^[+-]?[\d.,]+$/.test(limpo) || !/\d/.test(limpo)) return { ok: false, erro: "invalido" };

  const sinal = limpo.startsWith("-") ? "-" : "";
  const corpo = limpo.replace(/^[+-]/, "");
  const ultimaVirgula = corpo.lastIndexOf(",");
  const ultimoPonto = corpo.lastIndexOf(".");
  const pontos = (corpo.match(/\./g) ?? []).length;
  const virgulas = (corpo.match(/,/g) ?? []).length;

  let normalizado: string;
  if (virgulas > 0 && pontos > 0) {
    const decimalEhVirgula = ultimaVirgula > ultimoPonto;
    const sepDecimal = decimalEhVirgula ? "," : ".";
    const sepMilhar = decimalEhVirgula ? "." : ",";
    if ((corpo.match(new RegExp(`\\${sepDecimal}`, "g")) ?? []).length > 1) {
      return { ok: false, erro: "invalido" };
    }
    normalizado = corpo.split(sepMilhar).join("").replace(",", ".");
  } else if (virgulas > 0) {
    if (virgulas > 1) return { ok: false, erro: "invalido" };
    normalizado = corpo.replace(",", ".");
  } else if (pontos > 1) {
    normalizado = corpo.split(".").join("");
  } else {
    normalizado = corpo;
  }
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(normalizado)) return { ok: false, erro: "invalido" };

  const valor = new Decimal(`${sinal}${normalizado}`);
  if (valor.decimalPlaces() > CASAS_MAXIMAS) return { ok: false, erro: "casas_demais" };
  if (valor.abs().greaterThan(LIMITE)) return { ok: false, erro: "grande_demais" };
  return { ok: true, valor };
}

export const MENSAGEM_ERRO_NUMERO: Record<ErroNumero, string> = {
  vazio: "Informe a medida.",
  invalido: "Não entendi o número. Use, por exemplo, 6,005.",
  casas_demais: `Use no máximo ${CASAS_MAXIMAS} casas decimais.`,
  grande_demais: "Número grande demais. Confira a unidade.",
};

/** Valor do banco (`numeric` vem como string) → Decimal. */
export function dec(valor: string | number | Decimal): Decimal {
  return new Decimal(valor);
}

/** Decimal → string para gravar em `numeric(12,4)` (sem notação científica). */
export function paraBanco(valor: Decimal): string {
  return valor.toFixed();
}

/** Formato brasileiro: 6.005 → "6,005"; casas fixas opcionais. */
export function formatarNumero(valor: Decimal | string, casas?: number): string {
  const d = dec(valor);
  const texto = casas === undefined ? d.toFixed() : d.toFixed(casas);
  const [inteiro = "0", fracao] = texto.replace("-", "").split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sinal = d.isNegative() && !d.isZero() ? "−" : "";
  return `${sinal}${comMilhar}${fracao ? `,${fracao}` : ""}`;
}
