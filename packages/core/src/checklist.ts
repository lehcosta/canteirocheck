/**
 * Motor do checklist. O estado é DERIVADO das verificações já gravadas na rodada: o endpoint do
 * Flow não guarda cursor próprio, então reabrir a conferência no meio continua de onde parou.
 *
 * Por ponto: medir → (fora) remedir → (fora de novo) causa → divergente.
 * Dentro da tolerância em qualquer tentativa → ok.
 */

export const TENTATIVAS_ANTES_DA_CAUSA = 2;
/** Limite do Flow: a tela de entrada alcança cada ponto, e uma tela tem no máximo 10 ramos (9 + resumo). */
export const MAX_PONTOS_POR_SESSAO = 9;

export interface RegistroVerificacao {
  pontoId: string;
  tentativa: number;
  dentro: boolean;
  /** Já existe divergência (causa) gravada para esta verificação. */
  comDivergencia: boolean;
}

export type SituacaoPonto =
  | { tipo: "medir"; tentativa: number; anteriorFora: boolean }
  | { tipo: "causa"; tentativa: number }
  | { tipo: "ok"; tentativa: number }
  | { tipo: "divergente"; tentativa: number };

export function situacaoDoPonto(pontoId: string, registros: readonly RegistroVerificacao[]): SituacaoPonto {
  const doPonto = registros.filter((r) => r.pontoId === pontoId);
  if (doPonto.length === 0) return { tipo: "medir", tentativa: 1, anteriorFora: false };
  const ultima = doPonto.reduce((a, b) => (b.tentativa > a.tentativa ? b : a));
  if (ultima.dentro) return { tipo: "ok", tentativa: ultima.tentativa };
  if (doPonto.some((r) => r.comDivergencia)) return { tipo: "divergente", tentativa: ultima.tentativa };
  if (ultima.tentativa >= TENTATIVAS_ANTES_DA_CAUSA) return { tipo: "causa", tentativa: ultima.tentativa };
  return { tipo: "medir", tentativa: ultima.tentativa + 1, anteriorFora: true };
}

export type Passo =
  | { tipo: "medir"; indice: number; pontoId: string; tentativa: number; anteriorFora: boolean }
  | { tipo: "causa"; indice: number; pontoId: string; tentativa: number }
  | { tipo: "resumo" };

/** Próximo passo da sessão: o primeiro ponto (na ordem da sessão) que ainda pede ação. */
export function proximoPasso(
  pontosDaSessao: readonly string[],
  registros: readonly RegistroVerificacao[],
): Passo {
  for (const [indice, pontoId] of pontosDaSessao.entries()) {
    const s = situacaoDoPonto(pontoId, registros);
    if (s.tipo === "medir") {
      return { tipo: "medir", indice, pontoId, tentativa: s.tentativa, anteriorFora: s.anteriorFora };
    }
    if (s.tipo === "causa") return { tipo: "causa", indice, pontoId, tentativa: s.tentativa };
  }
  return { tipo: "resumo" };
}

export interface ResumoChecklist {
  ok: string[];
  divergentes: string[];
  pendentes: string[];
  completo: boolean;
}

export function resumir(
  pontos: readonly string[],
  registros: readonly RegistroVerificacao[],
): ResumoChecklist {
  const r: ResumoChecklist = { ok: [], divergentes: [], pendentes: [], completo: false };
  for (const id of pontos) {
    const s = situacaoDoPonto(id, registros);
    if (s.tipo === "ok") r.ok.push(id);
    else if (s.tipo === "divergente") r.divergentes.push(id);
    else r.pendentes.push(id);
  }
  r.completo = r.pendentes.length === 0;
  return r;
}

// ─────────────────────────── Ordem e lotes ───────────────────────────

export interface PontoOrdenavel {
  id: string;
  descricao: string;
  ehInterface: boolean;
  /** Vezes que este ponto (ou equivalente) já falhou nesta obra. */
  falhasAnteriores: number;
  regiao: string | null;
  localNome: string;
}

/** Interfaces primeiro, depois os que já falharam nesta obra, depois o resto. */
export function ordenarPontos<T extends PontoOrdenavel>(pontos: readonly T[]): T[] {
  return [...pontos].sort(
    (a, b) =>
      Number(b.ehInterface) - Number(a.ehInterface) ||
      Number(b.falhasAnteriores > 0) - Number(a.falhasAnteriores > 0) ||
      b.falhasAnteriores - a.falhasAnteriores ||
      a.descricao.localeCompare(b.descricao, "pt-BR"),
  );
}

export interface Lote<T> {
  titulo: string;
  pontos: T[];
}

/**
 * Cada sessão do Flow cobre no máximo 9 pontos. Acima disso, agrupa por região
 * ("Laje L4 — eixos A a D") e divide regiões grandes em partes.
 */
export function agruparEmLotes<T extends PontoOrdenavel>(
  pontos: readonly T[],
  max: number = MAX_PONTOS_POR_SESSAO,
): Lote<T>[] {
  if (pontos.length === 0) return [];
  if (pontos.length <= max) return [{ titulo: tituloUnico(pontos), pontos: ordenarPontos(pontos) }];

  const porRegiao = new Map<string, T[]>();
  for (const p of pontos) {
    const chave = p.regiao?.trim() || p.localNome;
    porRegiao.set(chave, [...(porRegiao.get(chave) ?? []), p]);
  }
  const regioes = [...porRegiao.entries()].sort(
    ([ta, a], [tb, b]) =>
      Number(b.some((p) => p.ehInterface)) - Number(a.some((p) => p.ehInterface)) ||
      soma(b) - soma(a) ||
      ta.localeCompare(tb, "pt-BR"),
  );

  const lotes: Lote<T>[] = [];
  for (const [titulo, doGrupo] of regioes) {
    const ordenados = ordenarPontos(doGrupo);
    const partes = Math.ceil(ordenados.length / max);
    for (let i = 0; i < partes; i++) {
      lotes.push({
        titulo: partes > 1 ? `${titulo} (${i + 1}/${partes})` : titulo,
        pontos: ordenados.slice(i * max, (i + 1) * max),
      });
    }
  }
  return lotes;
}

function soma(pontos: readonly PontoOrdenavel[]) {
  return pontos.reduce((n, p) => n + p.falhasAnteriores, 0);
}

function tituloUnico(pontos: readonly PontoOrdenavel[]): string {
  const regioes = new Set(pontos.map((p) => p.regiao?.trim() || p.localNome));
  return regioes.size === 1 ? ([...regioes][0] ?? "Pontos") : "Todos os pontos";
}
