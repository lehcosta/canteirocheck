import { receberWebhook, verificarWebhook } from "@canteirocheck/servicos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE = 3 * 1024 * 1024 + 64 * 1024;

/** Verificação do webhook pela Meta (hub.challenge). */
export function GET(request: Request) {
  const r = verificarWebhook(new URL(request.url).searchParams);
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}

/** Corpo CRU (a assinatura é sobre os bytes exatos) → grava, enfileira, 200. */
export async function POST(request: Request) {
  // Corpo limitado (webhook da Meta: até 3 MB; pedido de Flow: pequeno).
  if (Number(request.headers.get("content-length") ?? 0) > LIMITE)
    return new Response("grande demais", { status: 413 });
  const corpo = await request.text();
  if (corpo.length > LIMITE) return new Response("grande demais", { status: 413 });
  const r = await receberWebhook(corpo, request.headers.get("x-hub-signature-256"));
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}
