/**
 * Utilitários de teste de integração (Postgres real). Só para vitest.
 * Prepara o banco de teste como DONO e aponta DATABASE_URL para o usuário de RUNTIME,
 * para que os testes exercitem o mesmo caminho do app (RLS de verdade).
 */
import { comDono, migrar, resetarBanco, semearEtapas } from "./plataforma";

export { comDono, criarTenantComAdmin, type DbDono } from "./plataforma";
export { SEED, semearCenario } from "./seed";

export function urlsDeTeste() {
  const runtime = process.env.DATABASE_URL_TEST;
  const dono = process.env.DATABASE_URL_TEST_MIGRATOR;
  if (!runtime || !dono) throw new Error("Defina DATABASE_URL_TEST e DATABASE_URL_TEST_MIGRATOR");
  return { runtime, dono };
}

/** globalSetup do vitest: banco limpo + migrations + catálogo. */
export async function prepararBancoDeTeste(): Promise<void> {
  const { dono } = urlsDeTeste();
  await resetarBanco(dono);
  await migrar(dono);
  await comDono(dono, semearEtapas);
}

/** setupFiles do vitest: o runtime dos testes usa o usuário de app (sujeito a RLS). */
export function apontarRuntimeParaTeste(): void {
  process.env.DATABASE_URL = urlsDeTeste().runtime;
}
