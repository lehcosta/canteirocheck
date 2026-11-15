import { schema, withTenant } from "@canteirocheck/db";
import { chaveDoTenant, gravarObjeto, urlDeLeitura } from "@canteirocheck/storage";
import { type ClienteWhatsapp, clienteWhatsapp } from "@canteirocheck/whatsapp";
import { decifrarMidiaDoFlow, type MetadadosCifraMidia } from "@canteirocheck/whatsapp/transporte";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { Contexto } from "./contexto";
import { uuid } from "./validacao";

const { midia } = schema;

const TIPOS_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const LADO_MAXIMO = 2560;

/**
 * Mídia vinda do WhatsApp é não confiável: confere tamanho e tipo e RECODIFICA a imagem (sharp)
 * antes de guardar — o arquivo gravado é um JPEG gerado por nós, sem EXIF nem payload escondido.
 */
async function normalizarImagem(dados: Uint8Array): Promise<Buffer> {
  return sharp(dados, { failOn: "error", limitInputPixels: 50_000_000 })
    .rotate() // aplica a orientação do EXIF antes de descartá-lo
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/** Job `baixar_midia`: CDN do Flow (cifrado) ou media id do chat → bucket privado. */
export async function baixarMidia(
  tenantId: string,
  midiaId: string,
  cliente: ClienteWhatsapp = clienteWhatsapp(),
): Promise<{ status: "armazenada" | "ignorada" | "falhou"; motivo?: string }> {
  const [m] = await withTenant(tenantId, (tx) => tx.select().from(midia).where(eq(midia.id, midiaId)));
  if (m?.status !== "pendente") return { status: "ignorada", motivo: m?.status ?? "não encontrada" };

  // Download e decifragem fora da transação (rede); a gravação volta para dentro.
  let bruto: Uint8Array;
  const fonte = (m.fonte ?? {}) as {
    cdn_url?: string;
    encryption_metadata?: MetadadosCifraMidia;
    media_id?: string;
    file_name?: string;
  };
  try {
    if (m.origem === "flow_cdn") {
      if (!fonte.cdn_url || !fonte.encryption_metadata) throw new Error("fonte do Flow incompleta");
      bruto = decifrarMidiaDoFlow(await cliente.baixarCdn(fonte.cdn_url), fonte.encryption_metadata);
    } else if (m.origem === "whatsapp_media") {
      if (!fonte.media_id) throw new Error("media id ausente");
      const r = await cliente.baixarMidia(fonte.media_id);
      if (!TIPOS_IMAGEM.has(r.mimeType.split(";")[0] ?? ""))
        throw new Error(`tipo não aceito: ${r.mimeType}`);
      bruto = r.dados;
    } else {
      return { status: "ignorada", motivo: m.origem };
    }
  } catch (e) {
    // Falha definitiva de integridade (hash/HMAC) não melhora com retry.
    const definitiva = e instanceof Error && /hash|HMAC|tipo não aceito|incompleta/.test(e.message);
    if (!definitiva) throw e;
    await withTenant(tenantId, (tx) =>
      tx
        .update(midia)
        .set({ status: "falhou", fonte: { erro: e.message, file_name: fonte.file_name } })
        .where(eq(midia.id, midiaId)),
    );
    return { status: "falhou", motivo: e.message };
  }

  let jpeg: Buffer;
  try {
    jpeg = await normalizarImagem(bruto);
  } catch (e) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(midia)
        .set({ status: "falhou", fonte: { erro: "imagem inválida", file_name: fonte.file_name } })
        .where(eq(midia.id, midiaId)),
    );
    return { status: "falhou", motivo: e instanceof Error ? e.message : "imagem inválida" };
  }
  const chave = chaveDoTenant(tenantId, "midias", `${midiaId}.jpg`);
  const { sha256 } = await gravarObjeto(chave, jpeg, "image/jpeg");
  await withTenant(tenantId, (tx) =>
    tx
      .update(midia)
      .set({
        status: "armazenada",
        storageKey: chave,
        sha256,
        mimeType: "image/jpeg",
        tamanhoBytes: jpeg.length,
        fonte: { file_name: fonte.file_name ?? null }, // as chaves do CDN não ficam guardadas
      })
      .where(eq(midia.id, midiaId)),
  );
  return { status: "armazenada" };
}

/** Painel: URL assinada de 5 min, só se a mídia é do tenant da sessão (RLS). */
export async function urlDaMidia(ctx: Contexto, midiaId: string): Promise<string | null> {
  if (!uuid.safeParse(midiaId).success) return null;
  const [m] = await withTenant(ctx.tenantId, (tx) => tx.select().from(midia).where(eq(midia.id, midiaId)));
  if (!m?.storageKey || m.status !== "armazenada") return null;
  return urlDeLeitura(m.storageKey, `${midiaId}.jpg`);
}
