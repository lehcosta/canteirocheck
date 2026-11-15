import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { obterDb } from "../src/cliente";
import { itensParados, metricasPorEtapa } from "../src/sistema";

describe("endurecimento do banco", () => {
  it("statement_timeout está ligado no pool do runtime", async () => {
    const r = await obterDb().execute<{ statement_timeout: string }>(sql`show statement_timeout`);
    expect(r.rows[0]?.statement_timeout).toBe("15s");
  });

  it("varredura e métricas rodam com o papel de sistema e não vazam nada do runtime", async () => {
    expect(Array.isArray(await itensParados(0))).toBe(true);
    const m = await metricasPorEtapa();
    expect(m).toHaveProperty("execucoes");
    // o runtime, sem tenant, continua sem ver nada
    const r = await obterDb().execute<{ n: number }>(sql`select count(*)::int as n from execucao_etapa`);
    expect(r.rows[0]?.n).toBe(0);
  });
});
