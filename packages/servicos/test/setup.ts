import { encerrarDb } from "@canteirocheck/db";
import { apontarRuntimeParaTeste } from "@canteirocheck/db/testing";
import { afterAll } from "vitest";

apontarRuntimeParaTeste();
// Nunca chamar IA de verdade nos testes, mesmo com chave no .env.
for (const v of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"]) delete process.env[v];
afterAll(async () => {
  await encerrarDb();
});
