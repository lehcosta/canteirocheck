import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 do corpo CRU com o App Secret.
 * Calcule sobre os bytes recebidos, antes de qualquer JSON.parse.
 */
export function assinarCorpo(corpo: string | Uint8Array, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(corpo).digest("hex")}`;
}

export function assinaturaValida(
  corpo: string | Uint8Array,
  cabecalho: string | null,
  appSecret: string,
): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from(assinarCorpo(corpo, appSecret));
  const recebido = Buffer.from(cabecalho);
  // timingSafeEqual exige o mesmo tamanho; tamanho diferente já é inválido.
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
