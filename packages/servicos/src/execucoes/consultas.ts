import {
  formatarComprimento,
  formatarDiferenca,
  formatarEsperado,
  resumir,
  type StatusExecucao,
  type Unidade,
} from "@canteirocheck/core";
import { schema, type Tx, withTenant } from "@canteirocheck/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Contexto } from "../contexto";
import { uuid } from "../validacao";
import { carregarPontos, registrosDaRodada } from "./pontos";

const { execucaoEtapa, obra, etapa, local, usuario, verificacao, divergencia, liberacao, midia } = schema;

export interface TentativaNoResumo {
  verificacaoId: string;
  tentativa: number;
  valorMedido: string | null;
  valorReferencia: string | null;
  mesmaReferenciaNivel: boolean | null;
  diferenca: string | null;
  dentro: boolean;
  observacao: string | null;
  canal: string;
  estruturada: boolean;
  usuarioNome: string;
  criadoEm: Date;
  midias: { id: string; status: string }[];
  /** Texto pronto: "6,040 m (L3 6,000 m, dif. +4 cm)". */
  texto: string;
}

export interface PontoNoResumo {
  pontoId: string;
  descricao: string;
  ehInterface: boolean;
  esperado: string;
  situacao: "ok" | "divergente" | "pendente";
  tentativas: TentativaNoResumo[];
  divergencia: {
    causa: string;
    descricao: string | null;
    criadoEm: Date;
    midias: { id: string; status: string }[];
  } | null;
}

export interface RodadaNoResumo {
  rodada: number;
  pontos: PontoNoResumo[];
  ok: number;
  divergentes: number;
  pendentes: number;
  decisao: {
    decisao: "liberada" | "recusada";
    justificativa: string | null;
    engenheiroNome: string;
    canal: string;
    criadoEm: Date;
  } | null;
}

export interface ResumoExecucao {
  id: string;
  tenantId: string;
  obraId: string;
  obraNome: string;
  etapaNome: string;
  localNome: string;
  dataPrevista: string;
  status: StatusExecucao;
  rodadaAtual: number;
  anunciadaPor: string;
  engenheiroResponsavel: { id: string; nome: string };
  criadoEm: Date;
  rodadas: RodadaNoResumo[];
}

function textoTentativa(
  t: {
    valorMedido: string | null;
    valorReferencia: string | null;
    diferenca: string | null;
    mesmaReferenciaNivel: boolean | null;
    unidade: Unidade;
    dentro: boolean;
  },
  ehInterface: boolean,
): string {
  if (t.unidade === "booleano" || t.valorMedido === null) return t.dentro ? "existe" : "não existe";
  const medido = formatarComprimento(t.valorMedido, t.unidade);
  if (!ehInterface || t.valorReferencia === null) return medido;
  const ref = formatarComprimento(t.valorReferencia, t.unidade);
  const dif = t.diferenca ? `, dif. ${formatarDiferenca(t.diferenca, t.unidade)}` : "";
  const rn = t.mesmaReferenciaNivel === false ? ", RN diferente" : "";
  return `${medido} (lado executado ${ref}${dif}${rn})`;
}

