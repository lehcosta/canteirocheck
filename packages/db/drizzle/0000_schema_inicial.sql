-- ════════════════════ Papéis (editado à mão — ver docs/arquitetura.md §8) ════════════════════
-- As políticas RLS abaixo referenciam canteiro_app, então os papéis precisam existir antes.
-- Normalmente a infra já os criou (infra/postgres/init.sql). O guard via pg_roles evita erro de
-- privilégio quando o usuário de migração não tem CREATEROLE/BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'canteiro_app') THEN
    CREATE ROLE canteiro_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'canteiro_sistema') THEN
    CREATE ROLE canteiro_sistema NOLOGIN BYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."ator_tipo" AS ENUM('usuario', 'sistema', 'ia');--> statement-breakpoint
CREATE TYPE "public"."canal" AS ENUM('flow', 'conversa', 'painel');--> statement-breakpoint
CREATE TYPE "public"."decisao" AS ENUM('liberada', 'recusada');--> statement-breakpoint
CREATE TYPE "public"."direcao_mensagem" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TYPE "public"."disciplina" AS ENUM('arquitetura', 'estrutura', 'instalacoes', 'interiores');--> statement-breakpoint
CREATE TYPE "public"."grandeza" AS ENUM('nivel', 'distancia', 'prumo', 'esquadro', 'existencia');--> statement-breakpoint
CREATE TYPE "public"."origem_midia" AS ENUM('flow_cdn', 'whatsapp_media', 'upload_painel');--> statement-breakpoint
CREATE TYPE "public"."origem_ponto" AS ENUM('ia', 'manual');--> statement-breakpoint
CREATE TYPE "public"."papel" AS ENUM('admin', 'engenheiro', 'encarregado');--> statement-breakpoint
CREATE TYPE "public"."risco" AS ENUM('alto', 'medio', 'baixo');--> statement-breakpoint
CREATE TYPE "public"."status_etapa_local" AS ENUM('nao_iniciada', 'em_andamento', 'concluida');--> statement-breakpoint
CREATE TYPE "public"."status_execucao" AS ENUM('anunciada', 'em_conferencia', 'bloqueada', 'aguardando_liberacao', 'liberada', 'recusada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_extracao" AS ENUM('pendente', 'processando', 'concluida', 'falhou', 'nao_aplicavel');--> statement-breakpoint
CREATE TYPE "public"."status_midia" AS ENUM('pendente', 'armazenada', 'falhou');--> statement-breakpoint
CREATE TYPE "public"."status_obra" AS ENUM('ativa', 'pausada', 'concluida');--> statement-breakpoint
CREATE TYPE "public"."status_pendencia" AS ENUM('aberta', 'resolvida', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."status_revisao" AS ENUM('sugerido', 'aprovado', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."tipo_arquivo" AS ENUM('dwg', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."tipo_custo" AS ENUM('whatsapp_template', 'llm_tokens', 'transcricao_audio');--> statement-breakpoint
CREATE TYPE "public"."tipo_flow_sessao" AS ENUM('anuncio', 'checklist', 'recusa');--> statement-breakpoint
CREATE TYPE "public"."tipo_local" AS ENUM('pavimento', 'laje', 'ambiente', 'eixo');--> statement-breakpoint
CREATE TYPE "public"."unidade" AS ENUM('m', 'cm', 'mm', 'booleano');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid,
	"ator_tipo" "ator_tipo" NOT NULL,
	"ator_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text NOT NULL,
	"antes" jsonb,
	"depois" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evento_custo" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid,
	"tipo" "tipo_custo" NOT NULL,
	"quantidade" numeric(14, 4) NOT NULL,
	"custo_estimado" numeric(14, 6) NOT NULL,
	"moeda" text DEFAULT 'USD' NOT NULL,
	"referencia" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evento_custo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relatorio" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"execucao_id" uuid,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"gerado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relatorio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divergencia" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execucao_id" uuid NOT NULL,
	"verificacao_id" uuid NOT NULL,
	"causa_provavel" text NOT NULL,
	"descricao" text,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divergencia_verificacao_id_unique" UNIQUE("verificacao_id")
);
--> statement-breakpoint
ALTER TABLE "divergencia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "execucao_etapa" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"etapa_id" integer NOT NULL,
	"local_id" uuid NOT NULL,
	"data_prevista" date NOT NULL,
	"anunciada_por_id" uuid NOT NULL,
	"status" "status_execucao" DEFAULT 'anunciada' NOT NULL,
	"rodada_atual" integer DEFAULT 1 NOT NULL,
	"versao" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execucao_etapa" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "liberacao" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execucao_id" uuid NOT NULL,
	"rodada" integer NOT NULL,
	"decisao" "decisao" NOT NULL,
	"justificativa" text,
	"engenheiro_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liberacao_execucao_id_rodada_unique" UNIQUE("execucao_id","rodada"),
	CONSTRAINT "recusa_exige_justificativa" CHECK ("liberacao"."decisao" <> 'recusada' or length(trim(coalesce("liberacao"."justificativa", ''))) > 0)
);
--> statement-breakpoint
ALTER TABLE "liberacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verificacao" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execucao_id" uuid NOT NULL,
	"ponto_id" uuid NOT NULL,
	"rodada" integer DEFAULT 1 NOT NULL,
	"tentativa" integer DEFAULT 1 NOT NULL,
	"valor_medido" numeric(12, 4),
	"valor_referencia" numeric(12, 4),
	"mesma_referencia_nivel" boolean,
	"diferenca" numeric(12, 4),
	"unidade" "unidade" NOT NULL,
	"dentro_tolerancia" boolean NOT NULL,
	"observacao" text,
	"canal" "canal" NOT NULL,
	"estruturada" boolean DEFAULT true NOT NULL,
	"usuario_id" uuid NOT NULL,
	"flow_token" text,
	"geo" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verificacao_execucao_id_ponto_id_rodada_tentativa_unique" UNIQUE("execucao_id","ponto_id","rodada","tentativa"),
	CONSTRAINT "rodada_tentativa_positivas" CHECK ("verificacao"."rodada" >= 1 and "verificacao"."tentativa" >= 1)
);
--> statement-breakpoint
ALTER TABLE "verificacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "estado_etapa_local" (
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"local_id" uuid NOT NULL,
	"etapa_id" integer NOT NULL,
	"status" "status_etapa_local" DEFAULT 'nao_iniciada' NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estado_etapa_local_local_id_etapa_id_pk" PRIMARY KEY("local_id","etapa_id")
);
--> statement-breakpoint
ALTER TABLE "estado_etapa_local" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "etapa" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "etapa_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer NOT NULL,
	"ponto_sem_volta" boolean DEFAULT true NOT NULL,
	CONSTRAINT "etapa_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "local" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"tipo" "tipo_local" NOT NULL,
	"nome" text NOT NULL,
	"pai_id" uuid,
	CONSTRAINT "local_obra_id_tipo_nome_unique" UNIQUE("obra_id","tipo","nome")
);
--> statement-breakpoint
ALTER TABLE "local" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "obra" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"endereco" text,
	"area_m2" numeric(12, 2),
	"status" "status_obra" DEFAULT 'ativa' NOT NULL,
	"engenheiro_responsavel_id" uuid NOT NULL,
	"horario_anuncio" text DEFAULT '16:00' NOT NULL,
	"fuso_horario" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "horario_anuncio_formato" CHECK ("obra"."horario_anuncio" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "obra" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "obra_membro" (
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" "papel" NOT NULL,
	CONSTRAINT "obra_membro_obra_id_usuario_id_pk" PRIMARY KEY("obra_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "obra_membro" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ponto_controle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"etapa_id" integer NOT NULL,
	"local_id" uuid NOT NULL,
	"regiao" text,
	"descricao" text NOT NULL,
	"grandeza" "grandeza" NOT NULL,
	"valor_esperado" numeric(12, 4),
	"unidade" "unidade" NOT NULL,
	"tolerancia_mais" numeric(12, 4),
	"tolerancia_menos" numeric(12, 4),
	"eh_interface" boolean DEFAULT false NOT NULL,
	"local_referencia_id" uuid,
	"referencia_nivel" text,
	"exige_foto" boolean DEFAULT false NOT NULL,
	"origem" "origem_ponto" NOT NULL,
	"status_revisao" "status_revisao" DEFAULT 'sugerido' NOT NULL,
	"projeto_id" uuid,
	"trecho_origem" text,
	"revisado_por_id" uuid,
	"revisado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valor_esperado_conforme_grandeza" CHECK (("ponto_controle"."grandeza" = 'existencia') = ("ponto_controle"."valor_esperado" is null)),
	CONSTRAINT "tolerancias_nao_negativas" CHECK (coalesce("ponto_controle"."tolerancia_mais", 0) >= 0 and coalesce("ponto_controle"."tolerancia_menos", 0) >= 0),
	CONSTRAINT "interface_tem_referencia" CHECK (not "ponto_controle"."eh_interface" or "ponto_controle"."local_referencia_id" is not null),
	CONSTRAINT "ia_cita_origem" CHECK ("ponto_controle"."origem" <> 'ia' or "ponto_controle"."trecho_origem" is not null)
);
--> statement-breakpoint
ALTER TABLE "ponto_controle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extracao_projeto" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"projeto_id" uuid NOT NULL,
	"textos" jsonb NOT NULL,
	"camadas" jsonb NOT NULL,
	"blocos" jsonb NOT NULL,
	"cotas_nivel" jsonb NOT NULL,
	"ambientes" jsonb NOT NULL,
	"carimbo" jsonb NOT NULL,
	"versao_extrator" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracao_projeto_projeto_id_unique" UNIQUE("projeto_id")
);
--> statement-breakpoint
ALTER TABLE "extracao_projeto" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pendencia" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"projeto_id" uuid NOT NULL,
	"texto_original" text NOT NULL,
	"etapa_bloqueada_id" integer,
	"risco" "risco" NOT NULL,
	"status" "status_pendencia" DEFAULT 'aberta' NOT NULL,
	"classificado_por" text NOT NULL,
	"resolvida_por_id" uuid,
	"resolvida_em" timestamp with time zone,
	"nota_resolucao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pendencia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projeto" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"disciplina" "disciplina" NOT NULL,
	"titulo" text NOT NULL,
	"codigo" text NOT NULL,
	"revisao" text NOT NULL,
	"tipo_arquivo" "tipo_arquivo" NOT NULL,
	"arquivo_key" text NOT NULL,
	"arquivo_sha256" text NOT NULL,
	"status_extracao" "status_extracao" DEFAULT 'pendente' NOT NULL,
	"erro_extracao" text,
	"substituido_por_id" uuid,
	"enviado_por_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projeto_obra_id_codigo_revisao_unique" UNIQUE("obra_id","codigo","revisao")
);
--> statement-breakpoint
ALTER TABLE "projeto" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text NOT NULL,
	"plano" text DEFAULT 'piloto' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tolerancia_padrao" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grandeza" "grandeza" NOT NULL,
	"tolerancia_mais" numeric(12, 4) NOT NULL,
	"tolerancia_menos" numeric(12, 4) NOT NULL,
	"unidade" "unidade" NOT NULL,
	CONSTRAINT "tolerancia_padrao_tenant_id_grandeza_unique" UNIQUE("tenant_id","grandeza"),
	CONSTRAINT "tolerancia_padrao_nao_negativa" CHECK ("tolerancia_padrao"."tolerancia_mais" >= 0 and "tolerancia_padrao"."tolerancia_menos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tolerancia_padrao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"email" text,
	"whatsapp_e164" text NOT NULL,
	"papel" "papel" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"auth_user_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_whatsapp_e164_unique" UNIQUE("whatsapp_e164"),
	CONSTRAINT "usuario_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "usuario_tenant_id_email_unique" UNIQUE("tenant_id","email"),
	CONSTRAINT "whatsapp_e164_formato" CHECK ("usuario"."whatsapp_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "painel_exige_email" CHECK ("usuario"."papel" = 'encarregado' or "usuario"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "flow_sessao" (
	"token" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" "tipo_flow_sessao" NOT NULL,
	"usuario_id" uuid NOT NULL,
	"execucao_id" uuid,
	"estado" jsonb NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"concluida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_sessao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mensagem_whatsapp" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"usuario_id" uuid,
	"wa_message_id" text,
	"direcao" "direcao_mensagem" NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_entrega" text,
	"classificacao" text,
	"interpretacao" jsonb,
	"ponto_id" uuid,
	"execucao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mensagem_whatsapp_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "entrada_tem_wamid" CHECK ("mensagem_whatsapp"."direcao" <> 'entrada' or "mensagem_whatsapp"."wa_message_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "midia" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"origem" "origem_midia" NOT NULL,
	"status" "status_midia" DEFAULT 'pendente' NOT NULL,
	"fonte" jsonb,
	"storage_key" text,
	"mime_type" text,
	"tamanho_bytes" integer,
	"sha256" text,
	"verificacao_id" uuid,
	"divergencia_id" uuid,
	"mensagem_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "midia_um_dono" CHECK (num_nonnulls("midia"."verificacao_id", "midia"."divergencia_id", "midia"."mensagem_id") <= 1),
	CONSTRAINT "midia_armazenada_completa" CHECK ("midia"."status" <> 'armazenada' or ("midia"."storage_key" is not null and "midia"."sha256" is not null))
);
--> statement-breakpoint
ALTER TABLE "midia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento_custo" ADD CONSTRAINT "evento_custo_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento_custo" ADD CONSTRAINT "evento_custo_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorio" ADD CONSTRAINT "relatorio_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorio" ADD CONSTRAINT "relatorio_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorio" ADD CONSTRAINT "relatorio_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorio" ADD CONSTRAINT "relatorio_gerado_por_id_usuario_id_fk" FOREIGN KEY ("gerado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia" ADD CONSTRAINT "divergencia_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia" ADD CONSTRAINT "divergencia_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia" ADD CONSTRAINT "divergencia_verificacao_id_verificacao_id_fk" FOREIGN KEY ("verificacao_id") REFERENCES "public"."verificacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia" ADD CONSTRAINT "divergencia_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_etapa" ADD CONSTRAINT "execucao_etapa_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_etapa" ADD CONSTRAINT "execucao_etapa_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_etapa" ADD CONSTRAINT "execucao_etapa_etapa_id_etapa_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_etapa" ADD CONSTRAINT "execucao_etapa_local_id_local_id_fk" FOREIGN KEY ("local_id") REFERENCES "public"."local"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_etapa" ADD CONSTRAINT "execucao_etapa_anunciada_por_id_usuario_id_fk" FOREIGN KEY ("anunciada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liberacao" ADD CONSTRAINT "liberacao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liberacao" ADD CONSTRAINT "liberacao_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liberacao" ADD CONSTRAINT "liberacao_engenheiro_id_usuario_id_fk" FOREIGN KEY ("engenheiro_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacao" ADD CONSTRAINT "verificacao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacao" ADD CONSTRAINT "verificacao_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacao" ADD CONSTRAINT "verificacao_ponto_id_ponto_controle_id_fk" FOREIGN KEY ("ponto_id") REFERENCES "public"."ponto_controle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacao" ADD CONSTRAINT "verificacao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_etapa_local" ADD CONSTRAINT "estado_etapa_local_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_etapa_local" ADD CONSTRAINT "estado_etapa_local_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_etapa_local" ADD CONSTRAINT "estado_etapa_local_local_id_local_id_fk" FOREIGN KEY ("local_id") REFERENCES "public"."local"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_etapa_local" ADD CONSTRAINT "estado_etapa_local_etapa_id_etapa_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local" ADD CONSTRAINT "local_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local" ADD CONSTRAINT "local_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local" ADD CONSTRAINT "local_pai_id_local_id_fk" FOREIGN KEY ("pai_id") REFERENCES "public"."local"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obra" ADD CONSTRAINT "obra_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obra" ADD CONSTRAINT "obra_engenheiro_responsavel_id_usuario_id_fk" FOREIGN KEY ("engenheiro_responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obra_membro" ADD CONSTRAINT "obra_membro_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obra_membro" ADD CONSTRAINT "obra_membro_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obra_membro" ADD CONSTRAINT "obra_membro_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_etapa_id_etapa_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_local_id_local_id_fk" FOREIGN KEY ("local_id") REFERENCES "public"."local"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_local_referencia_id_local_id_fk" FOREIGN KEY ("local_referencia_id") REFERENCES "public"."local"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_controle" ADD CONSTRAINT "ponto_controle_revisado_por_id_usuario_id_fk" FOREIGN KEY ("revisado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracao_projeto" ADD CONSTRAINT "extracao_projeto_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracao_projeto" ADD CONSTRAINT "extracao_projeto_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_etapa_bloqueada_id_etapa_id_fk" FOREIGN KEY ("etapa_bloqueada_id") REFERENCES "public"."etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_resolvida_por_id_usuario_id_fk" FOREIGN KEY ("resolvida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_substituido_por_id_projeto_id_fk" FOREIGN KEY ("substituido_por_id") REFERENCES "public"."projeto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tolerancia_padrao" ADD CONSTRAINT "tolerancia_padrao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_sessao" ADD CONSTRAINT "flow_sessao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_sessao" ADD CONSTRAINT "flow_sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_sessao" ADD CONSTRAINT "flow_sessao_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_ponto_id_ponto_controle_id_fk" FOREIGN KEY ("ponto_id") REFERENCES "public"."ponto_controle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_execucao_id_execucao_etapa_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_etapa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "midia" ADD CONSTRAINT "midia_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "midia" ADD CONSTRAINT "midia_verificacao_id_verificacao_id_fk" FOREIGN KEY ("verificacao_id") REFERENCES "public"."verificacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "midia" ADD CONSTRAINT "midia_divergencia_id_divergencia_id_fk" FOREIGN KEY ("divergencia_id") REFERENCES "public"."divergencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "midia" ADD CONSTRAINT "midia_mensagem_id_mensagem_whatsapp_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."mensagem_whatsapp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_entidade_entidade_id_index" ON "audit_log" USING btree ("tenant_id","entidade","entidade_id");--> statement-breakpoint
CREATE INDEX "evento_custo_tenant_id_obra_id_criado_em_index" ON "evento_custo" USING btree ("tenant_id","obra_id","criado_em");--> statement-breakpoint
CREATE INDEX "relatorio_tenant_id_obra_id_index" ON "relatorio" USING btree ("tenant_id","obra_id");--> statement-breakpoint
CREATE INDEX "auth_account_userId_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "divergencia_tenant_id_index" ON "divergencia" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "execucao_etapa_tenant_id_obra_id_status_index" ON "execucao_etapa" USING btree ("tenant_id","obra_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "execucao_aberta_unica" ON "execucao_etapa" USING btree ("local_id","etapa_id") WHERE "execucao_etapa"."status" not in ('liberada', 'cancelada');--> statement-breakpoint
CREATE INDEX "liberacao_tenant_id_execucao_id_index" ON "liberacao" USING btree ("tenant_id","execucao_id");--> statement-breakpoint
CREATE INDEX "verificacao_tenant_id_index" ON "verificacao" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "estado_etapa_local_tenant_id_obra_id_index" ON "estado_etapa_local" USING btree ("tenant_id","obra_id");--> statement-breakpoint
CREATE INDEX "local_tenant_id_index" ON "local" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "obra_tenant_id_index" ON "obra" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "obra_membro_tenant_id_index" ON "obra_membro" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ponto_controle_checklist_idx" ON "ponto_controle" USING btree ("tenant_id","obra_id","etapa_id","local_id","status_revisao");--> statement-breakpoint
CREATE INDEX "extracao_projeto_tenant_id_index" ON "extracao_projeto" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pendencia_tenant_id_obra_id_status_index" ON "pendencia" USING btree ("tenant_id","obra_id","status");--> statement-breakpoint
CREATE INDEX "projeto_tenant_id_index" ON "projeto" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flow_sessao_tenant_id_index" ON "flow_sessao" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mensagem_whatsapp_tenant_id_usuario_id_criado_em_index" ON "mensagem_whatsapp" USING btree ("tenant_id","usuario_id","criado_em");--> statement-breakpoint
CREATE INDEX "midia_tenant_id_index" ON "midia" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "audit_log" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "evento_custo" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "relatorio" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "divergencia" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "execucao_etapa" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "liberacao" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "verificacao" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "estado_etapa_local" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "local" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "obra" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "obra_membro" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "ponto_controle" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "extracao_projeto" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "pendencia" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "projeto" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_proprio" ON "tenant" AS PERMISSIVE FOR SELECT TO "canteiro_app" USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "tolerancia_padrao" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "usuario" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "flow_sessao" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "mensagem_whatsapp" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "midia" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);