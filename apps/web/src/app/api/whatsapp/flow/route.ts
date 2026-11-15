import { receberPedidoFlow } from "@canteirocheck/servicos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Endpoint de dados dos Flows: 432/421/427 ou 200 com o corpo cifrado em base64 (text/plain). */
export async function POST(request: Request) {
  const corpo = await request.text();
  const r = await receberPedidoFlow(corpo, request.headers.get("x-hub-signature-256"));
  return new Response(r.corpo, { status: r.status, headers: { "Content-Type": r.tipo } });
}
