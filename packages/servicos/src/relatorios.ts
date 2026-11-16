import { schema, withTenant } from "@canteirocheck/db";
import { idJob, obterFila } from "@canteirocheck/queue";
import { type FotoRelatorio, gerarPdfExecucao, gerarPdfObra } from "@canteirocheck/reports";
import { chaveDoTenant, gravarObjeto, lerObjeto, urlDeLeitura } from "@canteirocheck/storage";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Contexto, ErroDominio, exigirPapel } from "./contexto";
import { resumoDaExecucao } from "./execucoes/consultas";
import { uuid } from "./validacao";

const { relatorio, midia, obra, execucaoEtapa, etapa, local, usuario, pendencia, eventoCusto } = schema;

/**
 * Job `gerar_pdf`. O PDF fica no bucket com sha256 na tabela `relatorio`; o painel só serve por
 * URL assinada de 5 min. Cada geração é uma linha nova (o histórico de relatórios não é sobrescrito).
 */
export async function gerarRelatorio(p: {
  tenantId: string;
  obraId: string;
  execucaoId: string | null;
  solicitadoPorId: string | null;
}): Promise<{ relatorioId: string }> {
  const agora = new Date();
  let pdf: Buffer;
  let nome: string;

  if (p.execucaoId) {
    const execucaoId = p.execucaoId;
    const r = await withTenant(p.tenantId, (tx) => resumoDaExecucao(tx, execucaoId));
    if (!r) throw new ErroDominio("nao_encontrado", "Execução não encontrada.");
    const ids = r.rodadas.flatMap((rod) =>
      rod.pontos.flatMap((pt) => [
        ...pt.tentativas.flatMap((t) => t.midias),
        ...(pt.divergencia?.midias ?? []),
      ]),
    );
    const armazenadas = ids.length
      ? await withTenant(p.tenantId, (tx) =>
          tx
            .select({ id: midia.id, chave: midia.storageKey, sha256: midia.sha256 })
            .from(midia)
            .where(
              and(
                inArray(
                  midia.id,
                  ids.map((m) => m.id),
                ),
                eq(midia.status, "armazenada"),
              ),
            ),
        )
      : [];
    const fotos = new Map<string, FotoRelatorio>();
    for (const m of armazenadas) {
      if (!m.chave || !m.sha256) continue;
      fotos.set(m.id, { dados: Buffer.from(await lerObjeto(m.chave)), sha256: m.sha256 });
    }
    pdf = await gerarPdfExecucao(r, fotos, agora);
    nome = `execucao-${r.id}-r${r.rodadaAtual}-${agora.getTime()}.pdf`;
  } else {
    const dados = await withTenant(p.tenantId, async (tx) => {
      const responsavel = schema.usuario;
      const [o] = await tx
        .select({ nome: obra.nome, endereco: obra.endereco, eng: responsavel.nome })
        .from(obra)
        .innerJoin(responsavel, eq(responsavel.id, obra.engenheiroResponsavelId))
        .where(eq(obra.id, p.obraId));
      if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
      const execs = await tx
        .select({ id: execucaoEtapa.id })
        .from(execucaoEtapa)
        .where(eq(execucaoEtapa.obraId, p.obraId))
        .orderBy(desc(execucaoEtapa.dataPrevista));
      const linhas = [];
      for (const e of execs) {
        const r = await resumoDaExecucao(tx, e.id);
        if (!r) continue;
        const ultima = r.rodadas.at(-1);
        const dec = [...r.rodadas].reverse().find((x) => x.decisao)?.decisao;
        linhas.push({
          id: r.id,
          etapaNome: r.etapaNome,
          localNome: r.localNome,
          dataPrevista: r.dataPrevista,
          status: r.status,
          rodadas: r.rodadaAtual,
          ok: ultima?.ok ?? 0,
          divergentes: r.rodadas.reduce((n, x) => n + x.divergentes, 0),
          causas: r.rodadas.flatMap((x) =>
            x.pontos.flatMap((pt) => (pt.divergencia ? [pt.divergencia.causa] : [])),
          ),
          decisao: dec
            ? `${dec.decisao === "liberada" ? "Liberada" : "Recusada"} por ${dec.engenheiroNome} em ${dec.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}${dec.justificativa ? `: ${dec.justificativa}` : ""}`
            : null,
        });
      }
      const [pend] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(pendencia)
        .where(and(eq(pendencia.obraId, p.obraId), eq(pendencia.status, "aberta")));
      const [custo] = await tx
        .select({ total: sql<string>`coalesce(sum(${eventoCusto.custoEstimado}), 0)::text` })
        .from(eventoCusto)
        .where(eq(eventoCusto.obraId, p.obraId));
      return {
        obraNome: o.nome,
        endereco: o.endereco,
        engenheiroResponsavel: o.eng,
        custoEstimadoUsd: Number(custo?.total ?? 0).toFixed(2),
        pendenciasAbertas: pend?.n ?? 0,
        linhas,
      };
    });
    pdf = await gerarPdfObra(dados, agora);
    nome = `obra-${p.obraId}-${agora.getTime()}.pdf`;
  }

  const chave = chaveDoTenant(p.tenantId, "relatorios", nome);
  const { sha256 } = await gravarObjeto(chave, pdf, "application/pdf");
  const [linha] = await withTenant(p.tenantId, (tx) =>
    tx
      .insert(relatorio)
      .values({
        tenantId: p.tenantId,
        obraId: p.obraId,
        execucaoId: p.execucaoId,
        storageKey: chave,
        sha256,
        geradoPorId: p.solicitadoPorId,
      })
      .returning({ id: relatorio.id }),
  );
  if (!linha) throw new Error("falha ao registrar relatório");
  return { relatorioId: linha.id };
}

