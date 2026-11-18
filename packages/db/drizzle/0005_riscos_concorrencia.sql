ALTER TABLE "check_fase" ADD COLUMN "editado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cruzamento" ADD COLUMN "iniciado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risco_fase" ADD CONSTRAINT "risco_fase_cruzamento_id_fase_uid_ordem_unique" UNIQUE("cruzamento_id","fase_uid","ordem");