import { receberPedidoFlow } from "@canteirocheck/servicos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE = 1024 * 1024;

/** Endpoint de dados dos Flows: 432/421/427 ou 200 com o corpo cifrado em base64 (text/plain). */
export async function POST(request: Request) {
  // Corpo limitado (webhook da Meta: até 3 MB; pedido de Flow: pequeno).
  if (Number(request.headers.get("content-length") ?? 0) > LIMITE)
    return new Response("grande demais", { status: 413 });
  const corpo = await request.text();
  if (corpo.length > LIMITE) return new Response("grande demais", { status: 413 });
  const r = await receberPedidoFlow(corpo, request.headers.get("x-hub-signature-256"));
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}
