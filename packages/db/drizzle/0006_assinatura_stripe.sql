ALTER TABLE "tenant" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "assinatura_status" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "assinatura_periodicidade" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "assinatura_fim_periodo" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "assinatura_cancela_no_fim" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "assinatura_atualizada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");