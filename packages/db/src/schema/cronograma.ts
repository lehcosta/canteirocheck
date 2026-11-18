import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { criadoEm, id, isolamentoTenant, statusExtracao, tipoCronograma } from "./comum";
import { obra } from "./obra";
import { colunaTenantId, usuario } from "./tenant";

/**
 * Uma importação do cronograma do MS Project. A leitura roda em segundo plano; só a que
 * conclui ganha `numero` (v1, v2…) e passa a ser a vigente. Nada é apagado: restaurar uma
 * versão só move o `vigente`.
 */
export const cronogramaVersao = pgTable(
  "cronograma_versao",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    numero: integer("numero"), // null enquanto a leitura não conclui
    vigente: boolean("vigente").notNull().default(false),
    arquivoNome: text("arquivo_nome").notNull(),
    tipoArquivo: tipoCronograma("tipo_arquivo").notNull(),
    arquivoKey: text("arquivo_key").notNull(), // chave no bucket, nunca URL
    arquivoSha256: text("arquivo_sha256").notNull(),
    statusLeitura: statusExtracao("status_leitura").notNull().default("pendente"),
    erroLeitura: text("erro_leitura"),
    totalTarefas: integer("total_tarefas"),
    inicio: date("inicio"),
    termino: date("termino"), // término previsto: a maior data de término entre as tarefas
    versaoLeitor: text("versao_leitor"),
    enviadoPorId: uuid("enviado_por_id")
      .notNull()
      .references(() => usuario.id),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.obraId, t.numero),
    uniqueIndex("cronograma_versao_uma_vigente").on(t.obraId).where(sql`${t.vigente}`),
    index().on(t.tenantId, t.obraId, t.criadoEm),
    isolamentoTenant(),
  ],
);

/** Linha do cronograma, na ordem do arquivo. A hierarquia vem do `nivel` (1 = etapa). */
export const cronogramaTarefa = pgTable(
  "cronograma_tarefa",
  {
    id: id(),
    tenantId: colunaTenantId(),
    versaoId: uuid("versao_id")
      .notNull()
      .references(() => cronogramaVersao.id),
    ordem: integer("ordem").notNull(),
    uid: integer("uid").notNull(), // Unique ID do MS Project: a mesma tarefa entre versões
    nome: text("nome").notNull(),
    nivel: integer("nivel").notNull(),
    resumo: boolean("resumo").notNull(),
    marco: boolean("marco").notNull(),
    inicio: date("inicio"),
    termino: date("termino"),
    percentual: integer("percentual").notNull().default(0),
  },
  (t) => [unique().on(t.versaoId, t.ordem), index().on(t.tenantId), isolamentoTenant()],
);
