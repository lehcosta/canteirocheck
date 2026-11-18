"use server";

import { abrirPortal, iniciarAssinatura } from "@canteirocheck/servicos";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { exigirSessao } from "@/lib/sessao";
import { stripe } from "@/lib/stripe";
import { campos, type EstadoAcao, tratarErro } from "../acao";

const PAGINA = `${env.BETTER_AUTH_URL}/configuracoes/assinatura`;

/** Plano escolhido → Checkout do Stripe. A volta cai na página com `?sessao=` para confirmar na hora. */
export async function assinarAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  let url: string;
  try {
    url = await iniciarAssinatura(s.contexto, campos(form), stripe, {
      email: s.email,
      urls: { sucesso: `${PAGINA}?sessao={CHECKOUT_SESSION_ID}`, cancelamento: PAGINA },
    });
  } catch (e) {
    return tratarErro(e);
  }
  redirect(url);
}

/** Portal do Stripe: cartão, faturas, troca de plano e cancelamento. */
export async function gerenciarAssinaturaAction(_: EstadoAcao, _form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  let url: string;
  try {
    url = await abrirPortal(s.contexto, stripe, PAGINA);
  } catch (e) {
    return tratarErro(e);
  }
  redirect(url);
}
