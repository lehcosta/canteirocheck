import {
  converter,
  type Grandeza,
  type PontoAvaliavel,
  type PontoOrdenavel,
  type RegistroVerificacao,
  type Unidade,
} from "@canteirocheck/core";
import { schema, type Tx } from "@canteirocheck/db";
import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ErroDominio } from "../contexto";

const { pontoControle, local, toleranciaPadrao, verificacao, divergencia, execucaoEtapa } = schema;

/** Ponto aprovado, com a tolerância já resolvida (do ponto ou padrão da construtora) na unidade do ponto. */
export interface PontoDaExecucao extends PontoAvaliavel, PontoOrdenavel {
  id: string;
  descricao: string;
  exigeFoto: boolean;
  referenciaNivel: string | null;
  localReferenciaNome: string | null;
}

export interface ExecucaoBase {
  id: string;
  obraId: string;
  etapaId: number;
  localId: string;
  rodadaAtual: number;
}

/** Pontos aprovados da etapa × local da execução. Sem aprovação do engenheiro, o ponto não entra. */
export async function carregarPontos(tx: Tx, exec: ExecucaoBase): Promise<PontoDaExecucao[]> {
  const localRef = alias(local, "local_ref");
  const linhas = await tx
    .select({
      id: pontoControle.id,
      descricao: pontoControle.descricao,
      grandeza: pontoControle.grandeza,
      unidade: pontoControle.unidade,
      valorEsperado: pontoControle.valorEsperado,
      toleranciaMais: pontoControle.toleranciaMais,
      toleranciaMenos: pontoControle.toleranciaMenos,
      ehInterface: pontoControle.ehInterface,
      exigeFoto: pontoControle.exigeFoto,
      regiao: pontoControle.regiao,
      referenciaNivel: pontoControle.referenciaNivel,
      localNome: local.nome,
      localReferenciaNome: localRef.nome,
    })
    .from(pontoControle)
    .innerJoin(local, eq(local.id, pontoControle.localId))
    .leftJoin(localRef, eq(localRef.id, pontoControle.localReferenciaId))
    .where(
      and(
        eq(pontoControle.obraId, exec.obraId),
        eq(pontoControle.etapaId, exec.etapaId),
        eq(pontoControle.localId, exec.localId),
        eq(pontoControle.statusRevisao, "aprovado"),
      ),
    )
    .orderBy(asc(pontoControle.criadoEm));
  if (linhas.length === 0) return [];

  const padroes = await tx.select().from(toleranciaPadrao);
  const falhas = await tx
    .select({ pontoId: verificacao.pontoId, n: count() })
    .from(verificacao)
    .where(
      and(
        inArray(
          verificacao.pontoId,
          linhas.map((l) => l.id),
        ),
        eq(verificacao.dentroTolerancia, false),
        // falhas de rodadas anteriores (ou de outras execuções), não da rodada em curso
        or(ne(verificacao.execucaoId, exec.id), sql`${verificacao.rodada} < ${exec.rodadaAtual}`),
      ),
    )
    .groupBy(verificacao.pontoId);
  const falhasPorPonto = new Map(falhas.map((f) => [f.pontoId, f.n]));

  return linhas.map((l) => {
    const tolerancia = resolverTolerancia(l, padroes);
    return {
      ...l,
      grandeza: l.grandeza as Grandeza,
      unidade: l.unidade as Unidade,
      toleranciaMais: tolerancia.mais,
      toleranciaMenos: tolerancia.menos,
      falhasAnteriores: falhasPorPonto.get(l.id) ?? 0,
    };
  });
}

function resolverTolerancia(
  p: {
    grandeza: string;
    unidade: string;
    toleranciaMais: string | null;
    toleranciaMenos: string | null;
    descricao: string;
  },
  padroes: (typeof toleranciaPadrao.$inferSelect)[],
): { mais: string; menos: string } {
  if (p.grandeza === "existencia") return { mais: "0", menos: "0" };
  if (p.toleranciaMais !== null && p.toleranciaMenos !== null) {
    return { mais: p.toleranciaMais, menos: p.toleranciaMenos };
  }
  const padrao = padroes.find((x) => x.grandeza === p.grandeza);
  if (!padrao) {
    throw new ErroDominio(
      "invalido",
      `O ponto "${p.descricao}" não tem tolerância e não há tolerância padrão para ${p.grandeza}.`,
    );
  }
  const de = padrao.unidade as Unidade;
  const para = p.unidade as Unidade;
  return {
    mais: p.toleranciaMais ?? converter(padrao.toleranciaMais, de, para).toFixed(),
    menos: p.toleranciaMenos ?? converter(padrao.toleranciaMenos, de, para).toFixed(),
  };
}

export interface RegistroComId extends RegistroVerificacao {
  verificacaoId: string;
}

/** Verificações da rodada → estado derivado do checklist (core). */
export async function registrosDaRodada(
  tx: Tx,
  execucaoId: string,
  rodada: number,
): Promise<RegistroComId[]> {
  const linhas = await tx
    .select({
      verificacaoId: verificacao.id,
      pontoId: verificacao.pontoId,
      tentativa: verificacao.tentativa,
      dentro: verificacao.dentroTolerancia,
      divergenciaId: divergencia.id,
    })
    .from(verificacao)
    .leftJoin(divergencia, eq(divergencia.verificacaoId, verificacao.id))
    .where(and(eq(verificacao.execucaoId, execucaoId), eq(verificacao.rodada, rodada)));
  return linhas.map(({ divergenciaId, ...l }) => ({ ...l, comDivergencia: divergenciaId !== null }));
}

/** Lê a execução travando a linha (transições concorrentes esperam em fila). */
export async function travarExecucao(tx: Tx, execucaoId: string) {
  const [e] = await tx.select().from(execucaoEtapa).where(eq(execucaoEtapa.id, execucaoId)).for("update");
  if (!e) throw new ErroDominio("nao_encontrado", "Execução não encontrada.");
  return e;
}
