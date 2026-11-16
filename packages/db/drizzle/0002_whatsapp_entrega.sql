ALTER TYPE "public"."tipo_custo" ADD VALUE 'whatsapp_servico' BEFORE 'llm_tokens';--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "whatsapp_wa_id" text;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD COLUMN "erro_entrega" jsonb;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD COLUMN "obra_id" uuid;--> statement-breakpoint
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_obra_id_obra_id_fk" FOREIGN KEY ("obra_id") REFERENCES "public"."obra"("id") ON DELETE no action ON UPDATE no action;