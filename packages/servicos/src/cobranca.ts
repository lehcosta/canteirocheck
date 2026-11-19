import {
  CATALOGO,
  chavePreco,
  lerChavePreco,
  limiteDeObras,
  PERIODICIDADES,
  PLANOS_PAGOS,
  STATUS_QUE_VALEM,
} from "@canteirocheck/core";
import {
  aplicarAssinatura,
  type EstadoAssinatura,
  schema,
  vincularClienteStripe,
  withTenant,
} from "@canteirocheck/db";
import { and, count, eq } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { type Contexto, ErroDominio, exigirPapel } from "./contexto";

const { tenant, obra } = schema;

/** Cliente do Stripe; `null` quando a chave não está configurada (a cobrança fica desligada). */
export function criarStripe(chave = process.env.STRIPE_SECRET_KEY): Stripe | null {
  return chave ? new Stripe(chave) : null;
}

const SEM_COBRANCA = "A cobrança ainda não está configurada. Fale com a EngCheck.";

// ─────────────────────────── Leitura ───────────────────────────

export interface Assinatura {
  plano: string;
  /** Status do Stripe; `null` = nunca assinou (piloto). */
  status: string | null;
  valendo: boolean;
  periodicidade: string | null;
  fimPeriodo: Date | null;
  cancelaNoFim: boolean;
  temCliente: boolean;
  obrasAtivas: number;
  /** Teto de obras ativas; `null` = sem teto. */
  limiteObras: number | null;
}

export async function obterAssinatura(ctx: Contexto): Promise<Assinatura> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [t] = await tx
      .select({
        plano: tenant.plano,
        status: tenant.assinaturaStatus,
        periodicidade: tenant.assinaturaPeriodicidade,
        fimPeriodo: tenant.assinaturaFimPeriodo,
        cancelaNoFim: tenant.assinaturaCancelaNoFim,
        customerId: tenant.stripeCustomerId,
      })
      .from(tenant)
      .where(eq(tenant.id, ctx.tenantId));
    if (!t) throw new ErroDominio("nao_encontrado", "Construtora não encontrada.");
    const [ativas] = await tx.select({ n: count() }).from(obra).where(eq(obra.status, "ativa"));
    return {
      plano: t.plano,
      status: t.status,
      valendo: t.status !== null && (STATUS_QUE_VALEM as readonly string[]).includes(t.status),
      periodicidade: t.periodicidade,
      fimPeriodo: t.fimPeriodo,
      cancelaNoFim: t.cancelaNoFim,
      temCliente: Boolean(t.customerId),
      obrasAtivas: ativas?.n ?? 0,
      limiteObras: limiteDeObras(t.plano, t.status),
    };
  });
}

// ─────────────────────────── Checkout e portal ───────────────────────────

export const entradaAssinar = z.object({
  plano: z.enum(PLANOS_PAGOS, { message: "Escolha um plano." }),
  periodicidade: z.enum(PERIODICIDADES, { message: "Escolha mensal ou anual." }).default("mensal"),
});

export interface UrlsRetorno {
  /** Pode conter `{CHECKOUT_SESSION_ID}`, que o Stripe troca pelo id da sessão. */
  sucesso: string;
  cancelamento: string;
}

/** Cliente do Stripe da construtora, criado na primeira vez. */
async function garantirCliente(ctx: Contexto, stripe: Stripe, email: string): Promise<string> {
  const t = await withTenant(ctx.tenantId, async (tx) => {
    const [linha] = await tx
      .select({ nome: tenant.nome, cnpj: tenant.cnpj, customerId: tenant.stripeCustomerId })
      .from(tenant)
      .where(eq(tenant.id, ctx.tenantId));
    return linha;
  });
  if (!t) throw new ErroDominio("nao_encontrado", "Construtora não encontrada.");
  if (t.customerId) return t.customerId;
  // A chave de idempotência evita dois clientes quando dois cliques chegam juntos.
  const cliente = await stripe.customers.create(
    { name: t.nome, email, metadata: { tenantId: ctx.tenantId, cnpj: t.cnpj } },
    { idempotencyKey: `prumo-cliente-${ctx.tenantId}` },
  );
  return vincularClienteStripe(ctx.tenantId, cliente.id);
}

/** Abre o Checkout do Stripe para o plano escolhido. Devolve a URL para onde mandar a pessoa. */
export async function iniciarAssinatura(
  ctx: Contexto,
  entrada: unknown,
  stripe: Stripe | null,
  o: { email: string; urls: UrlsRetorno },
): Promise<string> {
  exigirPapel(ctx, ["admin"]);
  if (!stripe) throw new ErroDominio("invalido", SEM_COBRANCA);
  const r = entradaAssinar.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", r.error.issues[0]?.message ?? "Escolha um plano.");
  const { plano, periodicidade } = r.data;

  const atual = await obterAssinatura(ctx);
  if (atual.valendo) {
    throw new ErroDominio(
      "conflito",
      "A construtora já tem assinatura. Troque o plano em Gerenciar assinatura.",
    );
  }

  const precos = await stripe.prices.list({ lookup_keys: [chavePreco(plano, periodicidade)], active: true });
  const preco = precos.data[0];
  if (!preco) throw new ErroDominio("invalido", SEM_COBRANCA);

  const customer = await garantirCliente(ctx, stripe, o.email);
  const sessao = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: preco.id, quantity: 1 }],
    client_reference_id: ctx.tenantId,
    subscription_data: { metadata: { tenantId: ctx.tenantId } },
    locale: "pt-BR",
    success_url: o.urls.sucesso,
    cancel_url: o.urls.cancelamento,
  });
  if (!sessao.url) throw new Error("Checkout do Stripe sem URL");
  return sessao.url;
}

