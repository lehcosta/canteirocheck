import { CATALOGO, ehPlanoPago, type FatosDaObra, limiteDeObras } from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import { and, asc, count, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ator, type Contexto, ErroDeCampo, ErroDominio, exigirPapel, traduzirErroBanco } from "./contexto";
import { primeiraMensagem, textoObrigatorio, textoOpcional, uuid } from "./validacao";

const {
  obra,
  obraMembro,
  local,
  usuario,
  pendencia,
  execucaoEtapa,
  tenant,
  pontoControle,
  projeto,
  auditLog,
} = schema;

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

/** O que a faixa "Até a primeira conferência" precisa saber da obra (os passos vêm de `passosDaObra`). */
export interface AndamentoObra {
  fatos: FatosDaObra;
  /** Encarregados ativos da construtora que ainda não estão na equipe desta obra. */
  encarregadosDisponiveis: number;
  pontosSugeridos: { ia: number; manual: number };
  /** A leitura do DWG mais recente (PDFs de referência não contam). */
  leitura: {
    status: "pendente" | "processando" | "concluida" | "falhou";
    codigo: string;
    revisao: string;
    disciplina: string;
    /**
     * As sugestões de ponto desta leitura (só com a leitura concluída): a IA ainda não respondeu, sugeriu
     * pontos, não achou medida no desenho ou falhou.
     */
    sugestoes: "gerando" | "feitas" | "nenhuma" | "falhou" | null;
  } | null;
  /** PDFs de referência da obra. Não são lidos: sozinhos, nunca geram sugestão. */
  pdfsDeReferencia: number;
}

export async function andamentoDaObra(ctx: Contexto, obraId: string): Promise<AndamentoObra | null> {
  if (!uuid.safeParse(obraId).success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const [o] = await tx.select({ id: obra.id }).from(obra).where(eq(obra.id, obraId));
    if (!o) return null;
    const equipe = await tx
      .select({ usuarioId: obraMembro.usuarioId, papel: obraMembro.papel })
      .from(obraMembro)
      .where(eq(obraMembro.obraId, obraId));
    const naEquipe = equipe.map((m) => m.usuarioId);
    const [disponiveis] = await tx
      .select({ n: count() })
      .from(usuario)
      .where(
        and(
          eq(usuario.papel, "encarregado"),
          eq(usuario.ativo, true),
          naEquipe.length ? notInArray(usuario.id, naEquipe) : undefined,
        ),
      );
    const [locais] = await tx.select({ n: count() }).from(local).where(eq(local.obraId, obraId));
    const pontos = await tx
      .select({ status: pontoControle.statusRevisao, origem: pontoControle.origem, n: count() })
      .from(pontoControle)
      .where(eq(pontoControle.obraId, obraId))
      .groupBy(pontoControle.statusRevisao, pontoControle.origem);
    const soma = (f: (p: (typeof pontos)[number]) => boolean) =>
      pontos.filter(f).reduce((t, p) => t + p.n, 0);
    const [ultima] = await tx
      .select({
        id: projeto.id,
        status: projeto.statusExtracao,
        codigo: projeto.codigo,
        revisao: projeto.revisao,
        disciplina: projeto.disciplina,
      })
      .from(projeto)
      .where(and(eq(projeto.obraId, obraId), ne(projeto.statusExtracao, "nao_aplicavel")))
      .orderBy(desc(projeto.criadoEm))
      .limit(1);
    const [pdfs] = await tx
      .select({ n: count() })
      .from(projeto)
      .where(and(eq(projeto.obraId, obraId), eq(projeto.statusExtracao, "nao_aplicavel")));
    // A IA roda depois da leitura e deixa o desfecho na auditoria: é o que separa "ainda gerando" de "nada a sugerir".
    const [desfecho] =
      ultima?.status === "concluida"
        ? await tx
            .select({ acao: auditLog.acao, depois: auditLog.depois })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.entidade, "projeto"),
                eq(auditLog.entidadeId, ultima.id),
                inArray(auditLog.acao, ["projeto.pontos_sugeridos", "projeto.pontos_falhou"]),
              ),
            )
            .orderBy(desc(auditLog.id))
            .limit(1)
        : [];
    const sugestoes =
      ultima?.status !== "concluida"
        ? null
        : !desfecho
          ? "gerando"
          : desfecho.acao === "projeto.pontos_falhou"
            ? "falhou"
            : Number((desfecho.depois as { criados?: number } | null)?.criados ?? 0) > 0
              ? "feitas"
              : "nenhuma";
    const [anunciada] = await tx
      .select({ id: execucaoEtapa.id })
      .from(execucaoEtapa)
      .where(eq(execucaoEtapa.obraId, obraId))
      .limit(1);
    return {
      fatos: {
        temEncarregado: equipe.some((m) => m.papel === "encarregado"),
        locais: locais?.n ?? 0,
        pontosAprovados: soma((p) => p.status === "aprovado"),
        etapaAnunciada: Boolean(anunciada),
      },
      encarregadosDisponiveis: disponiveis?.n ?? 0,
      pontosSugeridos: {
        ia: soma((p) => p.status === "sugerido" && p.origem === "ia"),
        manual: soma((p) => p.status === "sugerido" && p.origem === "manual"),
      },
      leitura:
        ultima && ultima.status !== "nao_aplicavel"
          ? {
              status: ultima.status,
              codigo: ultima.codigo,
              revisao: ultima.revisao,
              disciplina: ultima.disciplina,
              sugestoes,
            }
          : null,
      pdfsDeReferencia: pdfs?.n ?? 0,
    };
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
  if (!r.success) {
    // o formulário mostra a mensagem embaixo do campo que errou
    const campo = r.error.issues[0]?.path[0];
    if (typeof campo === "string") throw new ErroDeCampo(campo, primeiraMensagem(r.error));
    throw new ErroDominio("invalido", primeiraMensagem(r.error));
  }
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
    if (!eng)
      throw new ErroDeCampo("engenheiroResponsavelId", "Escolha um engenheiro ativo como responsável.");
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
