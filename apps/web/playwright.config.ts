import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/** Fora do app: arquivo novo dentro de apps/web faz o Next em dev recompilar e recarregar a página. */
export const SAIDA = process.env.E2E_SAIDA ?? join(tmpdir(), "canteirocheck-e2e");

/**
 * Ponta a ponta no painel e no simulador de WhatsApp. Pré-requisito: stack local no ar
 * (`pnpm infra:up && pnpm db:reset && pnpm dev`) e BASE_URL com a URL que o `pnpm dev` imprimiu. Localmente usa o Google Chrome instalado
 * (sem baixar navegador); no CI, `npx playwright install chromium` e PW_CHANNEL vazio.
 */
/** A URL do `pnpm dev`. Com o portless: BASE_URL=$(portless get canteirocheck). */
export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: SAIDA,
  use: {
    baseURL: BASE,
    channel: process.env.PW_CHANNEL ?? "chrome",
    headless: true,
    locale: "pt-BR",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
