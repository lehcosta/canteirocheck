ALTER TABLE "check_envio" ADD COLUMN "pergunta_ids" jsonb;--> statement-breakpoint
ALTER TABLE "check_envio" ADD COLUMN "aguardando_pergunta_id" uuid;--> statement-breakpoint
ALTER TABLE "check_envio" ADD COLUMN "aguardando_foto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "check_envio" ADD CONSTRAINT "check_envio_aguardando_pergunta_id_check_pergunta_id_fk" FOREIGN KEY ("aguardando_pergunta_id") REFERENCES "public"."check_pergunta"("id") ON DELETE no action ON UPDATE no action;