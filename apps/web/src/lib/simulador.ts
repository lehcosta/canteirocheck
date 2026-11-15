import "server-only";
import { configWhatsapp, redisDoSimulador } from "@canteirocheck/whatsapp";
import { chavePublicaPem } from "@canteirocheck/whatsapp/transporte";

/** O simulador só existe com SIMULADOR_WHATSAPP=1 E modo simulado. Nunca em produção. */
export function simuladorLigado(): boolean {
  if (process.env.SIMULADOR_WHATSAPP !== "1") return false;
  try {
    return configWhatsapp().WHATSAPP_MODO === "simulado";
  } catch {
    return false;
  }
}

export function ambienteDoSimulador() {
  const cfg = configWhatsapp();
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    redis: redisDoSimulador(),
    appSecret: cfg.WHATSAPP_APP_SECRET,
    chavePublica: chavePublicaPem(cfg.chavePrivada),
    urlWebhook: `${base}/api/whatsapp/webhook`,
    urlFlow: `${base}/api/whatsapp/flow`,
    urlCdn: (id: string) => `${base}/dev/whatsapp/cdn/${id}`,
  };
}
