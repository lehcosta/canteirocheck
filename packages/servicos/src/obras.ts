import { CATALOGO, ehPlanoPago, limiteDeObras } from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ator, type Contexto, ErroDominio, exigirPapel, traduzirErroBanco } from "./contexto";
import { primeiraMensagem, textoObrigatorio, textoOpcional, uuid } from "./validacao";

const { obra, obraMembro, local, usuario, pendencia, execucaoEtapa, tenant } = schema;

// ─────────────────────────── Leitura ───────────────────────────

export interface ResumoObra {
  id: string;
  nome: string;
  endereco: string | null;
  status: "ativa" | "pausada" | "concluida";
  engenheiroResponsavel: string;
  pendenciasAbertas: number;
  execucoesBloqueadas: number;
}

export async function listarObras(ctx: Contexto): Promise<ResumoObra[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const obras = await tx
      .select({
        id: obra.id,
        nome: obra.nome,
        endereco: obra.endereco,
        status: obra.status,
        engenheiroResponsavel: usuario.nome,
      })
      .from(obra)
      .innerJoin(usuario, eq(usuario.id, obra.engenheiroResponsavelId))
      .orderBy(asc(obra.nome));

    const pend = await tx
      .select({ obraId: pendencia.obraId, n: count() })
      .from(pendencia)
      .where(eq(pendencia.status, "aberta"))
      .groupBy(pendencia.obraId);
    const bloq = await tx
      .select({ obraId: execucaoEtapa.obraId, n: count() })
      .from(execucaoEtapa)
      .where(eq(execucaoEtapa.status, "bloqueada"))
      .groupBy(execucaoEtapa.obraId);

    const porObra = (linhas: { obraId: string; n: number }[]) => new Map(linhas.map((l) => [l.obraId, l.n]));
    const pendMap = porObra(pend);
    const bloqMap = porObra(bloq);
    return obras.map((o) => ({
      ...o,
      pendenciasAbertas: pendMap.get(o.id) ?? 0,
      execucoesBloqueadas: bloqMap.get(o.id) ?? 0,
    }));
  });
}

export interface DetalheObra {
  id: string;
  nome: string;
  endereco: string | null;
  areaM2: string | null;
  status: "ativa" | "pausada" | "concluida";
  horarioAnuncio: string;
  fusoHorario: string;
  engenheiroResponsavel: { id: string; nome: string };
  locais: {
    id: string;
    tipo: "pavimento" | "laje" | "ambiente" | "eixo";
    nome: string;
    paiId: string | null;
  }[];
  membros: {
    usuarioId: string;
    nome: string;
    papel: "admin" | "engenheiro" | "encarregado";
    whatsappE164: string;
  }[];
}

export async function obterObra(ctx: Contexto, obraId: string): Promise<DetalheObra | null> {
  if (!uuid.safeParse(obraId).success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const [o] = await tx
      .select({
        id: obra.id,
        nome: obra.nome,
        endereco: obra.endereco,
        areaM2: obra.areaM2,
        status: obra.status,
        horarioAnuncio: obra.horarioAnuncio,
        fusoHorario: obra.fusoHorario,
        engenheiroId: usuario.id,
        engenheiroNome: usuario.nome,
      })
      .from(obra)
      .innerJoin(usuario, eq(usuario.id, obra.engenheiroResponsavelId))
      .where(eq(obra.id, obraId));
    if (!o) return null;

    const locais = await tx
      .select({ id: local.id, tipo: local.tipo, nome: local.nome, paiId: local.paiId })
      .from(local)
      .where(eq(local.obraId, obraId))
      .orderBy(asc(local.tipo), asc(local.nome));
    const membros = await tx
      .select({
        usuarioId: usuario.id,
        nome: usuario.nome,
        papel: obraMembro.papel,
        whatsappE164: usuario.whatsappE164,
      })
      .from(obraMembro)
      .innerJoin(usuario, eq(usuario.id, obraMembro.usuarioId))
      .where(eq(obraMembro.obraId, obraId))
      .orderBy(asc(usuario.nome));

    const { engenheiroId, engenheiroNome, ...resto } = o;
    return { ...resto, engenheiroResponsavel: { id: engenheiroId, nome: engenheiroNome }, locais, membros };
  });
}

// ─────────────────────────── Escrita ───────────────────────────

export const entradaCriarObra = z.object({
  nome: textoObrigatorio("Nome da obra"),
  endereco: textoOpcional(300),
  areaM2: z
    .string()
    .trim()
    .optional()
    .transform((v, c) => {
      if (!v) return null;
      const n = v.replace(/\./g, "").replace(",", ".");
      if (!/^\d+(\.\d{1,2})?$/.test(n)) {
        c.addIssue({ code: "custom", message: "Área inválida. Ex.: 1250,50" });
        return z.NEVER;
      }
      return n;
    }),
  engenheiroResponsavelId: uuid,
  horarioAnuncio: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { message: "Horário inválido (HH:mm)." })
    .default("16:00"),
});

/**
 * Barra a obra nova além do teto do plano. Duas criações juntas não passam as duas: a trava é um
 * advisory lock da construtora (o app não tem UPDATE em tenant, então `FOR UPDATE` não serve).
 */
