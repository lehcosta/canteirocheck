import { bigint, index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { atorTipo, criadoEm, id, isolamentoTenant, tipoCusto } from "./comum";
import { execucaoEtapa } from "./execucao";
import { obra } from "./obra";
import { colunaTenantId, tenant, usuario } from "./tenant";

export const eventoCusto = pgTable(
  "evento_custo",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id").references(() => obra.id),
    tipo: tipoCusto("tipo").notNull(),
    quantidade: numeric("quantidade", { precision: 14, scale: 4 }).notNull(), // mensagens, tokens, minutos
    custoEstimado: numeric("custo_estimado", { precision: 14, scale: 6 }).notNull(),
    moeda: text("moeda").notNull().default("USD"),
    referencia: text("referencia"), // job id, wa_message_id, modelo
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId, t.obraId, t.criadoEm), isolamentoTenant()],
);

export const relatorio = pgTable(
  "relatorio",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    execucaoId: uuid("execucao_id").references(() => execucaoEtapa.id),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    geradoPorId: uuid("gerado_por_id").references(() => usuario.id),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId, t.obraId), isolamentoTenant()],
);

/** Append-only (sem grant de UPDATE/DELETE + trigger que bloqueia até o dono). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").references(() => tenant.id), // null = evento de plataforma
    atorTipo: atorTipo("ator_tipo").notNull(),
    atorId: uuid("ator_id"),
    acao: text("acao").notNull(),
    entidade: text("entidade").notNull(),
    entidadeId: text("entidade_id").notNull(),
    antes: jsonb("antes"),
    depois: jsonb("depois"),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId, t.entidade, t.entidadeId), isolamentoTenant()],
);
