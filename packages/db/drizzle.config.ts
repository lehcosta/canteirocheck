import { defineConfig } from "drizzle-kit";

// Só gera SQL a partir do schema. Quem aplica é src/scripts/migrar.ts (como canteiro_owner).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // Os papéis são criados pela infra/migration 0000 — o drizzle-kit não deve gerenciá-los.
  entities: { roles: false },
});
