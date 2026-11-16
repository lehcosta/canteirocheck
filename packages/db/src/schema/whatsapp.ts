import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  criadoEm,
  direcaoMensagem,
  id,
  isolamentoTenant,
  origemMidia,
  statusMidia,
  tipoFlowSessao,
} from "./comum";
import { divergencia, execucaoEtapa, verificacao } from "./execucao";
import { obra } from "./obra";
import { pontoControle } from "./ponto";
import { colunaTenantId, tenant, usuario } from "./tenant";

export const mensagemWhatsapp = pgTable(
  "mensagem_whatsapp",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenant.id), // null = número desconhecido
    usuarioId: uuid("usuario_id").references(() => usuario.id),
    // Idempotência da entrada. Na saída é preenchido quando a Graph API responde.
    waMessageId: text("wa_message_id").unique(),
    direcao: direcaoMensagem("direcao").notNull(),
    tipo: text("tipo").notNull(), // text, audio, image, interactive, button, nfm_reply, template…
    payload: jsonb("payload").notNull(),
    // saída: pendente → (aguardando_janela) → sent → delivered → read | failed (webhooks de status)
    statusEntrega: text("status_entrega"),
    erroEntrega: jsonb("erro_entrega"),
    obraId: uuid("obra_id").references(() => obra.id), // custo por obra
    classificacao: text("classificacao"), // medida | ocorrencia | pergunta | outro
    interpretacao: jsonb("interpretacao"), // fallback: valor extraído + ponto provável, aguardando confirmação
    pontoId: uuid("ponto_id").references(() => pontoControle.id),
    execucaoId: uuid("execucao_id").references(() => execucaoEtapa.id),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("entrada_tem_wamid", sql`${t.direcao} <> 'entrada' or ${t.waMessageId} is not null`),
    index().on(t.tenantId, t.usuarioId, t.criadoEm),
    isolamentoTenant(), // linhas com tenant_id null só são vistas pelo papel de sistema
  ],
);

export const midia = pgTable(
  "midia",
  {
    id: id(),
    tenantId: colunaTenantId(),
    origem: origemMidia("origem").notNull(),
    status: statusMidia("status").notNull().default("pendente"),
    fonte: jsonb("fonte"), // media_id da Meta, ou cdn_url + encryption_metadata do Flow (limpo após o download)
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    tamanhoBytes: integer("tamanho_bytes"),
    sha256: text("sha256"),
    verificacaoId: uuid("verificacao_id").references(() => verificacao.id),
    divergenciaId: uuid("divergencia_id").references(() => divergencia.id),
    mensagemId: uuid("mensagem_id").references(() => mensagemWhatsapp.id),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("midia_um_dono", sql`num_nonnulls(${t.verificacaoId}, ${t.divergenciaId}, ${t.mensagemId}) <= 1`),
    check(
      "midia_armazenada_completa",
      sql`${t.status} <> 'armazenada' or (${t.storageKey} is not null and ${t.sha256} is not null)`,
    ),
    index().on(t.tenantId),
    isolamentoTenant(),
  ],
);

/** flow_token → sessão. Estado no banco: o endpoint do Flow é stateless. */
export const flowSessao = pgTable(
  "flow_sessao",
  {
    token: text("token").primaryKey(), // aleatório, 32 bytes base64url
    tenantId: colunaTenantId(),
    tipo: tipoFlowSessao("tipo").notNull(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    execucaoId: uuid("execucao_id").references(() => execucaoEtapa.id),
    estado: jsonb("estado").notNull(), // cursor: pontos ordenados, índice atual, tentativa, região
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    concluidaEm: timestamp("concluida_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [index().on(t.tenantId), isolamentoTenant()],
);
