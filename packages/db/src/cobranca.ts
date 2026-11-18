import { and, eq, isNull } from "drizzle-orm";
import { comoSistema } from "./interno/como-sistema";
import { tenant } from "./schema/tenant";

/**
 * Escritas da cobrança (Stripe) em `tenant`. O app não tem UPDATE em tenant; só estas funções,
 * com o papel de sistema, gravam. O webhook chega sem tenant: acha a construtora pelo cliente do Stripe.
 */

/** Guarda o cliente do Stripe da construtora. Se já havia um, devolve o que estava (corrida de dois cliques). */
export async function vincularClienteStripe(tenantId: string, customerId: string): Promise<string> {
  return comoSistema(async (tx) => {
    await tx
      .update(tenant)
      .set({ stripeCustomerId: customerId })
      .where(and(eq(tenant.id, tenantId), isNull(tenant.stripeCustomerId)));
    const [t] = await tx
      .select({ customerId: tenant.stripeCustomerId })
      .from(tenant)
      .where(eq(tenant.id, tenantId));
    if (!t?.customerId) throw new Error(`tenant ${tenantId} não encontrado`);
    return t.customerId;
  });
}

export interface EstadoAssinatura {
  customerId: string;
  subscriptionId: string;
  plano: string;
  periodicidade: string;
  /** Como o Stripe manda: active, trialing, past_due, canceled, unpaid, incomplete… */
  status: string;
  fimPeriodo: Date | null;
  cancelaNoFim: boolean;
  /** Quando o Stripe produziu este estado (evento ou leitura). Estado mais velho que o gravado é ignorado. */
  em: Date;
}

export type ResultadoAssinatura = "aplicada" | "cliente_desconhecido" | "antiga" | "outra_assinatura";

/**
 * Aplica o estado da assinatura na construtora dona do cliente do Stripe. Idempotente: repetir o
 * mesmo estado não muda nada, e estado mais antigo que o gravado não sobrescreve o novo.
 */
export async function aplicarAssinatura(e: EstadoAssinatura): Promise<ResultadoAssinatura> {
  return comoSistema(async (tx) => {
    const [t] = await tx
      .select({
        id: tenant.id,
        subscriptionId: tenant.stripeSubscriptionId,
        status: tenant.assinaturaStatus,
        em: tenant.assinaturaAtualizadaEm,
      })
      .from(tenant)
      .where(eq(tenant.stripeCustomerId, e.customerId))
      .for("update");
    if (!t) return "cliente_desconhecido";
    if (t.em && e.em < t.em) return "antiga";
    // Uma assinatura velha que encerra não derruba a atual. Mesma lista de STATUS_QUE_VALEM (core).
    const atualValendo = t.status && ["active", "trialing", "past_due"].includes(t.status);
    if (t.subscriptionId && t.subscriptionId !== e.subscriptionId && atualValendo) {
      if (!["active", "trialing", "past_due"].includes(e.status)) return "outra_assinatura";
    }
    await tx
      .update(tenant)
      .set({
        plano: e.plano,
        stripeSubscriptionId: e.subscriptionId,
        assinaturaStatus: e.status,
        assinaturaPeriodicidade: e.periodicidade,
        assinaturaFimPeriodo: e.fimPeriodo,
        assinaturaCancelaNoFim: e.cancelaNoFim,
        assinaturaAtualizadaEm: e.em,
      })
      .where(eq(tenant.id, t.id));
    return "aplicada";
  });
}
