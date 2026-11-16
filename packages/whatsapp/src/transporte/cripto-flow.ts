import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Criptografia do endpoint de Flows (doc da Meta: "Implementing your Flow endpoint").
 *
 * Pedido: `encrypted_aes_key` (chave AES-128 cifrada com RSA-OAEP/SHA-256 usando a NOSSA chave
 * pública), `encrypted_flow_data` (AES-128-GCM, tag de 16 bytes no fim) e `initial_vector`.
 * Resposta: o JSON cifrado com a mesma chave AES e o IV INVERTIDO (cada byte XOR 0xFF),
 * em base64 (cifra + tag), como texto puro.
 */

const TAG = 16;

export interface PedidoCifrado {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface PedidoDecifrado<T = unknown> {
  corpo: T;
  chaveAes: Buffer;
  iv: Buffer;
}

export class FalhaDecifrar extends Error {
  constructor(mensagem: string, options?: { cause?: unknown }) {
    super(mensagem, options);
    this.name = "FalhaDecifrar";
  }
}

export function carregarChavePrivada(pem: string, senha?: string): KeyObject {
  return createPrivateKey(
    senha ? { key: pem, format: "pem", passphrase: senha } : { key: pem, format: "pem" },
  );
}

export function chavePublicaPem(privada: KeyObject): string {
  return createPublicKey(privada).export({ type: "spki", format: "pem" }).toString();
}

function inverterIv(iv: Buffer): Buffer {
  return Buffer.from(iv.map((b) => b ^ 0xff));
}

/** Lado do servidor: decifra o pedido. Falha → o endpoint deve responder HTTP 421. */
export function decifrarPedido<T = unknown>(
  pedido: PedidoCifrado,
  chavePrivada: KeyObject,
): PedidoDecifrado<T> {
  try {
    const chaveAes = privateDecrypt(
      { key: chavePrivada, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(pedido.encrypted_aes_key, "base64"),
    );
    const iv = Buffer.from(pedido.initial_vector, "base64");
    const dados = Buffer.from(pedido.encrypted_flow_data, "base64");
    const decifrador = createDecipheriv(`aes-${chaveAes.length * 8}-gcm`, chaveAes, iv) as ReturnType<
      typeof createDecipheriv
    > & { setAuthTag(tag: Buffer): void };
    decifrador.setAuthTag(dados.subarray(dados.length - TAG));
    const claro = Buffer.concat([
      decifrador.update(dados.subarray(0, dados.length - TAG)),
      decifrador.final(),
    ]);
    return { corpo: JSON.parse(claro.toString("utf8")) as T, chaveAes, iv };
  } catch (e) {
    throw new FalhaDecifrar("não foi possível decifrar o pedido do Flow", { cause: e });
  }
}

/** Lado do servidor: cifra a resposta (base64) com a chave do pedido e o IV invertido. */
export function cifrarResposta(resposta: unknown, chaveAes: Buffer, iv: Buffer): string {
  const cifrador = createCipheriv(`aes-${chaveAes.length * 8}-gcm`, chaveAes, inverterIv(iv)) as ReturnType<
    typeof createCipheriv
  > & { getAuthTag(): Buffer };
  const cifra = Buffer.concat([cifrador.update(JSON.stringify(resposta), "utf8"), cifrador.final()]);
  return Buffer.concat([cifra, cifrador.getAuthTag()]).toString("base64");
}

// ─────────────────────────── Lado da Meta (testes e simulador) ───────────────────────────

/** Faz o papel do WhatsApp: cifra um pedido para o endpoint com a chave pública do negócio. */
export function cifrarPedidoComoMeta(
  corpo: unknown,
  chavePublica: KeyObject | string,
): { pedido: PedidoCifrado; chaveAes: Buffer; iv: Buffer } {
  const chaveAes = randomBytes(16);
  const iv = randomBytes(16);
  const cifrador = createCipheriv("aes-128-gcm", chaveAes, iv);
  const cifra = Buffer.concat([cifrador.update(JSON.stringify(corpo), "utf8"), cifrador.final()]);
  const pedido: PedidoCifrado = {
    encrypted_flow_data: Buffer.concat([cifra, cifrador.getAuthTag()]).toString("base64"),
    encrypted_aes_key: publicEncrypt(
      { key: chavePublica, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      chaveAes,
    ).toString("base64"),
    initial_vector: iv.toString("base64"),
  };
  return { pedido, chaveAes, iv };
}

/** Faz o papel do WhatsApp: decifra a resposta do endpoint. */
export function decifrarRespostaComoMeta<T = unknown>(base64: string, chaveAes: Buffer, iv: Buffer): T {
  const dados = Buffer.from(base64, "base64");
  const decifrador = createDecipheriv("aes-128-gcm", chaveAes, inverterIv(iv));
  decifrador.setAuthTag(dados.subarray(dados.length - TAG));
  const claro = Buffer.concat([decifrador.update(dados.subarray(0, dados.length - TAG)), decifrador.final()]);
  return JSON.parse(claro.toString("utf8")) as T;
}

// ─────────────────────────── Mídia do Flow (PhotoPicker) ───────────────────────────

/**
 * No `data_exchange`, cada foto chega como `cdn_url` + `encryption_metadata`. O arquivo no CDN é
 * AES-256-CBC(plaintext) || HMAC-SHA256(hmac_key, iv || cifra)[0..10].
 */
export interface MetadadosCifraMidia {
  encrypted_hash: string;
  iv: string;
  encryption_key: string;
  hmac_key: string;
  plaintext_hash: string;
}

const HMAC_TRUNCADO = 10;

function iguais(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decifrarMidiaDoFlow(arquivoCdn: Uint8Array, meta: MetadadosCifraMidia): Buffer {
  const cdn = Buffer.from(arquivoCdn);
  if (!iguais(createHash("sha256").update(cdn).digest(), Buffer.from(meta.encrypted_hash, "base64"))) {
    throw new FalhaDecifrar("hash do arquivo cifrado não confere");
  }
  const iv = Buffer.from(meta.iv, "base64");
  const cifra = cdn.subarray(0, cdn.length - HMAC_TRUNCADO);
  const hmac = cdn.subarray(cdn.length - HMAC_TRUNCADO);
  const calculado = createHmac("sha256", Buffer.from(meta.hmac_key, "base64"))
    .update(Buffer.concat([iv, cifra]))
    .digest()
    .subarray(0, HMAC_TRUNCADO);
  if (!iguais(calculado, hmac)) throw new FalhaDecifrar("HMAC da mídia não confere");

  const decifrador = createDecipheriv("aes-256-cbc", Buffer.from(meta.encryption_key, "base64"), iv);
  const claro = Buffer.concat([decifrador.update(cifra), decifrador.final()]);
  if (!iguais(createHash("sha256").update(claro).digest(), Buffer.from(meta.plaintext_hash, "base64"))) {
    throw new FalhaDecifrar("hash do arquivo decifrado não confere");
  }
  return claro;
}

/** Lado da Meta (simulador/testes): cifra uma foto como o CDN do WhatsApp entrega. */
export function cifrarMidiaComoMeta(claro: Uint8Array): { arquivoCdn: Buffer; meta: MetadadosCifraMidia } {
  const chave = randomBytes(32);
  const chaveHmac = randomBytes(32);
  const iv = randomBytes(16);
  const cifrador = createCipheriv("aes-256-cbc", chave, iv);
  const cifra = Buffer.concat([cifrador.update(claro), cifrador.final()]);
  const hmac = createHmac("sha256", chaveHmac)
    .update(Buffer.concat([iv, cifra]))
    .digest()
    .subarray(0, HMAC_TRUNCADO);
  const arquivoCdn = Buffer.concat([cifra, hmac]);
  return {
    arquivoCdn,
    meta: {
      encrypted_hash: createHash("sha256").update(arquivoCdn).digest("base64"),
      iv: iv.toString("base64"),
      encryption_key: chave.toString("base64"),
      hmac_key: chaveHmac.toString("base64"),
      plaintext_hash: createHash("sha256").update(claro).digest("base64"),
    },
  };
}
