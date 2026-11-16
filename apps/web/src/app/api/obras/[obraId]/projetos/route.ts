import { ErroDominio, registrarProjeto, TAMANHO_MAXIMO_PROJETO } from "@canteirocheck/servicos";
import { obterSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload de projeto (multipart). Passa pelo servidor para conferir papel, tamanho e tipo pelo
 * conteúdo antes de gravar no bucket. (Arquitetura previa presign direto ao S3; com o limite de
 * 60 MB o caminho pelo servidor é mais simples e evita CORS no bucket.)
 */
export async function POST(request: Request, { params }: { params: Promise<{ obraId: string }> }) {
  const sessao = await obterSessao();
  if (!sessao) return Response.json({ erro: "Faça login de novo." }, { status: 401 });
  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > TAMANHO_MAXIMO_PROJETO + 64 * 1024)
    return Response.json({ erro: "Arquivo acima de 60 MB." }, { status: 413 });

  const form = await request.formData();
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return Response.json({ erro: "Escolha o arquivo." }, { status: 400 });
  try {
    const r = await registrarProjeto(
      sessao.contexto,
      {
        obraId: (await params).obraId,
        disciplina: form.get("disciplina"),
        titulo: form.get("titulo"),
        codigo: form.get("codigo"),
        revisao: form.get("revisao"),
      },
      { dados: new Uint8Array(await arquivo.arrayBuffer()), nome: arquivo.name },
    );
    return Response.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroDominio)
      return Response.json({ erro: e.message }, { status: e.codigo === "permissao" ? 403 : 400 });
    console.error("[projetos] upload", e);
    return Response.json({ erro: "Não foi possível enviar. Tente de novo." }, { status: 500 });
  }
}
