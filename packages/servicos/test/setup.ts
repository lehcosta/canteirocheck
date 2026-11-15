import { encerrarDb } from "@canteirocheck/db";
import { apontarRuntimeParaTeste } from "@canteirocheck/db/testing";
import { afterAll } from "vitest";

apontarRuntimeParaTeste();
afterAll(async () => {
  await encerrarDb();
});
