CREATE TYPE "public"."tipo_cronograma" AS ENUM('mpp', 'xml');--> statement-breakpoint
CREATE TABLE "cronograma_tarefa" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"versao_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"uid" integer NOT NULL,
	"nome" text NOT NULL,
	"nivel" integer NOT NULL,
	"resumo" boolean NOT NULL,
	"marco" boolean NOT NULL,
	"inicio" date,
	"termino" date,
	"percentual" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cronograma_tarefa_versao_id_ordem_unique" UNIQUE("versao_id","ordem")
);
--> statement-breakpoint
ALTER TABLE "cronograma_tarefa" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cronograma_versao" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obra_id" uuid NOT NULL,
	"numero" integer,
	"vigente" boolean DEFAULT false NOT NULL,
	"arquivo_nome" text NOT NULL,
	"tipo_arquivo" "tipo_cronograma" NOT NULL,
	"arquivo_key" text NOT NULL,
	"arquivo_sha256" text NOT NULL,
	"status_leitura" "status_extracao" DEFAULT 'pendente' NOT NULL,
	"erro_leitura" text,
	"total_tarefas" integer,
	"inicio" date,
	"termino" date,
	"versao_leitor" text,
	"enviado_por_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cronograma_versao_obra_id_numero_unique" UNIQUE("obra_id","numero")
);
--> statement-breakpoint
ALTER TABLE "cronograma_versao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cronograma_tarefa" ADD CONSTRAINT "cronograma_tarefa_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cronograma_tarefa" ADD CONSTRAINT "cronograma_tarefa_versao_id_cronograma_versao_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."cronograma_versao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cronograma_versao" ADD CONSTRAINT "cronograma_versao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cronograma_versao" ADD CONSTRAINT "cronograma_versao_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cronograma_versao" ADD CONSTRAINT "cronograma_versao_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cronograma_tarefa_tenant_id_index" ON "cronograma_tarefa" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cronograma_versao_uma_vigente" ON "cronograma_versao" USING btree ("obra_id") WHERE "cronograma_versao"."vigente";--> statement-breakpoint
CREATE INDEX "cronograma_versao_tenant_id_obra_id_criado_em_index" ON "cronograma_versao" USING btree ("tenant_id","obra_id","criado_em");--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "cronograma_tarefa" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolamento_tenant" ON "cronograma_versao" AS PERMISSIVE FOR ALL TO "canteiro_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);