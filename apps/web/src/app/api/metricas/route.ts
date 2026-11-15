import { timingSafeEqual } from "node:crypto";
import { exporMetricas } from "@canteirocheck/servicos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prometheus. Exige `Authorization: Bearer $METRICAS_TOKEN`; sem token configurado, fica desligado. */
export async function GET(request: Request) {
  const esperado = process.env.METRICAS_TOKEN;
  if (!esperado) return new Response("métricas desligadas", { status: 404 });
  const recebido = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const alvo = Buffer.from(esperado);
  if (recebido.length !== alvo.length || !timingSafeEqual(recebido, alvo))
    return new Response("não autorizado", { status: 401 });
  return new Response(await exporMetricas(), { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
