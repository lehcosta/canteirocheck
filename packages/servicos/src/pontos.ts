import {
  converter,
  formatarEsperado,
  type Grandeza,
  lerNumero,
  MENSAGEM_ERRO_NUMERO,
  type Unidade,
} from "@canteirocheck/core";
import { registrarAuditoria, schema, withTenant } from "@canteirocheck/db";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ator, type Contexto, ErroDominio, exigirPapel, traduzirErroBanco } from "./contexto";
import { primeiraMensagem, textoObrigatorio, textoOpcional, uuid } from "./validacao";

const { pontoControle, etapa, local, toleranciaPadrao, usuario } = schema;

// ─────────────────────────── Leitura ───────────────────────────

export interface PontoListado {
  id: string;
  etapaId: number;
  etapaNome: string;
  localId: string;
  localNome: string;
  localReferenciaNome: string | null;
  regiao: string | null;
  descricao: string;
  grandeza: Grandeza;
  unidade: Unidade;
  esperado: string;
  toleranciaPropria: boolean;
  ehInterface: boolean;
  exigeFoto: boolean;
  origem: "ia" | "manual";
  statusRevisao: "sugerido" | "aprovado" | "descartado";
  trechoOrigem: string | null;
  revisadoPor: string | null;
}

/** Pontos da obra por etapa e local; sem tolerância própria, mostra a padrão da construtora. */
export async function listarPontos(ctx: Contexto, obraId: string): Promise<PontoListado[]> {
  if (!uuid.safeParse(obraId).success) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const ref = alias(local, "local_ref");
    const linhas = await tx
      .select({
        p: pontoControle,
        etapaNome: etapa.nome,
        etapaOrdem: etapa.ordem,
        localNome: local.nome,
        localReferenciaNome: ref.nome,
        revisadoPor: usuario.nome,
      })
      .from(pontoControle)
      .innerJoin(etapa, eq(etapa.id, pontoControle.etapaId))
      .innerJoin(local, eq(local.id, pontoControle.localId))
      .leftJoin(ref, eq(ref.id, pontoControle.localReferenciaId))
      .leftJoin(usuario, eq(usuario.id, pontoControle.revisadoPorId))
      .where(eq(pontoControle.obraId, obraId))
      .orderBy(asc(etapa.ordem), asc(local.nome), asc(pontoControle.criadoEm));
    const padroes = await tx.select().from(toleranciaPadrao);
    return linhas.map(({ p, ...l }) => {
      const padrao = padroes.find((x) => x.grandeza === p.grandeza);
      const propria = p.toleranciaMais !== null && p.toleranciaMenos !== null;
      // Tolerância padrão vem na unidade dela; converte para a unidade do ponto.
      const conv = (v: string) =>
        padrao && p.grandeza !== "existencia"
          ? converter(v, padrao.unidade as Unidade, p.unidade).toFixed()
          : "0";
      const tol = propria
        ? { mais: p.toleranciaMais ?? "0", menos: p.toleranciaMenos ?? "0" }
        : {
            mais: padrao ? conv(padrao.toleranciaMais) : "0",
            menos: padrao ? conv(padrao.toleranciaMenos) : "0",
          };
      return {
        id: p.id,
        etapaId: p.etapaId,
        etapaNome: l.etapaNome,
        localId: p.localId,
        localNome: l.localNome,
        localReferenciaNome: l.localReferenciaNome,
        regiao: p.regiao,
        descricao: p.descricao,
        grandeza: p.grandeza,
        unidade: p.unidade,
        esperado: formatarEsperado({
          grandeza: p.grandeza,
          unidade: p.unidade,
          valorEsperado: p.valorEsperado,
          toleranciaMais: tol.mais,
          toleranciaMenos: tol.menos,
          ehInterface: p.ehInterface,
        }),
        toleranciaPropria: propria,
        ehInterface: p.ehInterface,
        exigeFoto: p.exigeFoto,
        origem: p.origem,
        statusRevisao: p.statusRevisao,
        trechoOrigem: p.trechoOrigem,
        revisadoPor: l.revisadoPor,
      };
    });
  });
}

