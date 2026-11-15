import { receberWebhook, verificarWebhook } from "@canteirocheck/servicos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta (hub.challenge). */
export function GET(request: Request) {
  const r = verificarWebhook(new URL(request.url).searchParams);
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}

/** Corpo CRU (a assinatura é sobre os bytes exatos) → grava, enfileira, 200. */
export async function POST(request: Request) {
  const corpo = await request.text();
  const r = await receberWebhook(corpo, request.headers.get("x-hub-signature-256"));
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}
