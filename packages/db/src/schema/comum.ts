import { type SQL, sql } from "drizzle-orm";
import { numeric, pgEnum, pgPolicy, pgRole, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Papel de runtime. As políticas RLS são `TO canteiro_app`; o usuário de login do app
 * (canteiro_runtime) herda esse papel. Criado pela infra (infra/postgres/init.sql) e,
 * se faltar, pela migration 0000.
 */
export const appRole = pgRole("canteiro_app").existing();

/** Tenant da transação atual. `''` (após o fim de um set_config local) vira NULL → falha fechada. */
export const tenantAtual: SQL = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

/** Política padrão de isolamento: o app só vê e só grava linhas do tenant da transação. */
export const isolamentoTenant = () =>
  pgPolicy("isolamento_tenant", {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`tenant_id = ${tenantAtual}`,
    withCheck: sql`tenant_id = ${tenantAtual}`,
  });

/** Chave primária UUID v7 gerada pelo Postgres 18. */
export const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

/** Medidas: `numeric` volta como string → decimal.js no core. Nunca float. */
export const medida = (nome: string) => numeric(nome, { precision: 12, scale: 4 });

// ─────────────────────────── Enums ───────────────────────────

export const papel = pgEnum("papel", ["admin", "engenheiro", "encarregado"]);
export const statusObra = pgEnum("status_obra", ["ativa", "pausada", "concluida"]);
export const disciplina = pgEnum("disciplina", ["arquitetura", "estrutura", "instalacoes", "interiores"]);
export const tipoArquivo = pgEnum("tipo_arquivo", ["dwg", "pdf"]);
export const statusExtracao = pgEnum("status_extracao", [
  "pendente",
  "processando",
  "concluida",
  "falhou",
  "nao_aplicavel", // PDF de referência
]);
export const risco = pgEnum("risco", ["alto", "medio", "baixo"]);
export const statusPendencia = pgEnum("status_pendencia", ["aberta", "resolvida", "descartada"]);
export const tipoLocal = pgEnum("tipo_local", ["pavimento", "laje", "ambiente", "eixo"]);
export const grandeza = pgEnum("grandeza", ["nivel", "distancia", "prumo", "esquadro", "existencia"]);
export const unidade = pgEnum("unidade", ["m", "cm", "mm", "booleano"]);
export const origemPonto = pgEnum("origem_ponto", ["ia", "manual"]);
export const statusRevisao = pgEnum("status_revisao", ["sugerido", "aprovado", "descartado"]);
export const statusEtapaLocal = pgEnum("status_etapa_local", ["nao_iniciada", "em_andamento", "concluida"]);
export const statusExecucao = pgEnum("status_execucao", [
  "anunciada",
  "em_conferencia",
  "bloqueada",
  "aguardando_liberacao",
  "liberada",
  "recusada", // volta para em_conferencia na próxima rodada
  "cancelada",
]);
export const decisao = pgEnum("decisao", ["liberada", "recusada"]);
export const canal = pgEnum("canal", ["flow", "conversa", "painel"]);
export const direcaoMensagem = pgEnum("direcao_mensagem", ["entrada", "saida"]);
export const tipoFlowSessao = pgEnum("tipo_flow_sessao", ["anuncio", "checklist", "recusa"]);
export const origemMidia = pgEnum("origem_midia", ["flow_cdn", "whatsapp_media", "upload_painel"]);
export const statusMidia = pgEnum("status_midia", ["pendente", "armazenada", "falhou"]);
export const tipoCusto = pgEnum("tipo_custo", [
  "whatsapp_template",
  "whatsapp_servico", // não-template: cobrada a partir da 1.001ª do mês por número (out/2026)
  "llm_tokens",
  "transcricao_audio",
]);
export const atorTipo = pgEnum("ator_tipo", ["usuario", "sistema", "ia"]);

export type Papel = (typeof papel.enumValues)[number];
export type TipoLocal = (typeof tipoLocal.enumValues)[number];
export type StatusObra = (typeof statusObra.enumValues)[number];
export type AtorTipo = (typeof atorTipo.enumValues)[number];
