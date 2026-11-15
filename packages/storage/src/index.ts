import { createHash } from "node:crypto";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

/**
 * Bucket privado. O banco guarda só a chave (`tenants/{tenantId}/…`) e o sha256; URLs assinadas
 * duram minutos e nunca são gravadas.
 */

const envS3 = z.object({
  S3_ENDPOINT: z.url().optional(), // vazio = AWS
  S3_PUBLIC_ENDPOINT: z.url().optional(), // endpoint visto pelo navegador, se diferente
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
});
type EnvS3 = z.infer<typeof envS3>;

declare global {
  var __canteiroS3: { env: EnvS3; interno: S3Client; publico: S3Client } | undefined;
}

function cliente(endpoint: string | undefined, env: EnvS3) {
  return new S3Client({
    region: env.S3_REGION,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
}

function s3() {
  if (!globalThis.__canteiroS3) {
    const env = envS3.parse(process.env);
    globalThis.__canteiroS3 = {
      env,
      interno: cliente(env.S3_ENDPOINT, env),
      publico: cliente(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT, env),
    };
  }
  return globalThis.__canteiroS3;
}

export const DURACAO_URL_SEGUNDOS = 300;

const SEGMENTO = /^[A-Za-z0-9._-]+$/;

/** Chave no bucket, sempre debaixo do tenant. Rejeita segmentos com "/" ou "..". */
export function chaveDoTenant(tenantId: string, ...partes: string[]): string {
  for (const p of [tenantId, ...partes]) {
    if (!SEGMENTO.test(p) || p === "." || p === "..") throw new Error(`segmento de chave inválido: ${p}`);
  }
  return ["tenants", tenantId, ...partes].join("/");
}

export function sha256(dados: Uint8Array): string {
  return createHash("sha256").update(dados).digest("hex");
}

export async function garantirBucket(): Promise<void> {
  const { interno, env } = s3();
  try {
    await interno.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await interno.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

export async function gravarObjeto(
  chave: string,
  corpo: Uint8Array,
  tipo: string,
): Promise<{ sha256: string }> {
  const { interno, env } = s3();
  await interno.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: chave, Body: corpo, ContentType: tipo }),
  );
  return { sha256: sha256(corpo) };
}

export async function lerObjeto(chave: string): Promise<Uint8Array> {
  const { interno, env } = s3();
  const r = await interno.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: chave }));
  if (!r.Body) throw new Error(`objeto vazio: ${chave}`);
  return r.Body.transformToByteArray();
}

/** URL de leitura de curta duração (download no navegador). */
export async function urlDeLeitura(chave: string, nomeArquivo?: string): Promise<string> {
  const { publico, env } = s3();
  return getSignedUrl(
    publico,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: chave,
      ...(nomeArquivo
        ? { ResponseContentDisposition: `inline; filename="${nomeArquivo.replace(/["\\]/g, "")}"` }
        : {}),
    }),
    { expiresIn: DURACAO_URL_SEGUNDOS },
  );
}

/** URL de envio direto do navegador para o bucket (upload de projeto). */
export async function urlDeEnvio(chave: string, tipo: string): Promise<string> {
  const { publico, env } = s3();
  return getSignedUrl(
    publico,
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: chave, ContentType: tipo }),
    {
      expiresIn: DURACAO_URL_SEGUNDOS,
    },
  );
}