/** Portal do Stripe: cartão, faturas, troca de plano e cancelamento. Devolve a URL. */
export async function abrirPortal(ctx: Contexto, stripe: Stripe | null, retorno: string): Promise<string> {
  exigirPapel(ctx, ["admin"]);
  if (!stripe) throw new ErroDominio("invalido", SEM_COBRANCA);
  const customer = await withTenant(ctx.tenantId, async (tx) => {
    const [t] = await tx
      .select({ id: tenant.stripeCustomerId })
      .from(tenant)
      .where(eq(tenant.id, ctx.tenantId));
    return t?.id;
  });
  if (!customer) throw new ErroDominio("invalido", "A construtora ainda não tem assinatura.");
  // A configuração do portal é criada pelo script do catálogo (marcada com metadata prumo=portal).
  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const configuration = configs.data.find((c) => c.metadata?.prumo === "portal")?.id;
  const sessao = await stripe.billingPortal.sessions.create({
    customer,
    return_url: retorno,
    locale: "pt-BR",
    ...(configuration ? { configuration } : {}),
  });
  return sessao.url;
}

// ─────────────────────────── Sincronização ───────────────────────────

/** Assinatura do Stripe → estado gravado na construtora. `null` se o preço não é do catálogo. */
export function estadoDaAssinatura(sub: Stripe.Subscription, em: Date): EstadoAssinatura | null {
  const item = sub.items.data[0];
  const chave = lerChavePreco(item?.price.lookup_key);
  if (!item || !chave) return null;
  return {
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    subscriptionId: sub.id,
    plano: chave.plano,
    periodicidade: chave.periodicidade,
    status: sub.status,
    fimPeriodo: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelaNoFim: sub.cancel_at_period_end || sub.cancel_at !== null,
    em,
  };
}

/** Lê a assinatura no Stripe (sempre o estado de agora, não o do evento) e grava. */
async function sincronizarAssinatura(stripe: Stripe, subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const estado = estadoDaAssinatura(sub, new Date());
  if (!estado) {
    console.warn("[cobranca] assinatura com preço fora do catálogo", subscriptionId);
    return "fora_do_catalogo" as const;
  }
  return aplicarAssinatura(estado);
}

/**
 * Volta do Checkout (`?sessao=`): grava a assinatura sem esperar o webhook. Só aceita a sessão
 * se ela for do cliente desta construtora.
 */
export async function confirmarCheckout(
  ctx: Contexto,
  stripe: Stripe | null,
  sessaoId: string,
): Promise<boolean> {
  if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessaoId)) return false;
  const sessao = await stripe.checkout.sessions.retrieve(sessaoId);
  const customer = typeof sessao.customer === "string" ? sessao.customer : sessao.customer?.id;
  const subscription =
    typeof sessao.subscription === "string" ? sessao.subscription : sessao.subscription?.id;
  if (!customer || !subscription || sessao.client_reference_id !== ctx.tenantId) return false;
  const doTenant = await withTenant(ctx.tenantId, async (tx) => {
    const [t] = await tx
      .select({ id: tenant.id })
      .from(tenant)
      .where(and(eq(tenant.id, ctx.tenantId), eq(tenant.stripeCustomerId, customer)));
    return Boolean(t);
  });
  if (!doTenant) return false;
  return (await sincronizarAssinatura(stripe, subscription)) === "aplicada";
}

// ─────────────────────────── Webhook ───────────────────────────

const EVENTOS_DE_ASSINATURA = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export interface RespostaWebhook {
  status: number;
  corpo: string;
}

/**
 * Webhook do Stripe. Corpo CRU (a assinatura é sobre os bytes exatos). Cada evento só diz qual
 * assinatura mudou: o estado é lido de novo no Stripe, então retry e ordem trocada não estragam nada.
 */
export async function receberWebhookStripe(
  corpo: string,
  assinatura: string | null,
  stripe: Stripe | null,
  segredo = process.env.STRIPE_WEBHOOK_SECRET,
): Promise<RespostaWebhook> {
  if (!stripe || !segredo) return { status: 503, corpo: "cobrança não configurada" };
  if (!assinatura) return { status: 400, corpo: "sem assinatura" };
  let evento: Stripe.Event;
  try {
    evento = stripe.webhooks.constructEvent(corpo, assinatura, segredo);
  } catch {
    return { status: 400, corpo: "assinatura inválida" };
  }

  let subscriptionId: string | null = null;
  if (evento.type === "checkout.session.completed") {
    const s = evento.data.object;
    if (s.mode === "subscription" && s.subscription) {
      subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
    }
  } else if (EVENTOS_DE_ASSINATURA.has(evento.type)) {
    subscriptionId = (evento.data.object as Stripe.Subscription).id;
  }
  if (!subscriptionId) return { status: 200, corpo: "ignorado" };

  const r = await sincronizarAssinatura(stripe, subscriptionId);
  // Cliente desconhecido: 200 mesmo assim, para o Stripe não insistir num evento de outra conta.
  return { status: 200, corpo: r };
}

/** Rótulo do plano para a tela. */
export const nomeDoPlano = (plano: string) =>
  plano in CATALOGO ? CATALOGO[plano as keyof typeof CATALOGO].nome : "Piloto";
