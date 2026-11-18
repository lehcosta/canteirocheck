import "server-only";
import { criarStripe } from "@canteirocheck/servicos";

/** Cliente do Stripe do servidor; `null` sem STRIPE_SECRET_KEY (a cobrança fica desligada). */
export const stripe = criarStripe();
