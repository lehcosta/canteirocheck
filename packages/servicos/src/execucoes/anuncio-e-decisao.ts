import { aguardaDecisao, liberacaoExigeJustificativa } from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx } from "@canteirocheck/db";
import { idJob } from "@canteirocheck/queue";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { type Contexto, ErroDominio } from "../contexto";
import type { Efeitos } from "../transacao";
import { aplicarEvento } from "./conferencia";
import { carregarPontos, travarExecucao } from "./pontos";

const { obra, obraMembro, local, etapa, execucaoEtapa, pendencia, estadoEtapaLocal, liberacao } = schema;

// ─────────────────────────── Anúncio ───────────────────────────

export interface OpcoesAnuncio {
  obras: { id: string; nome: string }[];
  etapas: { id: number; codigo: string; nome: string }[];
  locais: { id: string; obraId: string; nome: string; tipo: string }[];
}

/** Obras em que o usuário trabalha, etapas do catálogo e locais (para o Flow de anúncio). */
export async function opcoesDeAnuncio(tx: Tx, usuarioId: string): Promise<OpcoesAnuncio> {
  const obras = await tx
    .select({ id: obra.id, nome: obra.nome })
    .from(obra)
    .innerJoin(obraMembro, and(eq(obraMembro.obraId, obra.id), eq(obraMembro.usuarioId, usuarioId)))
    .where(eq(obra.status, "ativa"))
    .orderBy(asc(obra.nome));
  const etapas = await tx
    .select({ id: etapa.id, codigo: etapa.codigo, nome: etapa.nome })
    .from(etapa)
    .orderBy(asc(etapa.ordem));
  const locais = obras.length
    ? await tx
        .select({ id: local.id, obraId: local.obraId, nome: local.nome, tipo: local.tipo })
        .from(local)
        .where(
          and(
            inArray(
              local.obraId,
              obras.map((o) => o.id),
            ),
            notInArray(local.tipo, ["eixo"]),
          ),
        )
        .orderBy(asc(local.tipo), asc(local.nome))
    : [];
  return { obras, etapas, locais };
}

export interface ExecucaoAnunciada {
  id: string;
  localId: string;
  localNome: string;
  nova: boolean;
  status: string;
  semPontos: boolean;
}

export interface EntradaAnuncio {
  obraId: string;
  etapaId: number;
  localIds: string[];
  dataPrevista: string; // YYYY-MM-DD
}

/**
 * "Concretagem da L4 amanhã". Reaproveita a execução em aberto da etapa × local (inclusive a
 * recusada, que volta a ser conferida numa nova rodada); senão cria. Pendência de projeto aberta
 * que bloqueia a etapa → aviso ao engenheiro.
 */
export async function anunciarExecucoes(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  entrada: EntradaAnuncio,
): Promise<{ obraNome: string; etapaNome: string; execucoes: ExecucaoAnunciada[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.dataPrevista)) throw new ErroDominio("invalido", "Data inválida.");
  if (entrada.localIds.length === 0) throw new ErroDominio("invalido", "Escolha ao menos um local.");

  const [o] = await tx
    .select({ id: obra.id, nome: obra.nome, status: obra.status })
    .from(obra)
    .where(eq(obra.id, entrada.obraId));
  if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");
  if (o.status !== "ativa") throw new ErroDominio("invalido", "A obra não está ativa.");
  if (ctx.papel !== "admin") {
    const [m] = await tx
      .select({ u: obraMembro.usuarioId })
      .from(obraMembro)
      .where(and(eq(obraMembro.obraId, o.id), eq(obraMembro.usuarioId, ctx.usuarioId)));
    if (!m) throw new ErroDominio("permissao", "Você não faz parte da equipe desta obra.");
  }
  const [e] = await tx.select().from(etapa).where(eq(etapa.id, entrada.etapaId));
  if (!e) throw new ErroDominio("invalido", "Etapa inválida.");
  const locais = await tx
    .select({ id: local.id, nome: local.nome })
    .from(local)
    .where(and(eq(local.obraId, o.id), inArray(local.id, entrada.localIds)));
  if (locais.length !== new Set(entrada.localIds).size) throw new ErroDominio("invalido", "Local inválido.");

  const pendencias = await tx
    .select({ id: pendencia.id })
    .from(pendencia)
    .where(
      and(eq(pendencia.obraId, o.id), eq(pendencia.status, "aberta"), eq(pendencia.etapaBloqueadaId, e.id)),
    );

  const execucoes: ExecucaoAnunciada[] = [];
  for (const l of locais) {
    const [aberta] = await tx
      .select()
      .from(execucaoEtapa)
      .where(
        and(
          eq(execucaoEtapa.localId, l.id),
          eq(execucaoEtapa.etapaId, e.id),
          notInArray(execucaoEtapa.status, ["liberada", "cancelada"]),
        ),
      )
      .for("update");
    let exec = aberta;
    const nova = !aberta;
    if (!exec) {
      [exec] = await tx
        .insert(execucaoEtapa)
        .values({
          tenantId: ctx.tenantId,
          obraId: o.id,
          etapaId: e.id,
          localId: l.id,
          dataPrevista: entrada.dataPrevista,
          anunciadaPorId: ctx.usuarioId,
        })
        .returning();
    } else if (exec.status === "anunciada" && exec.dataPrevista !== entrada.dataPrevista) {
      [exec] = await tx
        .update(execucaoEtapa)
        .set({ dataPrevista: entrada.dataPrevista, versao: exec.versao + 1 })
        .where(eq(execucaoEtapa.id, exec.id))
        .returning();
    }
    if (!exec) throw new Error("falha ao anunciar execução");

    await tx
      .insert(estadoEtapaLocal)
      .values({ tenantId: ctx.tenantId, obraId: o.id, localId: l.id, etapaId: e.id, status: "em_andamento" })
      .onConflictDoUpdate({
        target: [estadoEtapaLocal.localId, estadoEtapaLocal.etapaId],
        set: {
          status: sql`case when ${estadoEtapaLocal.status} = 'concluida' then 'concluida'::status_etapa_local else 'em_andamento'::status_etapa_local end`,
        },
      });

    if (nova) {
      await registrarAuditoria(tx, {
        tenantId: ctx.tenantId,
        ator: { tipo: "usuario", id: ctx.usuarioId },
        acao: "execucao.anunciada",
        entidade: "execucao_etapa",
        entidadeId: exec.id,
        depois: { etapa: e.codigo, local: l.nome, dataPrevista: entrada.dataPrevista },
      });
    }
    if (pendencias.length > 0) {
      efeitos.enfileirar(
        "avisar_pendencia",
        { tenantId: ctx.tenantId, execucaoId: exec.id },
        { jobId: idJob("pend", exec.id, exec.rodadaAtual) },
      );
    }
    const pontos = await carregarPontos(tx, exec);
    execucoes.push({
      id: exec.id,
      localId: l.id,
      localNome: l.nome,
      nova,
      status: exec.status,
      semPontos: pontos.length === 0,
    });
  }
  return { obraNome: o.nome, etapaNome: e.nome, execucoes };
}

