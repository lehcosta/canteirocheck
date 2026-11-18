import { receberWebhookStripe } from "@canteirocheck/servicos";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE = 512 * 1024;

/** Corpo CRU (a assinatura do Stripe é sobre os bytes exatos) → lê a assinatura no Stripe e grava. */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > LIMITE)
    return new Response("grande demais", { status: 413 });
  const corpo = await request.text();
  if (corpo.length > LIMITE) return new Response("grande demais", { status: 413 });
  const r = await receberWebhookStripe(corpo, request.headers.get("stripe-signature"), stripe);
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": "text/plain" } });
}