/** Painel: pede um PDF (execução ou obra). O worker gera em segundo plano. */
export async function solicitarRelatorio(
  ctx: Contexto,
  entrada: { obraId: string; execucaoId?: string | null },
) {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(entrada.obraId).success) throw new ErroDominio("invalido", "Obra inválida.");
  const [o] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ id: obra.id }).from(obra).where(eq(obra.id, entrada.obraId)),
  );
  if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
  await obterFila().enfileirar(
    "gerar_pdf",
    {
      tenantId: ctx.tenantId,
      obraId: o.id,
      execucaoId: entrada.execucaoId ?? null,
      solicitadoPorId: ctx.usuarioId,
    },
    { jobId: idJob("pdf", entrada.execucaoId ?? o.id, "painel", Math.floor(Date.now() / 10_000)) },
  );
}

export interface RelatorioListado {
  id: string;
  execucaoId: string | null;
  titulo: string;
  geradoPor: string | null;
  criadoEm: Date;
  sha256: string;
}

export async function listarRelatorios(
  ctx: Contexto,
  filtro: { obraId: string; execucaoId?: string },
): Promise<RelatorioListado[]> {
  if (!uuid.safeParse(filtro.obraId).success) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const linhas = await tx
      .select({
        id: relatorio.id,
        execucaoId: relatorio.execucaoId,
        etapa: etapa.nome,
        local: local.nome,
        geradoPor: usuario.nome,
        criadoEm: relatorio.criadoEm,
        sha256: relatorio.sha256,
      })
      .from(relatorio)
      .leftJoin(execucaoEtapa, eq(execucaoEtapa.id, relatorio.execucaoId))
      .leftJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .leftJoin(local, eq(local.id, execucaoEtapa.localId))
      .leftJoin(usuario, eq(usuario.id, relatorio.geradoPorId))
      .where(
        and(
          eq(relatorio.obraId, filtro.obraId),
          filtro.execucaoId ? eq(relatorio.execucaoId, filtro.execucaoId) : undefined,
          filtro.execucaoId === null ? isNull(relatorio.execucaoId) : undefined,
        ),
      )
      .orderBy(desc(relatorio.criadoEm))
      .limit(50);
    return linhas.map((l) => ({
      id: l.id,
      execucaoId: l.execucaoId,
      titulo: l.execucaoId ? `${l.etapa} · ${l.local}` : "Relatório da obra",
      geradoPor: l.geradoPor,
      criadoEm: l.criadoEm,
      sha256: l.sha256,
    }));
  });
}

export async function urlDoRelatorio(ctx: Contexto, id: string): Promise<string | null> {
  if (!uuid.safeParse(id).success) return null;
  const [r] = await withTenant(ctx.tenantId, (tx) => tx.select().from(relatorio).where(eq(relatorio.id, id)));
  if (!r) return null;
  return urlDeLeitura(r.storageKey, r.storageKey.split("/").at(-1));
}
