import { z } from "zod";

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, { message: "BETTER_AUTH_SECRET precisa de 32+ caracteres" }),
  BETTER_AUTH_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1),
  /** Quem recebe os pedidos de demonstração da landing page. */
  CONTATO_EMAIL: z.email().optional(),
  /** Cobrança (Stripe). Sem a chave, a página de assinatura avisa que a cobrança não está configurada. */
  STRIPE_SECRET_KEY: z.union([z.literal(""), z.string().startsWith("sk_")]).optional(),
  STRIPE_WEBHOOK_SECRET: z.union([z.literal(""), z.string().startsWith("whsec_")]).optional(),
});

/** Variáveis de ambiente do servidor, validadas na primeira leitura. */
export const env = esquema.parse(process.env);
