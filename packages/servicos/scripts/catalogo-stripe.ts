/**
 * Cria no Stripe (idempotente) os produtos e preços do catálogo e a configuração do portal.
 * Os preços são achados pela `lookup_key` (prumo_<plano>_<mensal|anual>); rodar de novo não duplica.
 *   pnpm --filter @canteirocheck/servicos stripe:catalogo
 */
import { CATALOGO, chavePreco, PERIODICIDADES, PLANOS_PAGOS } from "@canteirocheck/core";
import Stripe from "stripe";

const chave = process.env.STRIPE_SECRET_KEY;
if (!chave) {
  console.error("Defina STRIPE_SECRET_KEY no .env");
  process.exit(1);
}
if (chave.startsWith("sk_live_") && process.argv[2] !== "--producao") {
  console.error("Chave de produção: rode com --producao se é isso mesmo.");
  process.exit(1);
}
const stripe = new Stripe(chave);

const precosDoPortal: { product: string; prices: string[] }[] = [];
for (const id of PLANOS_PAGOS) {
  const plano = CATALOGO[id];
  const chaves = PERIODICIDADES.map((p) => chavePreco(id, p));
  const existentes = await stripe.prices.list({
    lookup_keys: chaves,
    active: true,
    expand: ["data.product"],
  });
  let produto = existentes.data.map((p) => p.product as Stripe.Product).find((p) => p.active)?.id;
  if (!produto) {
    const busca = await stripe.products.search({ query: `metadata['plano']:'${id}' AND active:'true'` });
    produto =
      busca.data[0]?.id ??
      (
        await stripe.products.create({
          name: `EngCheck ${plano.nome}`,
          description: `Até ${plano.limiteObras} obras ativas`,
          metadata: { plano: id },
        })
      ).id;
  }
  const ids: string[] = [];
  for (const periodicidade of PERIODICIDADES) {
    const lookup = chavePreco(id, periodicidade);
    const valor = plano.centavos[periodicidade];
    const atual = existentes.data.find((p) => p.lookup_key === lookup);
    if (atual && atual.unit_amount === valor && atual.currency === "brl") {
      ids.push(atual.id);
      console.log(`= ${lookup} ${atual.id}`);
      continue;
    }
    // Preço mudou no catálogo: cria outro e passa a lookup_key para ele (o antigo segue nas assinaturas que já tem).
    const novo = await stripe.prices.create({
      product: produto,
      currency: "brl",
      unit_amount: valor,
      recurring: { interval: periodicidade === "anual" ? "year" : "month" },
      lookup_key: lookup,
      transfer_lookup_key: true,
      metadata: { plano: id, periodicidade },
    });
    ids.push(novo.id);
    console.log(`+ ${lookup} ${novo.id}`);
  }
  precosDoPortal.push({ product: produto, prices: ids });
}

const recursos: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: "at_period_end" },
  subscription_update: {
    enabled: true,
    default_allowed_updates: ["price"],
    proration_behavior: "create_prorations",
    products: precosDoPortal,
  },
};
const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
const existente = configs.data.find((c) => c.metadata?.prumo === "portal");
if (existente) {
  await stripe.billingPortal.configurations.update(existente.id, { features: recursos });
  console.log(`= portal ${existente.id} (atualizado)`);
} else {
  const c = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "EngCheck — assinatura" },
    features: recursos,
    metadata: { prumo: "portal" },
  });
  console.log(`+ portal ${c.id}`);
}