// ─────────────────────────── Escrita ───────────────────────────

const numero = (rotulo: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, c) => {
      if (!v) return null;
      const r = lerNumero(v);
      if (!r.ok) {
        c.addIssue({ code: "custom", message: `${rotulo}: ${MENSAGEM_ERRO_NUMERO[r.erro]}` });
        return z.NEVER;
      }
      return r.valor.toFixed();
    });

const marcado = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const entradaPonto = z
  .object({
    obraId: uuid,
    etapaId: z.coerce.number().int().positive({ message: "Escolha a etapa." }),
    localId: uuid,
    regiao: textoOpcional(120),
    descricao: textoObrigatorio("Descrição", 300),
    grandeza: z.enum(["nivel", "distancia", "prumo", "esquadro", "existencia"], {
      message: "Grandeza inválida.",
    }),
    unidade: z.enum(["m", "cm", "mm", "booleano"], { message: "Unidade inválida." }),
    valorEsperado: numero("Valor esperado"),
    toleranciaMais: numero("Tolerância +"),
    toleranciaMenos: numero("Tolerância −"),
    ehInterface: marcado,
    localReferenciaId: z
      .string()
      .optional()
      .transform((v) => v || null)
      .pipe(uuid.nullable()),
    referenciaNivel: textoOpcional(60),
    exigeFoto: marcado,
  })
  .superRefine((p, c) => {
    if (p.grandeza === "existencia") {
      if (p.unidade !== "booleano")
        c.addIssue({ code: "custom", message: "Existência usa a unidade sim/não." });
    } else {
      if (p.unidade === "booleano") c.addIssue({ code: "custom", message: "Escolha m, cm ou mm." });
      if (p.valorEsperado === null) c.addIssue({ code: "custom", message: "Informe o valor esperado." });
    }
    if ((p.toleranciaMais === null) !== (p.toleranciaMenos === null)) {
      c.addIssue({ code: "custom", message: "Informe as duas tolerâncias ou nenhuma (usa a padrão)." });
    }
    if (p.ehInterface && !p.localReferenciaId) {
      c.addIssue({ code: "custom", message: "Interface precisa do local já executado (referência)." });
    }
  });

/**
 * Ponto manual. Criado por engenheiro já nasce aprovado (é a decisão dele); criado por admin
 * nasce sugerido e precisa da aprovação de um engenheiro antes de entrar no checklist.
 */
export async function criarPontoManual(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaPonto.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const d = r.data;
  return withTenant(ctx.tenantId, async (tx) => {
    const locais = await tx.select({ id: local.id }).from(local).where(eq(local.obraId, d.obraId));
    const ids = new Set(locais.map((l) => l.id));
    if (!ids.has(d.localId) || (d.localReferenciaId && !ids.has(d.localReferenciaId))) {
      throw new ErroDominio("invalido", "Os locais precisam ser desta obra.");
    }
    const engenheiro = ctx.papel === "engenheiro";
    try {
      const [novo] = await tx
        .insert(pontoControle)
        .values({
          tenantId: ctx.tenantId,
          ...d,
          valorEsperado: d.grandeza === "existencia" ? null : d.valorEsperado,
          origem: "manual",
          statusRevisao: engenheiro ? "aprovado" : "sugerido",
          revisadoPorId: engenheiro ? ctx.usuarioId : null,
          revisadoEm: engenheiro ? new Date() : null,
        })
        .returning();
      if (!novo) throw new Error("falha ao criar ponto");
      await registrarAuditoria(tx, {
        tenantId: ctx.tenantId,
        ator: ator(ctx),
        acao: "ponto.criado",
        entidade: "ponto_controle",
        entidadeId: novo.id,
        depois: novo,
      });
      return { id: novo.id };
    } catch (e) {
      traduzirErroBanco(e, {
        valor_esperado_conforme_grandeza: "Valor esperado incompatível com a grandeza.",
        tolerancias_nao_negativas: "Tolerâncias não podem ser negativas.",
        interface_tem_referencia: "Interface precisa do local de referência.",
      });
    }
  });
}

