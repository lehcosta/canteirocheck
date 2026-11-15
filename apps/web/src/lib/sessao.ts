import { resolverUsuarioDoPainel, type UsuarioDoPainel } from "@canteirocheck/db";
import type { Contexto } from "@canteirocheck/servicos";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export interface Sessao extends UsuarioDoPainel {
  contexto: Contexto;
}

/** Sessão do Better Auth → usuário do painel e tenant. Memorizada por requisição. */
export const obterSessao = cache(async (): Promise<Sessao | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const u = await resolverUsuarioDoPainel(s.user.id);
  if (!u) return null;
  return { ...u, contexto: { tenantId: u.tenantId, usuarioId: u.usuarioId, papel: u.papel } };
});

export async function exigirSessao(): Promise<Sessao> {
  const s = await obterSessao();
  if (!s) redirect("/login");
  return s;
}
