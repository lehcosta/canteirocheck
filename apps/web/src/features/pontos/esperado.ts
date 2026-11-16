import type { Unidade } from "@canteirocheck/core";

export interface PartesEsperado {
  /** "6,000 m" ou "sim" (ponto de existência). */
  valor: string;
  /** "± 1 cm", "+1 cm / −0,5 cm" ou null quando não se aplica. */
  tolerancia: string | null;
  /** Unidade do ponto, lida do valor; null se o texto não tiver o formato esperado. */
  unidade: Unidade | null;
}

/**
 * Separa o texto de `formatarEsperado` ("6,000 m ± 1 cm", "6,000 m +1 cm / −0,5 cm",
 * "deve existir") em valor, tolerância e unidade, para colunas separadas na tabela.
 * Só apresentação: se o formato mudar, devolve o texto inteiro como valor.
 */
export function separarEsperado(esperado: string): PartesEsperado {
  if (esperado === "deve existir") return { valor: "sim", tolerancia: null, unidade: "booleano" };
  const m = /^(.+? (m|cm|mm)) ([±+].*)$/.exec(esperado);
  if (!m?.[1] || !m[2] || !m[3]) return { valor: esperado, tolerancia: null, unidade: null };
  return { valor: m[1], tolerancia: m[3], unidade: m[2] as Unidade };
}
