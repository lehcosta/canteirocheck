import { comDono } from "../plataforma";
import { SEED, semearCenario } from "../seed";

const r = await comDono(process.env.DATABASE_URL_MIGRATOR, semearCenario);
console.log(
  r.criado
    ? `✓ seed criado (tenant ${r.tenantId}). Entre no painel com ${SEED.admin.email} ou ${SEED.ana.email}.`
    : `= seed já existia (tenant ${r.tenantId}); nada alterado.`,
);