/** Revisão do engenheiro: aprovar (entra no checklist) ou descartar. Só engenheiro decide. */
export async function revisarPonto(
  ctx: Contexto,
  entrada: { pontoId: string; decisao: "aprovar" | "descartar" },
) {
  exigirPapel(ctx, ["engenheiro"]);
  if (!uuid.safeParse(entrada.pontoId).success) throw new ErroDominio("invalido", "Ponto inválido.");
  await withTenant(ctx.tenantId, async (tx) => {
    const [antes] = await tx.select().from(pontoControle).where(eq(pontoControle.id, entrada.pontoId));
    if (!antes) throw new ErroDominio("nao_encontrado", "Ponto não encontrado.");
    const status = entrada.decisao === "aprovar" ? "aprovado" : "descartado";
    if (antes.statusRevisao === status) return;
    await tx
      .update(pontoControle)
      .set({ statusRevisao: status, revisadoPorId: ctx.usuarioId, revisadoEm: new Date() })
      .where(eq(pontoControle.id, entrada.pontoId));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: entrada.decisao === "aprovar" ? "ponto.aprovado" : "ponto.descartado",
      entidade: "ponto_controle",
      entidadeId: antes.id,
      antes: { statusRevisao: antes.statusRevisao },
      depois: { statusRevisao: status },
    });
  });
}

// ─────────────────────────── Tolerâncias padrão ───────────────────────────

export async function listarTolerancias(ctx: Contexto) {
  return withTenant(ctx.tenantId, (tx) =>
    tx.select().from(toleranciaPadrao).orderBy(asc(toleranciaPadrao.grandeza)),
  );
}

export const entradaTolerancia = z.object({
  grandeza: z.enum(["nivel", "distancia", "prumo", "esquadro"], { message: "Grandeza inválida." }),
  unidade: z.enum(["m", "cm", "mm"], { message: "Unidade inválida." }),
  toleranciaMais: numero("Tolerância +").pipe(z.string({ message: "Informe a tolerância +." })),
  toleranciaMenos: numero("Tolerância −").pipe(z.string({ message: "Informe a tolerância −." })),
});

export async function definirTolerancia(ctx: Contexto, entrada: unknown) {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaTolerancia.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const d = r.data;
  await withTenant(ctx.tenantId, async (tx) => {
    const [antes] = await tx
      .select()
      .from(toleranciaPadrao)
      .where(and(eq(toleranciaPadrao.grandeza, d.grandeza)));
    try {
      await tx
        .insert(toleranciaPadrao)
        .values({ tenantId: ctx.tenantId, ...d })
        .onConflictDoUpdate({
          target: [toleranciaPadrao.tenantId, toleranciaPadrao.grandeza],
          set: { unidade: d.unidade, toleranciaMais: d.toleranciaMais, toleranciaMenos: d.toleranciaMenos },
        });
    } catch (e) {
      traduzirErroBanco(e, { tolerancia_padrao_nao_negativa: "Tolerâncias não podem ser negativas." });
    }
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "tolerancia.definida",
      entidade: "tolerancia_padrao",
      entidadeId: d.grandeza,
      antes: antes ?? null,
      depois: d,
    });
  });
}

/** Catálogo de etapas (global, sem tenant), na ordem da obra. */
export async function opcoesEtapas(ctx: Contexto): Promise<{ id: number; codigo: string; nome: string }[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx.select({ id: etapa.id, codigo: etapa.codigo, nome: etapa.nome }).from(etapa).orderBy(asc(etapa.ordem)),
  );
}
