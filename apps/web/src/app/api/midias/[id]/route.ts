import { urlDaMidia } from "@canteirocheck/servicos";
import { obterSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Confere a sessão e o tenant (RLS) e redireciona para uma URL assinada de 5 min. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await obterSessao();
  if (!sessao) return new Response("não autenticado", { status: 401 });
  const url = await urlDaMidia(sessao.contexto, (await params).id);
  if (!url) return new Response("não encontrada", { status: 404 });
  return Response.redirect(url, 302);
}
