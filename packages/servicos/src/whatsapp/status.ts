import { atualizarStatusEntrega, schema, withTenant } from "@canteirocheck/db";
import type { StatusWebhook } from "@canteirocheck/whatsapp";
import { and, eq } from "drizzle-orm";

const { eventoCusto, mensagemWhatsapp, checkEnvio } = schema;

/** Status da Cloud API → `check_envio.entrega`. */
const ENTREGA: Record<string, "enviado" | "entregue" | "lido" | "falhou"> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
};
const ORDEM_DA_ENTREGA = ["enviado", "entregue", "lido"];

/**
 * Preço por mensagem entregue, por categoria (USD). ESTIMATIVA: a Meta cobra por mensagem desde
 * 01/07/2025 e muda valores e faixas por país; confira a tabela oficial e sobrescreva com
 * `WHATSAPP_PRECOS_USD='{"utility":"0.0080",...}'`. O painel mostra o total como estimado.
 */
const PRECOS_PADRAO_USD: Record<string, string> = {
  utility: "0.0080",
  marketing: "0.0625",
  authentication: "0.0080",
  service: "0.0080",
};

function precos(): Record<string, string> {
  try {
    return {
      ...PRECOS_PADRAO_USD,
      ...(JSON.parse(process.env.WHATSAPP_PRECOS_USD ?? "{}") as Record<string, string>),
    };
  } catch {
    return PRECOS_PADRAO_USD;
  }
}

/**
 * Status do webhook → mensagem de saída + custo. Cobrança: `pricing.type === "regular"`
 * (docs/referencia-meta-whatsapp.md §5.6). Um evento de custo por wamid, mesmo que
 * `sent` e `delivered` tragam `pricing`.
 */
export async function registrarStatus(s: StatusWebhook): Promise<{ custo: boolean }> {
  const erro = s.errors?.length ? s.errors : undefined;
  const alvo = await atualizarStatusEntrega(s.id, s.status, erro);
  const entrega = ENTREGA[s.status];
  if (alvo?.tenantId && entrega) {
    // A primeira pergunta do check: o envio copia a entrega dela (sem voltar de lido para entregue).
    await withTenant(alvo.tenantId, async (tx) => {
      const [e] = await tx
        .select({ id: checkEnvio.id, entrega: checkEnvio.entrega })
        .from(checkEnvio)
        .where(eq(checkEnvio.mensagemId, alvo.mensagemId));
      if (!e) return;
      const regride =
        entrega !== "falhou" && ORDEM_DA_ENTREGA.indexOf(entrega) < ORDEM_DA_ENTREGA.indexOf(e.entrega ?? "");
      if (regride) return;
      await tx
        .update(checkEnvio)
        .set({ entrega, ...(entrega === "lido" ? { lidoEm: new Date() } : {}) })
        .where(eq(checkEnvio.id, e.id));
    });
  }
  if (!alvo?.tenantId || s.pricing?.type !== "regular") return { custo: false };
  const categoria = s.pricing.category ?? "utility";
  const tenantId = alvo.tenantId;

  return withTenant(tenantId, async (tx) => {
    const [jaTem] = await tx
      .select({ id: eventoCusto.id })
      .from(eventoCusto)
      .where(and(eq(eventoCusto.referencia, s.id)))
      .limit(1);
    if (jaTem) return { custo: false };
    const [m] = await tx
      .select({ obraId: mensagemWhatsapp.obraId, tipo: mensagemWhatsapp.tipo })
      .from(mensagemWhatsapp)
      .where(eq(mensagemWhatsapp.id, alvo.mensagemId));
    await tx.insert(eventoCusto).values({
      tenantId,
      obraId: m?.obraId ?? null,
      tipo: m?.tipo === "template" ? "whatsapp_template" : "whatsapp_servico",
      quantidade: "1",
      custoEstimado: precos()[categoria] ?? "0",
      moeda: "USD",
      referencia: s.id,
    });
    return { custo: true };
  });
}
