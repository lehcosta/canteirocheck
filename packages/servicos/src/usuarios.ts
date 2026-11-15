import { randomUUID } from "node:crypto";
import { registrarAuditoria, schema, withTenant } from "@canteirocheck/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ator, type Contexto, ErroDominio, exigirPapel, traduzirErroBanco } from "./contexto";
import { campoEmail, campoWhatsapp, primeiraMensagem, textoObrigatorio, uuid } from "./validacao";

const { usuario, auth_user: authUser } = schema;

export interface UsuarioListado {
  id: string;
  nome: string;
  email: string | null;
  whatsappE164: string;
  papel: "admin" | "engenheiro" | "encarregado";
  ativo: boolean;
}

export async function listarUsuarios(ctx: Contexto): Promise<UsuarioListado[]> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        whatsappE164: usuario.whatsappE164,
        papel: usuario.papel,
        ativo: usuario.ativo,
      })
      .from(usuario)
      .orderBy(asc(usuario.nome)),
  );
}

export const entradaCriarUsuario = z
  .object({
    nome: textoObrigatorio("Nome", 120),
    papel: z.enum(["admin", "engenheiro", "encarregado"], { message: "Papel inválido." }),
    email: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(campoEmail.optional()),
    whatsapp: campoWhatsapp,
  })
  .superRefine((d, c) => {
    if (d.papel !== "encarregado" && !d.email) {
      c.addIssue({
        code: "custom",
        path: ["email"],
        message: "Admin e engenheiro precisam de e-mail para entrar no painel.",
      });
    }
  });

const MENSAGENS_CONFLITO = {
  usuario_whatsapp_e164_unique: "Este WhatsApp já está cadastrado.",
  auth_user_email_unique: "Este e-mail já está cadastrado.",
  usuario_tenant_id_email_unique: "Este e-mail já está cadastrado.",
};

/**
 * Cria usuário. Admin/engenheiro ganham login no painel: cria-se o auth_user na MESMA transação
 * (o cadastro aberto do Better Auth fica desligado, então só entra quem foi criado aqui).
 */
export async function criarUsuario(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin"]);
  const r = entradaCriarUsuario.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const d = r.data;

  return withTenant(ctx.tenantId, async (tx) => {
    try {
      let authUserId: string | null = null;
      if (d.papel !== "encarregado" && d.email) {
        authUserId = randomUUID();
        await tx
          .insert(authUser)
          .values({ id: authUserId, name: d.nome, email: d.email, emailVerified: true });
      }
      const [novo] = await tx
        .insert(usuario)
        .values({
          tenantId: ctx.tenantId,
          nome: d.nome,
          email: d.email ?? null,
          whatsappE164: d.whatsapp,
          papel: d.papel,
          authUserId,
        })
        .returning();
      if (!novo) throw new Error("falha ao criar usuário");
      await registrarAuditoria(tx, {
        tenantId: ctx.tenantId,
        ator: ator(ctx),
        acao: "usuario.criado",
        entidade: "usuario",
        entidadeId: novo.id,
        depois: novo,
      });
      return { id: novo.id };
    } catch (e) {
      traduzirErroBanco(e, MENSAGENS_CONFLITO);
    }
  });
}

export const entradaAtivo = z.object({ usuarioId: uuid, ativo: z.boolean() });

export async function definirAtivo(ctx: Contexto, entrada: unknown): Promise<void> {
  exigirPapel(ctx, ["admin"]);
  const r = entradaAtivo.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const { usuarioId, ativo } = r.data;
  if (usuarioId === ctx.usuarioId && !ativo) {
    throw new ErroDominio("invalido", "Você não pode desativar a si mesmo.");
  }

  await withTenant(ctx.tenantId, async (tx) => {
    const [antes] = await tx.select().from(usuario).where(eq(usuario.id, usuarioId));
    if (!antes) throw new ErroDominio("nao_encontrado", "Usuário não encontrado.");
    if (antes.ativo === ativo) return;
    await tx.update(usuario).set({ ativo }).where(eq(usuario.id, usuarioId));
    // Desativar derruba as sessões abertas no painel.
    if (!ativo && antes.authUserId) {
      await tx.delete(schema.auth_session).where(eq(schema.auth_session.userId, antes.authUserId));
    }
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: ativo ? "usuario.reativado" : "usuario.desativado",
      entidade: "usuario",
      entidadeId: usuarioId,
      antes: { ativo: antes.ativo },
      depois: { ativo },
    });
  });
}
