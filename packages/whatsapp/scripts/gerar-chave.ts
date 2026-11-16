/**
 * Gera o par de chaves RSA-2048 do endpoint de Flows e imprime as linhas para o .env.
 * Em produção: guarde a privada no secret manager e suba a PÚBLICA na Meta com
 * `pnpm --filter @canteirocheck/whatsapp publicar -- --chave` (POST /{phone-number-id}/whatsapp_business_encryption).
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
console.log(`WHATSAPP_FLOW_PRIVATE_KEY=${Buffer.from(pem).toString("base64")}`);
console.error("\n# Chave pública (para conferência; o script de publicação a deriva da privada):");
console.error(publicKey.export({ type: "spki", format: "pem" }).toString());
