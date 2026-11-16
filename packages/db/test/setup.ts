import { afterAll } from "vitest";
import { encerrarDb } from "../src/cliente";
import { apontarRuntimeParaTeste } from "../src/testing";

apontarRuntimeParaTeste();
// Uma conexão só: prova que o tenant de uma transação não vaza para a próxima.
process.env.DATABASE_POOL_MAX = "1";
afterAll(async () => {
  await encerrarDb();
});
