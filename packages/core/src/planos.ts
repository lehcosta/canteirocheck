/**
 * Catálogo de planos (docs/estudo-precos.md). Preço fixo por plano, com teto de obras ativas.
 * O ano vale 10 mensalidades. `piloto` é o plano das construtoras criadas antes da cobrança:
 * sem teto e sem preço.
 */

export const PLANOS_PAGOS = ["canteiro", "construtora", "grupo"] as const;
export type PlanoPago = (typeof PLANOS_PAGOS)[number];
export type Plano = PlanoPago | "piloto";

export const PERIODICIDADES = ["mensal", "anual"] as const;
export type Periodicidade = (typeof PERIODICIDADES)[number];

export interface DefinicaoPlano {
  nome: string;
  /** Teto de obras com status `ativa`. */
  limiteObras: number;
  /** Em centavos de real. */
  centavos: Record<Periodicidade, number>;
}

export const CATALOGO: Record<PlanoPago, DefinicaoPlano> = {
  canteiro: { nome: "Canteiro", limiteObras: 2, centavos: { mensal: 3980, anual: 39800 } },
  construtora: { nome: "Construtora", limiteObras: 6, centavos: { mensal: 10740, anual: 107400 } },
  grupo: { nome: "Grupo", limiteObras: 15, centavos: { mensal: 23250, anual: 232500 } },
};

/** Situações de assinatura do Stripe que liberam o plano pago. */
export const STATUS_QUE_VALEM = ["active", "trialing", "past_due"] as const;

export const ehPlanoPago = (v: string): v is PlanoPago => (PLANOS_PAGOS as readonly string[]).includes(v);

/**
 * Teto de obras ativas. `null` = sem teto.
 * - nunca assinou (status `null`): piloto, sem teto;
 * - assinatura valendo: o teto do plano;
 * - primeiro pagamento incompleto (boleto não pago, 3DS que falhou): segue como piloto;
 * - assinatura cancelada ou não paga: nenhuma obra nova (as que existem seguem).
 */
export function limiteDeObras(plano: string, status: string | null): number | null {
  if (status === null || status === "incomplete" || status === "incomplete_expired") return null;
  if (!(STATUS_QUE_VALEM as readonly string[]).includes(status)) return 0;
  return ehPlanoPago(plano) ? CATALOGO[plano].limiteObras : null;
}

/** Chave do preço no Stripe (`lookup_key`): o app acha o preço por ela, sem id em variável de ambiente. */
export const chavePreco = (plano: PlanoPago, periodicidade: Periodicidade) =>
  `prumo_${plano}_${periodicidade}`;

/** `prumo_construtora_anual` → plano e periodicidade; `null` se a chave não é de um plano do catálogo. */
export function lerChavePreco(chave: string | null | undefined): {
  plano: PlanoPago;
  periodicidade: Periodicidade;
} | null {
  const m = /^prumo_([a-z]+)_(mensal|anual)$/.exec(chave ?? "");
  if (!m?.[1] || !m[2] || !ehPlanoPago(m[1])) return null;
  return { plano: m[1], periodicidade: m[2] as Periodicidade };
}