// ─────────────────────────── Decisão do engenheiro ───────────────────────────

export interface EntradaDecisao {
  execucaoId: string;
  rodada: number;
  decisao: "liberada" | "recusada";
  justificativa?: string | null;
  canal: "flow" | "conversa" | "painel";
}

/**
 * Liberar ou recusar. Só o engenheiro responsável da obra decide; recusa sempre exige
 * justificativa e liberar uma execução bloqueada (com divergência) também.
 * Uma decisão por rodada: o UNIQUE (execucao, rodada) impede decisão dupla.
 */
export async function decidirExecucao(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  entrada: EntradaDecisao,
): Promise<{ liberacaoId: string; status: string }> {
  let exec = await travarExecucao(tx, entrada.execucaoId);
  const [o] = await tx
    .select({ responsavel: obra.engenheiroResponsavelId })
    .from(obra)
    .where(eq(obra.id, exec.obraId));
  if (!o || o.responsavel !== ctx.usuarioId) {
    throw new ErroDominio("permissao", "Só o engenheiro responsável pela obra libera ou recusa etapas.");
  }
  if (exec.rodadaAtual !== entrada.rodada) {
    throw new ErroDominio("conflito", "Esta decisão é de uma rodada anterior: a conferência foi refeita.");
  }
  const [jaDecidida] = await tx
    .select({ decisao: liberacao.decisao })
    .from(liberacao)
    .where(and(eq(liberacao.execucaoId, exec.id), eq(liberacao.rodada, entrada.rodada)));
  if (jaDecidida) throw new ErroDominio("conflito", `Esta conferência já foi ${jaDecidida.decisao}.`);
  if (!aguardaDecisao(exec.status)) {
    throw new ErroDominio("conflito", `A execução está "${exec.status}" e não aguarda decisão.`);
  }

  const justificativa = entrada.justificativa?.trim() || null;
  if (entrada.decisao === "recusada" && !justificativa) {
    throw new ErroDominio("invalido", "Para recusar, escreva a justificativa.");
  }
  if (entrada.decisao === "liberada" && liberacaoExigeJustificativa(exec.status) && !justificativa) {
    throw new ErroDominio(
      "invalido",
      "Há divergência confirmada: para liberar assim mesmo, escreva a justificativa.",
    );
  }

  const [lib] = await tx
    .insert(liberacao)
    .values({
      tenantId: exec.tenantId,
      execucaoId: exec.id,
      rodada: exec.rodadaAtual,
      decisao: entrada.decisao,
      justificativa,
      engenheiroId: ctx.usuarioId,
      canal: entrada.canal,
    })
    .returning({ id: liberacao.id });
  if (!lib) throw new Error("falha ao gravar liberação");

  const antes = exec.status;
  exec = await aplicarEvento(tx, exec, entrada.decisao === "liberada" ? "liberar" : "recusar");
  if (exec.status === "liberada") {
    await tx
      .update(estadoEtapaLocal)
      .set({ status: "concluida" })
      .where(and(eq(estadoEtapaLocal.localId, exec.localId), eq(estadoEtapaLocal.etapaId, exec.etapaId)));
  }
  await registrarAuditoria(tx, {
    tenantId: exec.tenantId,
    ator: { tipo: "usuario", id: ctx.usuarioId },
    acao: entrada.decisao === "liberada" ? "execucao.liberada" : "execucao.recusada",
    entidade: "execucao_etapa",
    entidadeId: exec.id,
    antes: { status: antes },
    depois: { status: exec.status, rodada: exec.rodadaAtual, justificativa, canal: entrada.canal },
  });
  efeitos.enfileirar(
    "notificar_encarregado",
    { tenantId: exec.tenantId, liberacaoId: lib.id },
    { jobId: idJob("enc", lib.id) },
  );
  efeitos.enfileirar(
    "gerar_pdf",
    { tenantId: exec.tenantId, obraId: exec.obraId, execucaoId: exec.id, solicitadoPorId: null },
    { jobId: idJob("pdf", exec.id, exec.rodadaAtual) },
  );
  return { liberacaoId: lib.id, status: exec.status };
}