async function conferirLimiteDeObras(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`obras:${tenantId}`}, 0))`);
  const [t] = await tx
    .select({ plano: tenant.plano, status: tenant.assinaturaStatus })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const limite = t ? limiteDeObras(t.plano, t.status) : null;
  if (limite === null) return;
  const [ativas] = await tx.select({ n: count() }).from(obra).where(eq(obra.status, "ativa"));
  if ((ativas?.n ?? 0) < limite) return;
  if (limite === 0) {
    throw new ErroDominio(
      "conflito",
      "A assinatura não está ativa. Regularize em Assinatura para abrir obras.",
    );
  }
  const nome = t && ehPlanoPago(t.plano) ? CATALOGO[t.plano].nome : t?.plano;
  throw new ErroDominio(
    "conflito",
    `O plano ${nome} vai até ${limite} obras ativas. Troque de plano em Assinatura para abrir outra.`,
  );
}

export async function criarObra(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin"]);
  const r = entradaCriarObra.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const dados = r.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const [eng] = await tx
      .select({ id: usuario.id })
      .from(usuario)
      .where(
        and(
          eq(usuario.id, dados.engenheiroResponsavelId),
          eq(usuario.papel, "engenheiro"),
          eq(usuario.ativo, true),
        ),
      );
    if (!eng) throw new ErroDominio("invalido", "Escolha um engenheiro ativo como responsável.");
    await conferirLimiteDeObras(tx, ctx.tenantId);

    const [nova] = await tx
      .insert(obra)
      .values({ tenantId: ctx.tenantId, ...dados })
      .returning();
    if (!nova) throw new Error("falha ao criar obra");

    await tx
      .insert(obraMembro)
      .values({ tenantId: ctx.tenantId, obraId: nova.id, usuarioId: eng.id, papel: "engenheiro" });
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "obra.criada",
      entidade: "obra",
      entidadeId: nova.id,
      depois: nova,
    });
    return { id: nova.id };
  });
}

export const entradaCriarLocal = z.object({
  obraId: uuid,
  tipo: z.enum(["pavimento", "laje", "ambiente", "eixo"], { message: "Tipo de local inválido." }),
  nome: textoObrigatorio("Nome do local", 80),
  paiId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(uuid.nullable()),
});

export async function criarLocal(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaCriarLocal.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const dados = r.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const [o] = await tx.select({ id: obra.id }).from(obra).where(eq(obra.id, dados.obraId));
    if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
    if (dados.paiId) {
      const [pai] = await tx
        .select({ id: local.id })
        .from(local)
        .where(and(eq(local.id, dados.paiId), eq(local.obraId, dados.obraId)));
      if (!pai) throw new ErroDominio("invalido", "O local pai precisa ser da mesma obra.");
    }
    try {
      const [novo] = await tx
        .insert(local)
        .values({ tenantId: ctx.tenantId, ...dados })
        .returning();
      if (!novo) throw new Error("falha ao criar local");
      await registrarAuditoria(tx, {
        tenantId: ctx.tenantId,
        ator: ator(ctx),
        acao: "local.criado",
        entidade: "local",
        entidadeId: novo.id,
        depois: novo,
      });
      return { id: novo.id };
    } catch (e) {
      traduzirErroBanco(e, { _padrao: "Já existe um local com esse tipo e nome nesta obra." });
    }
  });
}

export const entradaMembro = z.object({ obraId: uuid, usuarioId: uuid });

export async function adicionarMembro(ctx: Contexto, entrada: unknown): Promise<void> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaMembro.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const { obraId, usuarioId } = r.data;

  await withTenant(ctx.tenantId, async (tx) => {
    const [o] = await tx.select({ id: obra.id }).from(obra).where(eq(obra.id, obraId));
    const [u] = await tx
      .select({ id: usuario.id, papel: usuario.papel, ativo: usuario.ativo })
      .from(usuario)
      .where(eq(usuario.id, usuarioId));
    if (!o || !u) throw new ErroDominio("nao_encontrado", "Obra ou usuário não encontrado.");
    if (!u.ativo) throw new ErroDominio("invalido", "Usuário inativo não pode entrar na obra.");
    try {
      await tx.insert(obraMembro).values({ tenantId: ctx.tenantId, obraId, usuarioId, papel: u.papel });
    } catch (e) {
      traduzirErroBanco(e, { _padrao: "Este usuário já faz parte da obra." });
    }
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "obra.membro_adicionado",
      entidade: "obra",
      entidadeId: obraId,
      depois: { usuarioId, papel: u.papel },
    });
  });
}

export async function removerMembro(ctx: Contexto, entrada: unknown): Promise<void> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaMembro.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const { obraId, usuarioId } = r.data;

  await withTenant(ctx.tenantId, async (tx) => {
    const [o] = await tx
      .select({ engenheiroId: obra.engenheiroResponsavelId })
      .from(obra)
      .where(eq(obra.id, obraId));
    if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
    if (o.engenheiroId === usuarioId) {
      throw new ErroDominio("invalido", "O engenheiro responsável não pode ser removido da obra.");
    }
    const removidos = await tx
      .delete(obraMembro)
      .where(and(eq(obraMembro.obraId, obraId), eq(obraMembro.usuarioId, usuarioId)))
      .returning();
    if (removidos.length === 0) return;
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "obra.membro_removido",
      entidade: "obra",
      entidadeId: obraId,
      antes: removidos[0],
    });
  });
}
