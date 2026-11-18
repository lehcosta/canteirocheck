CREATE TYPE "public"."momento_check" AS ENUM('antes', 'durante', 'depois');--> statement-breakpoint
CREATE TYPE "public"."tipo_resposta" AS ENUM('sim_nao', 'opcao', 'data', 'medida', 'texto');--> statement-breakpoint
CREATE TABLE "check_envio" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"previsto_para" date NOT NULL,
	"enviado_em" timestamp with time zone,
	"mensagem_id" uuid,
	"entrega" text,
	"lido_em" timestamp with time zone,
	"respondido_em" timestamp with time zone,
	"respondido_por_id" uuid,
	"fora_do_esperado" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_envio_check_id_previsto_para_unique" UNIQUE("check_id","previsto_para"),
	CONSTRAINT "check_envio_entrega_valida" CHECK ("check_envio"."entrega" is null or "check_envio"."entrega" in ('enviado', 'entregue', 'lido', 'falhou'))
);
--> statement-breakpoint
ALTER TABLE "check_envio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "check_fase" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"fase_uid" integer NOT NULL,
	"momento" "momento_check" NOT NULL,
	"dias" integer NOT NULL,
	"hora" text DEFAULT '07:00' NOT NULL,
	"responsavel_id" uuid,
	"aprovado_por_id" uuid,
	"aprovado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_fase_obra_id_fase_uid_momento_unique" UNIQUE("obra_id","fase_uid","momento"),
	CONSTRAINT "check_fase_hora_formato" CHECK ("check_fase"."hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "check_fase_dias_validos" CHECK ("check_fase"."dias" >= 0 and ("check_fase"."momento" <> 'durante' or "check_fase"."dias" between 1 and 7))
);
--> statement-breakpoint
ALTER TABLE "check_fase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "check_pergunta" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"texto" text NOT NULL,
	"tipo_resposta" "tipo_resposta" NOT NULL,
	"opcoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"esperada" text,
	"pede_foto" boolean DEFAULT false NOT NULL,
	"risco_id" uuid,
	"origem" "origem_ponto" NOT NULL,
	"removida_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "check_pergunta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "check_resposta" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envio_id" uuid NOT NULL,
	"pergunta_id" uuid NOT NULL,
	"valor" text NOT NULL,
	"dentro_do_esperado" boolean,
	"observacao" text,
	"midia_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_resposta_envio_id_pergunta_id_unique" UNIQUE("envio_id","pergunta_id")
);
--> statement-breakpoint
ALTER TABLE "check_resposta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cruzamento" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"cronograma_versao_id" uuid NOT NULL,
	"status" "status_extracao" DEFAULT 'pendente' NOT NULL,
	"erro" text,
	"projetos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gerado_por" text,
	"solicitado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cruzamento" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "risco_fase" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"cruzamento_id" uuid NOT NULL,
	"fase_uid" integer NOT NULL,
	"ordem" integer NOT NULL,
	"nivel" "risco" NOT NULL,
	"titulo" text NOT NULL,
	"projeto_id" uuid,
	"projeto_trecho" text NOT NULL,
	"projeto_referencia" text,
	"cronograma_ordem" integer,
	"cronograma_trecho" text NOT NULL,
	"consequencia" text NOT NULL,
	"descartado_em" timestamp with time zone,
	"descartado_por_id" uuid
);
--> statement-breakpoint
ALTER TABLE "risco_fase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "check_envio" ADD CONSTRAINT "check_envio_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_envio" ADD CONSTRAINT "check_envio_check_id_check_fase_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."check_fase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_envio" ADD CONSTRAINT "check_envio_mensagem_id_mensagem_whatsapp_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."mensagem_whatsapp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_envio" ADD CONSTRAINT "check_envio_respondido_por_id_usuario_id_fk" FOREIGN KEY ("respondido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_fase" ADD CONSTRAINT "check_fase_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_fase" ADD CONSTRAINT "check_fase_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_fase" ADD CONSTRAINT "check_fase_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_fase" ADD CONSTRAINT "check_fase_aprovado_por_id_usuario_id_fk" FOREIGN KEY ("aprovado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_pergunta" ADD CONSTRAINT "check_pergunta_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_pergunta" ADD CONSTRAINT "check_pergunta_check_id_check_fase_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."check_fase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_pergunta" ADD CONSTRAINT "check_pergunta_risco_id_risco_fase_id_fk" FOREIGN KEY ("risco_id") REFERENCES "public"."risco_fase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resposta" ADD CONSTRAINT "check_resposta_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resposta" ADD CONSTRAINT "check_resposta_envio_id_check_envio_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."check_envio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resposta" ADD CONSTRAINT "check_resposta_pergunta_id_check_pergunta_id_fk" FOREIGN KEY ("pergunta_id") REFERENCES "public"."check_pergunta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resposta" ADD CONSTRAINT "check_resposta_midia_id_midia_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."midia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruzamento" ADD CONSTRAINT "cruzamento_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruzamento" ADD CONSTRAINT "cruzamento_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruzamento" ADD CONSTRAINT "cruzamento_cronograma_versao_id_cronograma_versao_id_fk" FOREIGN KEY ("cronograma_versao_id") REFERENCES "public"."cronograma_versao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruzamento" ADD CONSTRAINT "cruzamento_solicitado_por_id_usuario_id_fk" FOREIGN KEY ("solicitado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_cruzamento_id_cruzamento_id_fk" FOREIGN KEY ("cruzamento_id") REFERENCES "public"."cruzamento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_descartado_por_id_usuario_id_fk" FOREIGN KEY ("descartado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_envio_tenant_id_check_id_index" ON "check_envio" USING btree ("tenant_id","check_id");--> statement-breakpoint
CREATE INDEX "check_fase_tenant_id_obra_id_index" ON "check_fase" USING btree ("tenant_id","obra_id");--> statement-breakpoint
CREATE INDEX "check_pergunta_tenant_id_check_id_index" ON "check_pergunta" USING btree ("tenant_id","check_id");--> statement-breakpoint
CREATE INDEX "check_resposta_tenant_id_envio_id_index" ON "check_resposta" USING btree ("tenant_id","envio_id");--> statement-breakpoint
CREATE INDEX "cruzamento_tenant_id_obra_id_criado_em_index" ON "cruzamento" USING btree ("tenant_id","obra_id","criado_em");--> statement-breakpoint
CREATE INDEX "risco_fase_tenant_id_cruzamento_id_fase_uid_index" ON "risco_fase" USING btree ("tenant_id","cruzamento_id","fase_uid");--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "check_envio" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "check_fase" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "check_pergunta" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "check_resposta" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "cruzamento" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "risco_fase" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);