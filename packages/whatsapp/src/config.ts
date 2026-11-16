import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { carregarChavePrivada } from "./transporte/cripto-flow";

/**
 * `WHATSAPP_MODO=simulado` (padrão local): nada sai para a Meta; as mensagens vão para a caixa do
 * simulador (Redis) e o simulador chama o webhook e o endpoint do Flow com a mesma assinatura e
 * criptografia da Meta. `cloud`: Graph API de verdade e todas as credenciais são obrigatórias.
 */
const comum = {
  WHATSAPP_APP_SECRET: z.string().min(8, "WHATSAPP_APP_SECRET obrigatório"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8, "WHATSAPP_VERIFY_TOKEN obrigatório"),
  /** PEM da chave privada RSA do endpoint de Flows, em base64 (uma linha). */
  WHATSAPP_FLOW_PRIVATE_KEY: z.string().min(1, "WHATSAPP_FLOW_PRIVATE_KEY obrigatório"),
  WHATSAPP_FLOW_PRIVATE_KEY_SENHA: z.string().optional(),
};

const esquema = z.discriminatedUnion("WHATSAPP_MODO", [
  z.object({ WHATSAPP_MODO: z.literal("simulado"), REDIS_URL: z.string().min(1), ...comum }),
  z.object({
    WHATSAPP_MODO: z.literal("cloud"),
    WHATSAPP_TOKEN: z.string().min(1),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
    // Só o script `publicar` (Flows API) usa; o envio e o webhook não precisam.
    WHATSAPP_WABA_ID: z.string().optional(),
    WHATSAPP_APP_ID: z.string().optional(),
    WHATSAPP_GRAPH_VERSION: z.string().default("v27.0"),
    ...comum,
  }),
]);

export type ConfigWhatsapp = z.infer<typeof esquema> & { chavePrivada: KeyObject };

declare global {
  var __canteiroWhatsappConfig: ConfigWhatsapp | undefined;
}

export function configWhatsapp(env: NodeJS.ProcessEnv = process.env): ConfigWhatsapp {
  if (env === process.env && globalThis.__canteiroWhatsappConfig) return globalThis.__canteiroWhatsappConfig;
  const r = esquema.safeParse({ ...env, WHATSAPP_MODO: env.WHATSAPP_MODO || "simulado" });
  if (!r.success) {
    throw new Error(
      `Configuração do WhatsApp inválida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const pem = Buffer.from(r.data.WHATSAPP_FLOW_PRIVATE_KEY, "base64").toString("utf8");
  const config = {
    ...r.data,
    chavePrivada: carregarChavePrivada(pem, r.data.WHATSAPP_FLOW_PRIVATE_KEY_SENHA),
  };
  if (env === process.env) globalThis.__canteiroWhatsappConfig = config;
  return config;
}

/** Para testes: esquece a configuração em cache. */
export function esquecerConfigWhatsapp() {
  globalThis.__canteiroWhatsappConfig = undefined;
}
