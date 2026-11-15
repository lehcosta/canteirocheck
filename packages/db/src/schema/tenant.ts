import { sql } from "drizzle-orm";
import { boolean, check, pgPolicy, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import {
  appRole,
  criadoEm,
  grandeza,
  id,
  isolamentoTenant,
  medida,
  papel,
  tenantAtual,
  unidade,
} from "./comum";

export const tenant = pgTable(
  "tenant",
  {
    id: id(),
    nome: text("nome").notNull(),
    cnpj: text("cnpj").notNull().unique(),
    plano: text("plano").notNull().default("piloto"),
    criadoEm: criadoEm(),
  },
  () => [pgPolicy("tenant_proprio", { for: "select", to: appRole, using: sql`id = ${tenantAtual}` })],
);

/** Coluna `tenant_id` padrão das tabelas de cliente. */
export const colunaTenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenant.id);

export const usuario = pgTable(
  "usuario",
  {
    id: id(),
    tenantId: colunaTenantId(),
    nome: text("nome").notNull(),
    email: text("email"),
    // Único global: o número da Meta é compartilhado entre construtoras (decisão Q1 do docs/arquitetura.md).
    whatsappE164: text("whatsapp_e164").notNull().unique(),
    papel: papel("papel").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    // Só admin/engenheiro têm login no painel (Better Auth). Sem FK para não acoplar ao schema de auth.
    authUserId: text("auth_user_id").unique(),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.tenantId, t.email),
    check("whatsapp_e164_formato", sql`${t.whatsappE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("painel_exige_email", sql`${t.papel} = 'encarregado' or ${t.email} is not null`),
    isolamentoTenant(),
  ],
);

export const toleranciaPadrao = pgTable(
  "tolerancia_padrao",
  {
    id: id(),
    tenantId: colunaTenantId(),
    grandeza: grandeza("grandeza").notNull(),
    toleranciaMais: medida("tolerancia_mais").notNull(),
    toleranciaMenos: medida("tolerancia_menos").notNull(),
    unidade: unidade("unidade").notNull(),
  },
  (t) => [
    unique().on(t.tenantId, t.grandeza),
    check("tolerancia_padrao_nao_negativa", sql`${t.toleranciaMais} >= 0 and ${t.toleranciaMenos} >= 0`),
    isolamentoTenant(),
  ],
);
