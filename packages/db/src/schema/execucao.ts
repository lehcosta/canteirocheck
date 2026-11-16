import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { canal, criadoEm, decisao, id, isolamentoTenant, medida, statusExecucao, unidade } from "./comum";
import { etapa, local, obra } from "./obra";
import { pontoControle } from "./ponto";
import { colunaTenantId, usuario } from "./tenant";

export const execucaoEtapa = pgTable(
  "execucao_etapa",
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
    dataPrevista: date("data_prevista", { mode: "string" }).notNull(),
    anunciadaPorId: uuid("anunciada_por_id")
      .notNull()
      .references(() => usuario.id),
    status: statusExecucao("status").notNull().default("anunciada"),
    rodadaAtual: integer("rodada_atual").notNull().default(1), // +1 a cada reconferência após recusa
    versao: integer("versao").notNull().default(0), // lock otimista nas transições
    criadoEm: criadoEm(),
  },
  (t) => [
    index().on(t.tenantId, t.obraId, t.status),
    // no máximo uma execução em aberto por etapa × local
    uniqueIndex("execucao_aberta_unica")
      .on(t.localId, t.etapaId)
      .where(sql`${t.status} not in ('liberada', 'cancelada')`),
    isolamentoTenant(),
  ],
);

/** Append-only (sem grant de UPDATE/DELETE + trigger). Correção = nova tentativa ou nova rodada. */
export const verificacao = pgTable(
  "verificacao",
  {
    id: id(),
    tenantId: colunaTenantId(),
    execucaoId: uuid("execucao_id")
      .notNull()
      .references(() => execucaoEtapa.id),
    pontoId: uuid("ponto_id")
      .notNull()
      .references(() => pontoControle.id),
    rodada: integer("rodada").notNull().default(1),
    tentativa: integer("tentativa").notNull().default(1),
    valorMedido: medida("valor_medido"),
    valorReferencia: medida("valor_referencia"), // interface: lado já executado
    mesmaReferenciaNivel: boolean("mesma_referencia_nivel"),
    diferenca: medida("diferenca"), // interface: novo − referência
    unidade: unidade("unidade").notNull(),
    dentroTolerancia: boolean("dentro_tolerancia").notNull(), // calculado pelo core, nunca pela IA
    observacao: text("observacao"),
    canal: canal("canal").notNull(),
    estruturada: boolean("estruturada").notNull().default(true),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    flowToken: text("flow_token"),
    geo: jsonb("geo"),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.execucaoId, t.pontoId, t.rodada, t.tentativa),
    check("rodada_tentativa_positivas", sql`${t.rodada} >= 1 and ${t.tentativa} >= 1`),
    index().on(t.tenantId),
    isolamentoTenant(),
  ],
);

/** Divergência confirmada (2ª medida fora): causa + foto. Append-only. */
export const divergencia = pgTable(
  "divergencia",
  {
    id: id(),
    tenantId: colunaTenantId(),
    execucaoId: uuid("execucao_id")
      .notNull()
      .references(() => execucaoEtapa.id),
    verificacaoId: uuid("verificacao_id")
      .notNull()
      .unique()
      .references(() => verificacao.id),
    causaProvavel: text("causa_provavel").notNull(),
    descricao: text("descricao"),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId), isolamentoTenant()],
);

/** Append-only. Nova decisão = nova linha (uma por rodada). */
export const liberacao = pgTable(
  "liberacao",
  {
    id: id(),
    tenantId: colunaTenantId(),
    execucaoId: uuid("execucao_id")
      .notNull()
      .references(() => execucaoEtapa.id),
    rodada: integer("rodada").notNull(),
    decisao: decisao("decisao").notNull(),
    justificativa: text("justificativa"),
    engenheiroId: uuid("engenheiro_id")
      .notNull()
      .references(() => usuario.id),
    canal: canal("canal").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.execucaoId, t.rodada),
    check(
      "recusa_exige_justificativa",
      sql`${t.decisao} <> 'recusada' or length(trim(coalesce(${t.justificativa}, ''))) > 0`,
    ),
    index().on(t.tenantId, t.execucaoId),
    isolamentoTenant(),
  ],
);
