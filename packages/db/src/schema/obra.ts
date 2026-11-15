import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { criadoEm, id, isolamentoTenant, papel, statusEtapaLocal, statusObra, tipoLocal } from "./comum";
import { colunaTenantId, usuario } from "./tenant";

export const obra = pgTable(
  "obra",
  {
    id: id(),
    tenantId: colunaTenantId(),
    nome: text("nome").notNull(),
    endereco: text("endereco"),
    areaM2: numeric("area_m2", { precision: 12, scale: 2 }),
    status: statusObra("status").notNull().default("ativa"),
    engenheiroResponsavelId: uuid("engenheiro_responsavel_id")
      .notNull()
      .references(() => usuario.id),
    horarioAnuncio: text("horario_anuncio").notNull().default("16:00"), // HH:mm no fuso da obra
    fusoHorario: text("fuso_horario").notNull().default("America/Sao_Paulo"),
    criadoEm: criadoEm(),
  },
  (t) => [
    index().on(t.tenantId),
    check("horario_anuncio_formato", sql`${t.horarioAnuncio} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    isolamentoTenant(),
  ],
);

export const obraMembro = pgTable(
  "obra_membro",
  {
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    papel: papel("papel").notNull(),
  },
  (t) => [primaryKey({ columns: [t.obraId, t.usuarioId] }), index().on(t.tenantId), isolamentoTenant()],
);

export const local = pgTable(
  "local",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    tipo: tipoLocal("tipo").notNull(),
    nome: text("nome").notNull(),
    paiId: uuid("pai_id").references((): AnyPgColumn => local.id),
  },
  (t) => [unique().on(t.obraId, t.tipo, t.nome), index().on(t.tenantId), isolamentoTenant()],
);

/** Catálogo global (sem tenant): forma, armacao, concretagem, drywall_1a_face, … Só leitura em runtime. */
export const etapa = pgTable("etapa", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  codigo: text("codigo").notNull().unique(),
  nome: text("nome").notNull(),
  ordem: integer("ordem").notNull(),
  pontoSemVolta: boolean("ponto_sem_volta").notNull().default(true),
});

/** "Estado da obra": status de cada etapa em cada local. Alimenta o Flow de anúncio. */
export const estadoEtapaLocal = pgTable(
  "estado_etapa_local",
  {
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    localId: uuid("local_id")
      .notNull()
      .references(() => local.id),
    etapaId: integer("etapa_id")
      .notNull()
      .references(() => etapa.id),
    status: statusEtapaLocal("status").notNull().default("nao_iniciada"),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.localId, t.etapaId] }),
    index().on(t.tenantId, t.obraId),
    isolamentoTenant(),
  ],
);
