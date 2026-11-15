import { obterSaude } from "@/lib/saude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness/readiness: banco e Redis. 503 se algum falhar. */
export async function GET() {
  const s = await obterSaude();
  return Response.json(s, { status: s.ok ? 200 : 503 });
}
