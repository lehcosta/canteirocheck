import { and, eq, inArray } from "drizzle-orm";
import { comoSistema } from "./interno/como-sistema";
import { auth_user as authUser } from "./schema/auth";
import type { Papel } from "./schema/comum";
import { usuario } from "./schema/tenant";

/**
 * Leituras que acontecem ANTES de se saber o tenant. Cada função é estreita de propósito:
 * nada de client genérico com bypass de RLS.
 */

export interface UsuarioDoPainel {
  usuarioId: string;
  tenantId: string;
  nome: string;
  email: string;
  papel: Extract<Papel, "admin" | "engenheiro">;
}

const PAPEIS_DO_PAINEL = ["admin", "engenheiro"] as const;

/** Sessão do painel (Better Auth) → usuário e tenant. Só admin/engenheiro ativos. */
export async function resolverUsuarioDoPainel(authUserId: string): Promise<UsuarioDoPainel | null> {
  return comoSistema(async (tx) => {
    const [linha] = await tx
      .select({
        usuarioId: usuario.id,
        tenantId: usuario.tenantId,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      })
      .from(usuario)
      .where(
        and(
          eq(usuario.authUserId, authUserId),
          eq(usuario.ativo, true),
          inArray(usuario.papel, [...PAPEIS_DO_PAINEL]),
        ),
      )
      .limit(1);
    if (!linha?.email || linha.papel === "encarregado") return null;
    return { ...linha, email: linha.email, papel: linha.papel };
  });
}

/**
 * Antes de mandar um magic link: o e-mail pertence a alguém que pode entrar no painel?
 * Evita usar o envio de e-mail como canal de spam para endereços quaisquer.
 */
export async function podeEntrarNoPainel(email: string): Promise<boolean> {
  return comoSistema(async (tx) => {
    const [linha] = await tx
      .select({ id: usuario.id })
      .from(usuario)
      .innerJoin(authUser, eq(authUser.id, usuario.authUserId))
      .where(
        and(
          eq(authUser.email, email.trim().toLowerCase()),
          eq(usuario.ativo, true),
          inArray(usuario.papel, [...PAPEIS_DO_PAINEL]),
        ),
      )
      .limit(1);
    return Boolean(linha);
  });
}
