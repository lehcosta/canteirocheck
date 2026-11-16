/**
 * Cria uma construtora com o primeiro admin (onboarding manual; cobrança fora do sistema no MVP).
 *   pnpm criar-tenant --nome "Construtora X" --cnpj 12.345.678/0001-90 \
 *     --admin-nome "Fulana" --admin-email fulana@x.com.br --admin-whatsapp +5511999999999
 */
import { parseArgs } from "node:util";
import { comDono, criarTenantComAdmin, semearEtapas } from "../plataforma";

const { values } = parseArgs({
  options: {
    nome: { type: "string" },
    cnpj: { type: "string" },
    "admin-nome": { type: "string" },
    "admin-email": { type: "string" },
    "admin-whatsapp": { type: "string" },
  },
});

const faltando = ["nome", "cnpj", "admin-nome", "admin-email", "admin-whatsapp"].filter(
  (k) => !values[k as keyof typeof values],
);
if (faltando.length > 0) {
  console.error(`Faltam: ${faltando.map((k) => `--${k}`).join(", ")}`);
  process.exit(1);
}

const r = await comDono(process.env.DATABASE_URL_MIGRATOR, async (db) => {
  await semearEtapas(db);
  return criarTenantComAdmin(db, {
    nome: values.nome as string,
    cnpj: values.cnpj as string,
    admin: {
      nome: values["admin-nome"] as string,
      email: values["admin-email"] as string,
      whatsappE164: values["admin-whatsapp"] as string,
    },
  });
});
console.log(`✓ construtora criada: tenant ${r.tenantId}, admin ${r.adminUsuarioId}`);
