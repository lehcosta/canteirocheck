import { ErroDominio, registrarCronograma, TAMANHO_MAXIMO_CRONOGRAMA } from "@canteirocheck/servicos";
import { obterSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Importação do cronograma do MS Project (multipart). Passa pelo servidor para conferir papel,
 * tamanho e tipo pelo conteúdo antes de gravar no bucket, como o upload de projeto.
 */
export async function POST(request: Request, { params }: { params: Promise<{ obraId: string }> }) {
  const sessao = await obterSessao();
  if (!sessao) return Response.json({ erro: "Faça login de novo." }, { status: 401 });
  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > TAMANHO_MAXIMO_CRONOGRAMA + 64 * 1024)
    return Response.json({ erro: "Arquivo acima de 60 MB." }, { status: 413 });

  const form = await request.formData();
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return Response.json({ erro: "Escolha o arquivo." }, { status: 400 });
  try {
    const r = await registrarCronograma(
      sessao.contexto,
      { obraId: (await params).obraId },
      { dados: new Uint8Array(await arquivo.arrayBuffer()), nome: arquivo.name },
    );
    return Response.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroDominio)
      return Response.json({ erro: e.message }, { status: e.codigo === "permissao" ? 403 : 400 });
    console.error("[cronograma] upload", e);
    return Response.json({ erro: "Não foi possível enviar. Tente de novo." }, { status: 500 });
  }
}
