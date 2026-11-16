import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { criarWorker, FilaBullMQ, FilaEmMemoria, idJob } from "../src";

process.env.QUEUE_PREFIX = `teste-${randomUUID().slice(0, 8)}`;
const fila = new FilaBullMQ();
const workers: Worker[] = [];
afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await fila.fechar();
});

describe("fila", () => {
  it("valida o payload antes de enfileirar", async () => {
    const f = new FilaEmMemoria();
    // @ts-expect-error payload incompleto
    await expect(f.enfileirar("baixar_midia", { tenantId: randomUUID() })).rejects.toThrow();
    await expect(f.enfileirar("baixar_midia", { tenantId: "x", midiaId: randomUUID() })).rejects.toThrow();
  });

  it("deduplica por jobId", async () => {
    const f = new FilaEmMemoria();
    const p = { tenantId: randomUUID(), execucaoId: randomUUID(), rodada: 1 };
    await f.enfileirar("notificar_engenheiro", p, { jobId: idJob("eng", p.execucaoId, 1) });
    await f.enfileirar("notificar_engenheiro", p, { jobId: idJob("eng", p.execucaoId, 1) });
    expect(f.doTipo("notificar_engenheiro")).toHaveLength(1);
  });

  it("BullMQ: produtor e worker com o mesmo catálogo", async () => {
    const recebido = new Promise<unknown>((resolve) => {
      workers.push(criarWorker("midia", { baixar_midia: async (payload) => resolve(payload) }));
    });
    const payload = { tenantId: randomUUID(), midiaId: randomUUID() };
    await fila.enfileirar("baixar_midia", payload, { jobId: idJob("midia", payload.midiaId) });
    expect(await recebido).toEqual(payload);
  });

  it("idJob não gera ':'", () => {
    expect(idJob("a:b", 1, "c/d")).toBe("a_b-1-c_d");
  });
});