/** Tudo de uma execução, rodada por rodada: base do painel, da mensagem ao engenheiro e do PDF. */
export async function resumoDaExecucao(tx: Tx, execucaoId: string): Promise<ResumoExecucao | null> {
  const anunciante = alias(usuario, "anunciante");
  const responsavel = alias(usuario, "responsavel");
  const [e] = await tx
    .select({
      exec: execucaoEtapa,
      obraNome: obra.nome,
      etapaNome: etapa.nome,
      localNome: local.nome,
      anunciadaPor: anunciante.nome,
      engId: responsavel.id,
      engNome: responsavel.nome,
    })
    .from(execucaoEtapa)
    .innerJoin(obra, eq(obra.id, execucaoEtapa.obraId))
    .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
    .innerJoin(local, eq(local.id, execucaoEtapa.localId))
    .innerJoin(anunciante, eq(anunciante.id, execucaoEtapa.anunciadaPorId))
    .innerJoin(responsavel, eq(responsavel.id, obra.engenheiroResponsavelId))
    .where(eq(execucaoEtapa.id, execucaoId));
  if (!e) return null;
  const exec = e.exec;

  const pontos = await carregarPontos(tx, exec);
  const verifs = await tx
    .select({ v: verificacao, usuarioNome: usuario.nome })
    .from(verificacao)
    .innerJoin(usuario, eq(usuario.id, verificacao.usuarioId))
    .where(eq(verificacao.execucaoId, exec.id))
    .orderBy(asc(verificacao.rodada), asc(verificacao.tentativa), asc(verificacao.criadoEm));
  const divs = await tx.select().from(divergencia).where(eq(divergencia.execucaoId, exec.id));
  const idsVerif = verifs.map((x) => x.v.id);
  const idsDiv = divs.map((d) => d.id);
  const midias = idsVerif.length
    ? await tx
        .select({ id: midia.id, status: midia.status, verificacaoId: midia.verificacaoId })
        .from(midia)
        .where(inArray(midia.verificacaoId, idsVerif))
    : [];
  const midiasDiv = idsDiv.length
    ? await tx
        .select({ id: midia.id, status: midia.status, divergenciaId: midia.divergenciaId })
        .from(midia)
        .where(inArray(midia.divergenciaId, idsDiv))
    : [];
  const decisoes = await tx
    .select({ l: liberacao, engenheiroNome: usuario.nome })
    .from(liberacao)
    .innerJoin(usuario, eq(usuario.id, liberacao.engenheiroId))
    .where(eq(liberacao.execucaoId, exec.id));

  const rodadas: RodadaNoResumo[] = [];
  for (let rodada = 1; rodada <= exec.rodadaAtual; rodada++) {
    const registros = await registrosDaRodada(tx, exec.id, rodada);
    const r = resumir(
      pontos.map((p) => p.id),
      registros,
    );
    const situacao = (id: string) =>
      r.ok.includes(id) ? "ok" : r.divergentes.includes(id) ? "divergente" : ("pendente" as const);
    const dec = decisoes.find((d) => d.l.rodada === rodada);
    rodadas.push({
      rodada,
      ok: r.ok.length,
      divergentes: r.divergentes.length,
      pendentes: r.pendentes.length,
      decisao: dec
        ? {
            decisao: dec.l.decisao,
            justificativa: dec.l.justificativa,
            engenheiroNome: dec.engenheiroNome,
            canal: dec.l.canal,
            criadoEm: dec.l.criadoEm,
          }
        : null,
      pontos: pontos.map((p) => {
        const tentativas = verifs
          .filter((x) => x.v.pontoId === p.id && x.v.rodada === rodada)
          .map(({ v, usuarioNome }) => ({
            verificacaoId: v.id,
            tentativa: v.tentativa,
            valorMedido: v.valorMedido,
            valorReferencia: v.valorReferencia,
            mesmaReferenciaNivel: v.mesmaReferenciaNivel,
            diferenca: v.diferenca,
            dentro: v.dentroTolerancia,
            observacao: v.observacao,
            canal: v.canal,
            estruturada: v.estruturada,
            usuarioNome,
            criadoEm: v.criadoEm,
            midias: midias.filter((m) => m.verificacaoId === v.id).map(({ id, status }) => ({ id, status })),
            texto: textoTentativa(
              { ...v, unidade: v.unidade as Unidade, dentro: v.dentroTolerancia },
              p.ehInterface,
            ),
          }));
        const d = divs.find((x) => tentativas.some((t) => t.verificacaoId === x.verificacaoId));
        return {
          pontoId: p.id,
          descricao: p.descricao,
          ehInterface: p.ehInterface,
          esperado: formatarEsperado(p),
          situacao: situacao(p.id),
          tentativas,
          divergencia: d
            ? {
                causa: d.causaProvavel,
                descricao: d.descricao,
                criadoEm: d.criadoEm,
                midias: midiasDiv
                  .filter((m) => m.divergenciaId === d.id)
                  .map(({ id, status }) => ({ id, status })),
              }
            : null,
        };
      }),
    });
  }

  return {
    id: exec.id,
    tenantId: exec.tenantId,
    obraId: exec.obraId,
    obraNome: e.obraNome,
    etapaNome: e.etapaNome,
    localNome: e.localNome,
    dataPrevista: exec.dataPrevista,
    status: exec.status,
    rodadaAtual: exec.rodadaAtual,
    anunciadaPor: e.anunciadaPor,
    engenheiroResponsavel: { id: e.engId, nome: e.engNome },
    criadoEm: exec.criadoEm,
    rodadas,
  };
}

export async function obterExecucao(ctx: Contexto, execucaoId: string): Promise<ResumoExecucao | null> {
  if (!uuid.safeParse(execucaoId).success) return null;
  return withTenant(ctx.tenantId, (tx) => resumoDaExecucao(tx, execucaoId));
}

export interface ItemLinhaDoTempo {
  id: string;
  etapaNome: string;
  localNome: string;
  dataPrevista: string;
  status: StatusExecucao;
  rodadaAtual: number;
  anunciadaPor: string;
  criadoEm: Date;
}

/** Execuções da obra, mais recentes primeiro. */
export async function linhaDoTempo(ctx: Contexto, obraId: string): Promise<ItemLinhaDoTempo[]> {
  if (!uuid.safeParse(obraId).success) return [];
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: execucaoEtapa.id,
        etapaNome: etapa.nome,
        localNome: local.nome,
        dataPrevista: execucaoEtapa.dataPrevista,
        status: execucaoEtapa.status,
        rodadaAtual: execucaoEtapa.rodadaAtual,
        anunciadaPor: usuario.nome,
        criadoEm: execucaoEtapa.criadoEm,
      })
      .from(execucaoEtapa)
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .innerJoin(local, eq(local.id, execucaoEtapa.localId))
      .innerJoin(usuario, eq(usuario.id, execucaoEtapa.anunciadaPorId))
      .where(and(eq(execucaoEtapa.obraId, obraId)))
      .orderBy(desc(execucaoEtapa.dataPrevista), desc(execucaoEtapa.criadoEm)),
  );
}
