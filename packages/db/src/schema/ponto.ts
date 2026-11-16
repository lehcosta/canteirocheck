import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  criadoEm,
  grandeza,
  id,
  isolamentoTenant,
  medida,
  origemPonto,
  statusRevisao,
  unidade,
} from "./comum";
import { etapa, local, obra } from "./obra";
import { projeto } from "./projeto";
import { colunaTenantId, usuario } from "./tenant";

export const pontoControle = pgTable(
  "ponto_controle",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    etapaId: integer("etapa_id")
      .notNull()
      .references(() => etapa.id),
    localId: uuid("local_id")
      .notNull()
      .references(() => local.id),
    regiao: text("regiao"), // agrupamento no Flow: "Laje L4 — eixos A a D"
    descricao: text("descricao").notNull(),
    grandeza: grandeza("grandeza").notNull(),
    valorEsperado: medida("valor_esperado"), // null só para "existencia"
    unidade: unidade("unidade").notNull(),
    toleranciaMais: medida("tolerancia_mais"),
    toleranciaMenos: medida("tolerancia_menos"),
    ehInterface: boolean("eh_interface").notNull().default(false),
    localReferenciaId: uuid("local_referencia_id").references(() => local.id), // interface: lado já executado
    referenciaNivel: text("referencia_nivel"), // RN usada
    exigeFoto: boolean("exige_foto").notNull().default(false),
    origem: origemPonto("origem").notNull(),
    statusRevisao: statusRevisao("status_revisao").notNull().default("sugerido"),
    projetoId: uuid("projeto_id").references(() => projeto.id),
    trechoOrigem: text("trecho_origem"),
    revisadoPorId: uuid("revisado_por_id").references(() => usuario.id),
    revisadoEm: timestamp("revisado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [
    index("ponto_controle_checklist_idx").on(t.tenantId, t.obraId, t.etapaId, t.localId, t.statusRevisao),
    check(
      "valor_esperado_conforme_grandeza",
      sql`(${t.grandeza} = 'existencia') = (${t.valorEsperado} is null)`,
    ),
    check(
      "tolerancias_nao_negativas",
      sql`coalesce(${t.toleranciaMais}, 0) >= 0 and coalesce(${t.toleranciaMenos}, 0) >= 0`,
    ),
    check("interface_tem_referencia", sql`not ${t.ehInterface} or ${t.localReferenciaId} is not null`),
    check("ia_cita_origem", sql`${t.origem} <> 'ia' or ${t.trechoOrigem} is not null`),
    isolamentoTenant(),
  ],
);
