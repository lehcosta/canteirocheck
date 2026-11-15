import { lerArquivoCdnSimulado } from "@canteirocheck/whatsapp/simulador";
import { ambienteDoSimulador, simuladorLigado } from "@/lib/simulador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "CDN" do simulador: entrega o arquivo CIFRADO do PhotoPicker, como o CDN do WhatsApp. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!simuladorLigado()) return new Response("não encontrado", { status: 404 });
  const arquivo = await lerArquivoCdnSimulado(ambienteDoSimulador().redis, (await params).id);
  if (!arquivo) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(arquivo), { headers: { "Content-Type": "application/octet-stream" } });
}
