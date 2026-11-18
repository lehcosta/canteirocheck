import { itensParados, metricasPorEtapa, schema, withTenant } from "@canteirocheck/db";
import { idJob, obterFila } from "@canteirocheck/queue";
import { and, eq, sql } from "drizzle-orm";
import type { Contexto } from "./contexto";
import { uuid } from "./validacao";

const { execucaoEtapa, etapa, divergencia, liberacao, verificacao } = schema;

// ─────────────────────────── Registro em memória (por processo) ───────────────────────────

const LIMITES_MS = [100, 250, 500, 1000, 2500, 5000, 10000];

interface Histograma {
  baldes: number[];
  soma: number;
  total: number;
}

declare global {
  var __canteiroMetricas:
    | { contadores: Map<string, number>; histogramas: Map<string, Histograma> }
    | undefined;
}

function registro() {
  globalThis.__canteiroMetricas ??= { contadores: new Map(), histogramas: new Map() };
  return globalThis.__canteiroMetricas;
}

const chave = (nome: string, rotulos: Record<string, string>) =>
  `${nome}{${Object.entries(rotulos)
    .map(([k, v]) => `${k}="${v.replace(/"/g, "")}"`)
    .join(",")}}`;

export function contar(nome: string, rotulos: Record<string, string> = {}, n = 1) {
  const c = registro().contadores;
  const k = chave(nome, rotulos);
  c.set(k, (c.get(k) ?? 0) + n);
}

export function observarDuracao(nome: string, ms: number, rotulos: Record<string, string> = {}) {
  const h = registro().histogramas;
  const k = chave(nome, rotulos);
  const atual = h.get(k) ?? { baldes: LIMITES_MS.map(() => 0), soma: 0, total: 0 };
  LIMITES_MS.forEach((limite, i) => {
    if (ms <= limite) atual.baldes[i] = (atual.baldes[i] ?? 0) + 1;
  });
  atual.soma += ms;
  atual.total++;
  h.set(k, atual);
}

/** Log estruturado (JSON, uma linha). */
export function logar(nivel: "info" | "warn" | "error", evento: string, dados: Record<string, unknown> = {}) {
  const linha = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...dados });
  if (nivel === "error") console.error(linha);
  else console.log(linha);
}

// ─────────────────────────── Exposição (Prometheus) ───────────────────────────

/** Texto no formato de exposição do Prometheus: métricas de processo + por etapa + filas. */
export async function exporMetricas(): Promise<string> {
  const linhas: string[] = [];
  const r = registro();
  for (const [k, v] of r.contadores) linhas.push(`${k} ${v}`);
  for (const [k, h] of r.histogramas) {
    const [nome, rot = "}"] = k.split("{");
    const base = rot === "}" ? "" : rot.slice(0, -1);
    LIMITES_MS.forEach((l, i) => {
      linhas.push(`${nome}_bucket{${base ? `${base},` : ""}le="${l}"} ${h.baldes[i] ?? 0}`);
    });
    linhas.push(`${nome}_bucket{${base ? `${base},` : ""}le="+Inf"} ${h.total}`);
    linhas.push(`${nome}_sum{${base}} ${h.soma}`, `${nome}_count{${base}} ${h.total}`);
  }
  const m = await metricasPorEtapa();
  linhas.push("# TYPE canteiro_execucoes gauge");
  for (const e of m.execucoes)
    linhas.push(`canteiro_execucoes{etapa="${e.etapa}",status="${e.status}"} ${e.quantidade}`);
  linhas.push("# TYPE canteiro_divergencias gauge");
  for (const d of m.divergencias) linhas.push(`canteiro_divergencias{etapa="${d.etapa}"} ${d.quantidade}`);
  linhas.push("# TYPE canteiro_horas_ate_liberacao gauge");
  for (const t of m.horasAteLiberacao) {
    if (t.p50 !== null)
      linhas.push(
        `canteiro_horas_ate_liberacao{etapa="${t.etapa}",quantil="0.5"} ${Number(t.p50).toFixed(2)}`,
      );
    if (t.p90 !== null)
      linhas.push(
        `canteiro_horas_ate_liberacao{etapa="${t.etapa}",quantil="0.9"} ${Number(t.p90).toFixed(2)}`,
      );
  }
  return `${linhas.join("\n")}\n`;
}

// ─────────────────────────── Varredura (worker) ───────────────────────────

/** Job `varredura`: devolve à fila o que ficou parado. jobId novo por janela de 10 min. */
export async function varrerParados(minutos = 3): Promise<{ reenfileirados: number }> {
  const fila = obterFila();
  const janela = Math.floor(Date.now() / 600_000);
  const itens = await itensParados(minutos);
  for (const i of itens) {
    if (i.tipo === "mensagem") {
      await fila.enfileirar(
        "enviar_mensagem",
        { tenantId: i.tenantId, mensagemId: i.id },
        { jobId: idJob("env", i.id, "v", janela) },
      );
    } else if (i.tipo === "midia") {
      await fila.enfileirar(
        "baixar_midia",
        { tenantId: i.tenantId, midiaId: i.id },
        { jobId: idJob("midia", i.id, "v", janela) },
      );
    } else if (i.tipo === "cronograma") {
      await fila.enfileirar(
        "ler_cronograma",
        { tenantId: i.tenantId, versaoId: i.id },
        { jobId: idJob("crono", i.id, "v", janela) },
      );
    } else {
      await fila.enfileirar(
        "extrair_dwg",
        { tenantId: i.tenantId, projetoId: i.id },
        { jobId: idJob("dwg", i.id, "v", janela) },
      );
    }
  }
  if (itens.length)
    logar("warn", "varredura.reenfileirou", {
      quantidade: itens.length,
      tipos: [...new Set(itens.map((i) => i.tipo))],
    });
  return { reenfileirados: itens.length };
}

// ─────────────────────────── Indicadores da obra (painel) ───────────────────────────

export interface IndicadorEtapa {
  etapa: string;
  execucoes: number;
  liberadas: number;
  bloqueadasOuRecusadas: number;
  okNaPrimeiraRodada: number;
  divergencias: number;
  causas: { causa: string; quantidade: number }[];
  horasAteLiberacaoMedia: number | null;
  medidasNaoEstruturadas: number;
}

export async function indicadoresDaObra(ctx: Contexto, obraId: string): Promise<IndicadorEtapa[]> {
  if (!uuid.safeParse(obraId).success) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const base = await tx
      .select({
        etapa: etapa.nome,
        ordem: etapa.ordem,
        execucoes: sql<number>`count(*)::int`,
        liberadas: sql<number>`count(*) filter (where ${execucaoEtapa.status} = 'liberada')::int`,
        problemas: sql<number>`count(*) filter (where ${execucaoEtapa.status} in ('bloqueada', 'recusada') or ${execucaoEtapa.rodadaAtual} > 1)::int`,
        primeira: sql<number>`count(*) filter (where ${execucaoEtapa.status} = 'liberada' and ${execucaoEtapa.rodadaAtual} = 1)::int`,
      })
      .from(execucaoEtapa)
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .where(eq(execucaoEtapa.obraId, obraId))
      .groupBy(etapa.nome, etapa.ordem)
      .orderBy(etapa.ordem);
    const causas = await tx
      .select({ etapa: etapa.nome, causa: divergencia.causaProvavel, n: sql<number>`count(*)::int` })
      .from(divergencia)
      .innerJoin(execucaoEtapa, eq(execucaoEtapa.id, divergencia.execucaoId))
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .where(eq(execucaoEtapa.obraId, obraId))
      .groupBy(etapa.nome, divergencia.causaProvavel);
    const tempos = await tx
      .select({
        etapa: etapa.nome,
        horas: sql<
          number | null
        >`avg(extract(epoch from ${liberacao.criadoEm} - ${execucaoEtapa.criadoEm}) / 3600)::float`,
      })
      .from(liberacao)
      .innerJoin(execucaoEtapa, eq(execucaoEtapa.id, liberacao.execucaoId))
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .where(and(eq(execucaoEtapa.obraId, obraId), eq(liberacao.decisao, "liberada")))
      .groupBy(etapa.nome);
    const naoEstruturadas = await tx
      .select({ etapa: etapa.nome, n: sql<number>`count(*)::int` })
      .from(verificacao)
      .innerJoin(execucaoEtapa, eq(execucaoEtapa.id, verificacao.execucaoId))
      .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
      .where(and(eq(execucaoEtapa.obraId, obraId), eq(verificacao.estruturada, false)))
      .groupBy(etapa.nome);
    return base.map((b) => {
      const cs = causas.filter((c) => c.etapa === b.etapa).sort((a, z) => z.n - a.n);
      return {
        etapa: b.etapa,
        execucoes: b.execucoes,
        liberadas: b.liberadas,
        bloqueadasOuRecusadas: b.problemas,
        okNaPrimeiraRodada: b.primeira,
        divergencias: cs.reduce((s, c) => s + c.n, 0),
        causas: cs.map((c) => ({ causa: c.causa, quantidade: c.n })),
        horasAteLiberacaoMedia: tempos.find((t) => t.etapa === b.etapa)?.horas ?? null,
        medidasNaoEstruturadas: naoEstruturadas.find((n) => n.etapa === b.etapa)?.n ?? 0,
      };
    });
  });
}
