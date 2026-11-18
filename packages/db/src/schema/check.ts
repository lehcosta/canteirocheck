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
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  criadoEm,
  id,
  isolamentoTenant,
  momentoCheck,
  origemPonto,
  risco,
  statusExtracao,
  tipoResposta,
} from "./comum";
import { cronogramaVersao } from "./cronograma";
import { obra } from "./obra";
import { projeto } from "./projeto";
import { colunaTenantId, usuario } from "./tenant";
import { mensagemWhatsapp, midia } from "./whatsapp";

/**
 * Uma rodada da IA sobre o cronograma vigente × os projetos lidos. Guarda o retrato dos
 * projetos usados: o cruzamento não muda quando chega uma revisão nova.
 */
export const cruzamento = pgTable(
  "cruzamento",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    cronogramaVersaoId: uuid("cronograma_versao_id")
      .notNull()
      .references(() => cronogramaVersao.id),
    status: statusExtracao("status").notNull().default("pendente"),
    erro: text("erro"),
    projetos: jsonb("projetos").notNull().default([]), // [{ id, codigo, revisao, titulo, tipoArquivo }]
    geradoPor: text("gerado_por"), // modelo@versão do prompt
    solicitadoPorId: uuid("solicitado_por_id").references(() => usuario.id), // null = automático
    criadoEm: criadoEm(),
    // quando o job tomou o cruzamento: identifica o dono e mostra quando ele parou de andar
    iniciadoEm: timestamp("iniciado_em", { withTimezone: true }),
    concluidoEm: timestamp("concluido_em", { withTimezone: true }),
  },
  (t) => [index().on(t.tenantId, t.obraId, t.criadoEm), isolamentoTenant()],
);

/** Risco que nasce do encontro do projeto com o cronograma, numa fase. Sempre cita as duas fontes. */
export const riscoFase = pgTable(
  "risco_fase",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    cruzamentoId: uuid("cruzamento_id")
      .notNull()
      .references(() => cruzamento.id),
    faseUid: integer("fase_uid").notNull(), // cronograma_tarefa.uid: o mesmo entre versões
    ordem: integer("ordem").notNull(), // 1, 2, 3 dentro da fase → "R1", "R2"…
    nivel: risco("nivel").notNull(),
    titulo: text("titulo").notNull(),
    projetoId: uuid("projeto_id").references(() => projeto.id),
    projetoTrecho: text("projeto_trecho").notNull(),
    projetoReferencia: text("projeto_referencia"), // ex.: "PDF, folha 2"
    cronogramaOrdem: integer("cronograma_ordem"), // a linha citada (cronograma_tarefa.ordem)
    cronogramaTrecho: text("cronograma_trecho").notNull(),
    consequencia: text("consequencia").notNull(),
    descartadoEm: timestamp("descartado_em", { withTimezone: true }),
    descartadoPorId: uuid("descartado_por_id").references(() => usuario.id),
  },
  (t) => [
    unique().on(t.cruzamentoId, t.faseUid, t.ordem),
    index().on(t.tenantId, t.cruzamentoId, t.faseUid),
    isolamentoTenant(),
  ],
);

/**
 * O questionário de um momento de uma fase. `dias`: antes = dias corridos antes do início;
 * depois = dias úteis após o término; durante = dia da semana (1 = segunda … 7 = domingo).
 */
export const checkFase = pgTable(
  "check_fase",
  {
    id: id(),
    tenantId: colunaTenantId(),
    obraId: uuid("obra_id")
      .notNull()
      .references(() => obra.id),
    faseUid: integer("fase_uid").notNull(),
    momento: momentoCheck("momento").notNull(),
    dias: integer("dias").notNull(),
    hora: text("hora").notNull().default("07:00"), // HH:MM no fuso da obra
    responsavelId: uuid("responsavel_id").references(() => usuario.id),
    aprovadoPorId: uuid("aprovado_por_id").references(() => usuario.id),
    aprovadoEm: timestamp("aprovado_em", { withTimezone: true }),
    // editado pelo engenheiro: um cruzamento novo não troca mais as perguntas
    editadoEm: timestamp("editado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.obraId, t.faseUid, t.momento),
    index().on(t.tenantId, t.obraId),
    check("check_fase_hora_formato", sql`${t.hora} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check(
      "check_fase_dias_validos",
      sql`${t.dias} >= 0 and (${t.momento} <> 'durante' or ${t.dias} between 1 and 7)`,
    ),
    isolamentoTenant(),
  ],
);

export const checkPergunta = pgTable(
  "check_pergunta",
  {
    id: id(),
    tenantId: colunaTenantId(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checkFase.id),
    ordem: integer("ordem").notNull(),
    texto: text("texto").notNull(),
    tipoResposta: tipoResposta("tipo_resposta").notNull(),
    opcoes: jsonb("opcoes").$type<string[]>().notNull().default([]),
    esperada: text("esperada"),
    pedeFoto: boolean("pede_foto").notNull().default(false),
    riscoId: uuid("risco_id").references(() => riscoFase.id),
    origem: origemPonto("origem").notNull(),
    // pergunta que já tem resposta não é apagada: só sai da lista
    removidaEm: timestamp("removida_em", { withTimezone: true }),
  },
  (t) => [index().on(t.tenantId, t.checkId), isolamentoTenant()],
);

/**
 * Uma saída do check para a obra. `entrega` e `lido_em` copiam o status da mensagem do WhatsApp
 * (quem atualiza é o webhook de status, quando o envio existir).
 */
export const checkEnvio = pgTable(
  "check_envio",
  {
    id: id(),
    tenantId: colunaTenantId(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checkFase.id),
    previstoPara: date("previsto_para").notNull(),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    mensagemId: uuid("mensagem_id").references(() => mensagemWhatsapp.id),
    entrega: text("entrega"),
    lidoEm: timestamp("lido_em", { withTimezone: true }),
    respondidoEm: timestamp("respondido_em", { withTimezone: true }),
    respondidoPorId: uuid("respondido_por_id").references(() => usuario.id),
    foraDoEsperado: integer("fora_do_esperado"),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique().on(t.checkId, t.previstoPara),
    index().on(t.tenantId, t.checkId),
    check(
      "check_envio_entrega_valida",
      sql`${t.entrega} is null or ${t.entrega} in ('enviado', 'entregue', 'lido', 'falhou')`,
    ),
    isolamentoTenant(),
  ],
);

export const checkResposta = pgTable(
  "check_resposta",
  {
    id: id(),
    tenantId: colunaTenantId(),
    envioId: uuid("envio_id")
      .notNull()
      .references(() => checkEnvio.id),
    perguntaId: uuid("pergunta_id")
      .notNull()
      .references(() => checkPergunta.id),
    valor: text("valor").notNull(),
    dentroDoEsperado: boolean("dentro_do_esperado"), // null = pergunta sem esperada comparável
    observacao: text("observacao"),
    midiaId: uuid("midia_id").references(() => midia.id),
    criadoEm: criadoEm(),
  },
  (t) => [unique().on(t.envioId, t.perguntaId), index().on(t.tenantId, t.envioId), isolamentoTenant()],
);
