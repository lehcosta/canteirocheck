import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  criadoEm,
  disciplina,
  id,
  isolamentoTenant,
  risco,
  statusExtracao,
  statusPendencia,
  tipoArquivo,
} from "./comum";
import { etapa, obra } from "./obra";
import { colunaTenantId, usuario } from "./tenant";

export const projeto = pgTable(
  "projeto",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    disciplina: disciplina("disciplina").notNull(),
    titulo: text("titulo").notNull(),
    codigo: text("codigo").notNull(),
    revisao: text("revisao").notNull(),
    tipoArquivo: tipoArquivo("tipo_arquivo").notNull(),
    arquivoKey: text("arquivo_key").notNull(), // chave no bucket, nunca URL
    arquivoSha256: text("arquivo_sha256").notNull(),
    statusExtracao: statusExtracao("status_extracao").notNull().default("pendente"),
    erroExtracao: text("erro_extracao"),
    substituidoPorId: uuid("substituido_por_id").references((): AnyPgColumn => projeto.id), // nova revisão
    enviadoPorId: uuid("enviado_por_id")
      .notNull()
      .references(() => usuario.id),
    criadoEm: criadoEm(),
  },
  (t) => [unique().on(t.obraId, t.codigo, t.revisao), index().on(t.tenantId), isolamentoTenant()],
);

export const extracaoProjeto = pgTable(
  "extracao_projeto",
  {
    id: id(),
    tenantId: colunaTenantId(),
    projetoId: uuid("projeto_id")
      .notNull()
      .unique()
      .references(() => projeto.id),
    textos: jsonb("textos").notNull(),
    camadas: jsonb("camadas").notNull(),
    blocos: jsonb("blocos").notNull(),
    cotasNivel: jsonb("cotas_nivel").notNull(),
    ambientes: jsonb("ambientes").notNull(),
    carimbo: jsonb("carimbo").notNull(),
    versaoExtrator: text("versao_extrator").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId), isolamentoTenant()],
);

export const pendencia = pgTable(
  "pendencia",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    projetoId: uuid("projeto_id")
      .notNull()
      .references(() => projeto.id),
    textoOriginal: text("texto_original").notNull(),
    etapaBloqueadaId: integer("etapa_bloqueada_id").references(() => etapa.id),
    risco: risco("risco").notNull(),
    status: statusPendencia("status").notNull().default("aberta"),
    classificadoPor: text("classificado_por").notNull(), // ex.: "claude-haiku-5-5@prompt-v3"
    resolvidaPorId: uuid("resolvida_por_id").references(() => usuario.id),
    resolvidaEm: timestamp("resolvida_em", { withTimezone: true }),
    notaResolucao: text("nota_resolucao"),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId, t.obraId, t.status), isolamentoTenant()],
);
