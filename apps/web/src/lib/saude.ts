import { verificarBanco } from "@canteirocheck/db";
import { Redis } from "ioredis";

export async function obterSaude() {
  const inicio = Date.now();
  const [banco, redis] = await Promise.all([
    verificarBanco().then(
      () => true,
      () => false,
    ),
    (async () => {
      const r = new Redis(process.env.REDIS_URL ?? "", {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
      try {
        await r.connect();
        return (await r.ping()) === "PONG";
      } catch {
        return false;
      } finally {
        r.disconnect();
      }
    })(),
  ]);
  return { ok: banco && redis, banco, redis, ms: Date.now() - inicio };
}
