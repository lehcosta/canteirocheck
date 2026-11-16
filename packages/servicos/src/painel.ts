import { schema, withTenant } from "@canteirocheck/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type Contexto, ErroDominio, exigirPapel } from "./contexto";
import { decidirExecucao } from "./execucoes/anuncio-e-decisao";
import { emTransacao } from "./transacao";
import { uuid } from "./validacao";

const { execucaoEtapa, etapa, local, eventoCusto, pendencia } = schema;

/** Liberar/recusar pelo painel (mesmas regras do WhatsApp; canal "painel"). */
export async function decidirPeloPainel(
  ctx: Contexto,
  entrada: {
    execucaoId: string;
    rodada: number;
    decisao: "liberada" | "recusada";
    justificativa?: string | null;
  },
) {
  exigirPapel(ctx, ["engenheiro"]);
  if (!uuid.safeParse(entrada.execucaoId).success) throw new ErroDominio("invalido", "Execução inválida.");
  if (!Number.isInteger(entrada.rodada) || entrada.rodada < 1)
    throw new ErroDominio("invalido", "Rodada inválida.");
  return emTransacao(ctx.tenantId, (tx, efeitos) =>
    decidirExecucao(tx, efeitos, ctx, { ...entrada, canal: "painel" }),
  );
}

export interface PainelObra {
  aguardandoDecisao: {
    id: string;
    etapaNome: string;
    localNome: string;
    status: string;
    dataPrevista: string;
  }[];
  emAndamento: number;
  pendenciasAbertas: number;
  custo: { total: string; porTipo: { tipo: string; quantidade: string; total: string }[] };
}

/** Resumo da obra: o que espera decisão, pendências e custo acumulado (prompt §9 — contador por obra). */
export async function painelDaObra(ctx: Contexto, obraId: string): Promise<PainelObra | null> {
  if (!uuid.safeParse(obraId).success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const aguardando = await tx
      .select({
        id: execucaoEtapa.id,
        etapaNome: etapa.nome,
        localNome: local.nome,
        status: execucaoEtapa.status,
        dataPrevista: execucaoEtapa.dataPrevista,
      })
      .from(execucaoEtapa)
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .innerJoin(local, eq(local.id, execucaoEtapa.localId))
      .where(
        and(
          eq(execucaoEtapa.obraId, obraId),
          inArray(execucaoEtapa.status, ["bloqueada", "aguardando_liberacao"]),
        ),
      )
      .orderBy(desc(execucaoEtapa.dataPrevista));
    const [andamento] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(execucaoEtapa)
      .where(
        and(
          eq(execucaoEtapa.obraId, obraId),
          inArray(execucaoEtapa.status, ["anunciada", "em_conferencia", "recusada"]),
        ),
      );
    const [pend] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pendencia)
      .where(and(eq(pendencia.obraId, obraId), eq(pendencia.status, "aberta")));
    const porTipo = await tx
      .select({
        tipo: eventoCusto.tipo,
        quantidade: sql<string>`sum(${eventoCusto.quantidade})::text`,
        total: sql<string>`sum(${eventoCusto.custoEstimado})::text`,
      })
      .from(eventoCusto)
      .where(eq(eventoCusto.obraId, obraId))
      .groupBy(eventoCusto.tipo);
    const total = porTipo.reduce((s, x) => s + Number(x.total), 0);
    return {
      aguardandoDecisao: aguardando,
      emAndamento: andamento?.n ?? 0,
      pendenciasAbertas: pend?.n ?? 0,
      custo: { total: total.toFixed(4), porTipo },
    };
  });
}
