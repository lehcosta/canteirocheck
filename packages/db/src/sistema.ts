import { and, eq, inArray } from "drizzle-orm";
import { comoSistema } from "./interno/como-sistema";
import { auth_user as authUser } from "./schema/auth";
import type { Papel } from "./schema/comum";
import { obra } from "./schema/obra";
import { tenant, usuario } from "./schema/tenant";
import { flowSessao, mensagemWhatsapp } from "./schema/whatsapp";

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

// ─────────────────────────── WhatsApp (antes de saber o tenant) ───────────────────────────

/**
 * Números brasileiros antigos chegam no `wa_id` sem o 9 do celular (55 DD XXXXXXXX).
 * Devolve as formas E.164 possíveis para casar com o cadastro.
 */
export function variantesWhatsapp(waId: string): string[] {
  const digitos = waId.replace(/\D/g, "");
  const formas = new Set([`+${digitos}`]);
  const br = /^55(\d{2})(\d{8,9})$/.exec(digitos);
  if (br) {
    const [, ddd, numero = ""] = br;
    if (numero.length === 8 && /^[6-9]/.test(numero)) formas.add(`+55${ddd}9${numero}`);
    if (numero.length === 9 && numero.startsWith("9")) formas.add(`+55${ddd}${numero.slice(1)}`);
  }
  return [...formas];
}

export interface EntradaWhatsapp {
  waMessageId: string;
  waId: string; // remetente, como a Meta manda (só dígitos)
  tipo: string;
  payload: unknown;
}

export interface EntradaRegistrada {
  mensagemId: string;
  tenantId: string | null;
  usuarioId: string | null;
  /** O webhook já tinha entregado esta mensagem (retry da Meta): não processar de novo. */
  duplicada: boolean;
}

/**
 * Webhook: identifica o remetente pelo número cadastrado (usuário ativo) e grava a mensagem,
 * idempotente por `wa_message_id`. Número desconhecido → linha sem tenant, visível só aqui.
 */
export async function registrarEntradaWhatsapp(e: EntradaWhatsapp): Promise<EntradaRegistrada> {
  return comoSistema(async (tx) => {
    const [u] = await tx
      .select({ id: usuario.id, tenantId: usuario.tenantId, waId: usuario.whatsappWaId })
      .from(usuario)
      .where(and(inArray(usuario.whatsappE164, variantesWhatsapp(e.waId)), eq(usuario.ativo, true)))
      .limit(1);

    const [nova] = await tx
      .insert(mensagemWhatsapp)
      .values({
        tenantId: u?.tenantId ?? null,
        usuarioId: u?.id ?? null,
        waMessageId: e.waMessageId,
        direcao: "entrada",
        tipo: e.tipo,
        payload: e.payload,
      })
      .onConflictDoNothing({ target: mensagemWhatsapp.waMessageId })
      .returning({ id: mensagemWhatsapp.id });

    if (u && u.waId !== e.waId) {
      await tx.update(usuario).set({ whatsappWaId: e.waId }).where(eq(usuario.id, u.id));
    }
    if (nova)
      return {
        mensagemId: nova.id,
        tenantId: u?.tenantId ?? null,
        usuarioId: u?.id ?? null,
        duplicada: false,
      };

    const [existente] = await tx
      .select({
        id: mensagemWhatsapp.id,
        tenantId: mensagemWhatsapp.tenantId,
        usuarioId: mensagemWhatsapp.usuarioId,
      })
      .from(mensagemWhatsapp)
      .where(eq(mensagemWhatsapp.waMessageId, e.waMessageId));
    if (!existente) throw new Error("conflito de wa_message_id sem linha existente");
    return {
      mensagemId: existente.id,
      tenantId: existente.tenantId,
      usuarioId: existente.usuarioId,
      duplicada: true,
    };
  });
}

const ORDEM_STATUS = ["pendente", "aguardando_janela", "sent", "delivered", "read"] as const;

/**
 * Webhook de status (sent/delivered/read/failed) → atualiza a mensagem de saída já gravada.
 * Não regride (um "delivered" atrasado não sobrescreve "read"). Devolve o tenant para o custo.
 */
export async function atualizarStatusEntrega(
  waMessageId: string,
  status: string,
  erro?: unknown,
): Promise<{ tenantId: string | null; mensagemId: string } | null> {
  return comoSistema(async (tx) => {
    const [m] = await tx
      .select({
        id: mensagemWhatsapp.id,
        tenantId: mensagemWhatsapp.tenantId,
        atual: mensagemWhatsapp.statusEntrega,
      })
      .from(mensagemWhatsapp)
      .where(and(eq(mensagemWhatsapp.waMessageId, waMessageId), eq(mensagemWhatsapp.direcao, "saida")));
    if (!m) return null;
    const posicao = (s: string | null) =>
      ORDEM_STATUS.indexOf((s ?? "pendente") as (typeof ORDEM_STATUS)[number]);
    const regride = status !== "failed" && m.atual !== "failed" && posicao(status) < posicao(m.atual);
    if (!regride) {
      await tx
        .update(mensagemWhatsapp)
        .set({ statusEntrega: status, ...(erro ? { erroEntrega: erro } : {}) })
        .where(eq(mensagemWhatsapp.id, m.id));
    }
    return { tenantId: m.tenantId, mensagemId: m.id };
  });
}

export interface SessaoFlowResolvida {
  tenantId: string;
  tipo: "anuncio" | "checklist" | "recusa";
  usuarioId: string;
  execucaoId: string | null;
  expirada: boolean;
  concluida: boolean;
}

/** Endpoint do Flow: `flow_token` → tenant da sessão. O resto acontece com `withTenant`. */
export async function resolverSessaoFlow(token: string): Promise<SessaoFlowResolvida | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  return comoSistema(async (tx) => {
    const [s] = await tx
      .select({
        tenantId: flowSessao.tenantId,
        tipo: flowSessao.tipo,
        usuarioId: flowSessao.usuarioId,
        execucaoId: flowSessao.execucaoId,
        expiraEm: flowSessao.expiraEm,
        concluidaEm: flowSessao.concluidaEm,
      })
      .from(flowSessao)
      .where(eq(flowSessao.token, token));
    if (!s) return null;
    const { expiraEm, concluidaEm, ...resto } = s;
    return { ...resto, expirada: expiraEm.getTime() < Date.now(), concluida: concluidaEm !== null };
  });
}

export interface ObraParaAgenda {
  tenantId: string;
  obraId: string;
  horarioAnuncio: string;
  fusoHorario: string;
}

/** Worker: obras ativas de todas as construtoras, para manter os agendamentos do anúncio diário. */
export async function listarObrasParaAgenda(): Promise<ObraParaAgenda[]> {
  return comoSistema((tx) =>
    tx
      .select({
        tenantId: obra.tenantId,
        obraId: obra.id,
        horarioAnuncio: obra.horarioAnuncio,
        fusoHorario: obra.fusoHorario,
      })
      .from(obra)
      .innerJoin(tenant, eq(tenant.id, obra.tenantId))
      .where(eq(obra.status, "ativa")),
  );
}
