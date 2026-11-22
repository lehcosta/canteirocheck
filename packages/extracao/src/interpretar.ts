import type { Insercao, Polilinha, ResultadoExtracao, Texto } from "./contrato";
import { limparMtext } from "./mtext";

/**
 * Interpretação proprietária da extração bruta do DWG (prompt §6.1): textos limpos, camadas,
 * blocos, cotas de nível, ambientes com área, carimbo e notas. Heurística determinística —
 * nada de IA aqui; a IA (etapa 3) trabalha em cima disto.
 */

export interface TextoLimpo {
  texto: string;
  tipo: Texto["tipo"];
  camada: string;
  bloco: string | null;
  tag: string | null;
  x: number | null;
  y: number | null;
}

export interface CotaNivel {
  texto: string;
  /** Em metros, como string decimal ("6.00", "-0.15"). */
  valor: string;
  referencia: string | null; // "N.A.", "N.P.", "EL." …
  camada: string;
  x: number | null;
  y: number | null;
}

export interface Ambiente {
  nome: string;
  /** m², 2 casas, string decimal. null quando não deu para calcular. */
  areaM2: string | null;
  fonteArea: "texto" | "polilinha" | null;
  camada: string;
  x: number | null;
  y: number | null;
}

export interface Carimbo {
  cliente: string | null;
  obra: string | null;
  titulo: string | null;
  fase: string | null;
  revisao: string | null;
  data: string | null;
  folha: string | null;
  escala: string | null;
  responsavel: string | null;
  /** Todos os atributos lidos, como vieram (tag → valor). */
  atributos: Record<string, string>;
}

export interface ResumoBloco {
  nome: string;
  insercoes: number;
  atributos: string[];
}

export interface Nota {
  texto: string;
  camada: string;
  /** Pré-filtro por regex (sem IA): termos típicos de pendência de projeto. */
  pareceDependencia: boolean;
}

export interface ExtracaoInterpretada {
  textos: TextoLimpo[];
  camadas: ResultadoExtracao["camadas"];
  blocos: ResumoBloco[];
  cotasNivel: CotaNivel[];
  ambientes: Ambiente[];
  carimbo: Carimbo;
  notas: Nota[];
  unidades: { codigo: string | null; metrosPorUnidade: number; assumida: boolean };
}

// ─────────────────────────── Unidades ($INSUNITS) ───────────────────────────

const METROS_POR_UNIDADE: Record<string, number> = {
  "1": 0.0254, // polegada
  "2": 0.3048, // pé
  "4": 0.001, // mm
  "5": 0.01, // cm
  "6": 1, // m
  "14": 0.1, // dm
};

export function metrosPorUnidade(codigo: string | null): { fator: number; assumida: boolean } {
  const f = codigo ? METROS_POR_UNIDADE[codigo] : undefined;
  return f ? { fator: f, assumida: false } : { fator: 1, assumida: true }; // sem unidade: assume metro
}

// ─────────────────────────── Geometria ───────────────────────────

export function areaPoligono(v: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    if (a && b) s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function pontoDentro(x: number, y: number, v: [number, number][]): boolean {
  let dentro = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i];
    const b = v[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) dentro = !dentro;
  }
  return dentro;
}

// ─────────────────────────── Padrões de texto ───────────────────────────

const NUMERO = String.raw`(\d{1,4}(?:[.,]\d{1,3})?)`;
const RE_AREA = new RegExp(
  String.raw`^(?:Á|A)(?:REA)?\s*[:=]?\s*${NUMERO}\s*m(?:²|2)\s*$|^${NUMERO}\s*m(?:²|2)$`,
  "i",
);
// O sinal é obrigatório: "+", "-" ou "−" (menos tipográfico). O hífen vai escapado: "[+-−]" seria a faixa
// de U+002B a U+2212, com dígitos e letras dentro, e a área "47,65" virava o nível -7,65.
const RE_NIVEL =
  /^(N\.?\s?A\.?|N\.?\s?P\.?|N[ÍI]VEL|NIV\.?|EL\.?|COTA)?\s*([+\-−])\s*(\d{1,3}[.,]\d{2,3})\s*m?$/i;
const RE_NIVEL_ZERO = /^(N\.?\s?A\.?|N\.?\s?P\.?|N[ÍI]VEL|EL\.?)?\s*±\s*0[.,]0{2,3}$/i;
const RE_PENDENCIA =
  /\b(a\s+definir|a\s+confirmar|aguardando|verificar|conferir\s+(?:no|em)\s+(?:local|obra)|confirmar\s+(?:no|em)\s+(?:local|obra)|ver\s+projeto|pendente|em\s+aberto|a\s+ser\s+(?:definid|confirmad))/i;

const num = (t: string) => Number(t.replace(",", "."));

export function lerArea(texto: string): number | null {
  const m = RE_AREA.exec(texto.trim());
  const v = m?.[1] ?? m?.[2];
  return v ? num(v) : null;
}

export function lerNivel(texto: string): { valor: string; referencia: string | null } | null {
  const t = texto.trim();
  if (RE_NIVEL_ZERO.test(t))
    return { valor: "0.00", referencia: /^[A-Z]/i.test(t) ? (t.split(/\s*±/)[0] ?? null) : null };
  const m = RE_NIVEL.exec(t);
  if (!m?.[2] || !m[3]) return null;
  const sinal = m[2] === "+" ? "" : "-";
  return {
    valor: `${sinal}${num(m[3]).toFixed(m[3].split(/[.,]/)[1]?.length ?? 2)}`,
    referencia: m[1]?.trim() ?? null,
  };
}

export function pareceDependencia(texto: string): boolean {
  return RE_PENDENCIA.test(texto);
}

function pareceNomeDeAmbiente(t: string): boolean {
  if (t.length < 2 || t.length > 40) return false;
  if (lerArea(t) !== null || lerNivel(t) !== null) return false;
  if (/^[\d\s.,+\-=xX/%°Ø±]+$/.test(t)) return false; // só número/medida
  if (/^(NOTA|OBS|PISO\s*:|FORRO\s*:|PÉ[-\s]?DIREITO|PD\s*[:=])/i.test(t)) return false;
  return /[A-Za-zÀ-ú]{2,}/.test(t);
}

// ─────────────────────────── Interpretação ───────────────────────────

function textosLimpos(r: ResultadoExtracao): TextoLimpo[] {
  const vistos = new Set<string>();
  const saida: TextoLimpo[] = [];
  for (const t of r.textos) {
    const texto = limparMtext(t.conteudo);
    if (!texto) continue;
    const chave = `${t.tipo}|${texto}|${t.camada}|${t.x}|${t.y}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ texto, tipo: t.tipo, camada: t.camada, bloco: t.bloco, tag: t.tag, x: t.x, y: t.y });
  }
  return saida;
}

function blocos(r: ResultadoExtracao): ResumoBloco[] {
  const mapa = new Map<string, ResumoBloco>();
  for (const i of r.insercoes) {
    const b = mapa.get(i.bloco) ?? { nome: i.bloco, insercoes: 0, atributos: [] };
    b.insercoes++;
    for (const a of i.atributos) if (!b.atributos.includes(a.tag)) b.atributos.push(a.tag);
    mapa.set(i.bloco, b);
  }
  return [...mapa.values()].sort((a, b) => b.insercoes - a.insercoes || a.nome.localeCompare(b.nome));
}

function cotasNivel(textos: TextoLimpo[], r: ResultadoExtracao): CotaNivel[] {
  const saida: CotaNivel[] = [];
  for (const t of textos) {
    if (t.tag) continue;
    for (const linha of t.texto.split("\n")) {
      const n = lerNivel(linha);
      if (n) saida.push({ texto: linha, ...n, camada: t.camada, x: t.x, y: t.y });
    }
  }
  // cotas (DIMENSION) com texto de nível em camada de nível
  for (const c of r.cotas) {
    if (!c.texto || !/NIV|LEVEL|COTA.?NIV/i.test(c.camada)) continue;
    const n = lerNivel(limparMtext(c.texto));
    if (n) saida.push({ texto: c.texto, ...n, camada: c.camada, x: c.x, y: c.y });
  }
  return saida;
}

const CAMADA_AMBIENTE = /amb|area|área|room|piso|sala|comodo|cômodo/i;

function ambientes(textos: TextoLimpo[], r: ResultadoExtracao, fator: number): Ambiente[] {
  const candidatos = textos.filter((t) => !t.tag && t.x !== null && t.y !== null);
  const usados = new Set<TextoLimpo>();
  const saida: Ambiente[] = [];

  // 1) polilinha fechada com um nome de ambiente dentro (área de texto, se houver, tem prioridade)
  const fechadas = r.polilinhas.filter((p: Polilinha) => p.fechada && p.vertices.length >= 3);
  const preferidas = fechadas.some((p) => CAMADA_AMBIENTE.test(p.camada))
    ? fechadas.filter((p) => CAMADA_AMBIENTE.test(p.camada))
    : fechadas;
  for (const p of preferidas) {
    const dentro = candidatos.filter((t) => pontoDentro(t.x ?? 0, t.y ?? 0, p.vertices));
    const nome = dentro.find((t) => pareceNomeDeAmbiente(t.texto));
    if (!nome) continue;
    const areaTexto = dentro.map((t) => lerArea(t.texto)).find((a) => a !== null);
    const areaGeo = areaPoligono(p.vertices) * fator * fator;
    usados.add(nome);
    for (const t of dentro) if (lerArea(t.texto) !== null) usados.add(t);
    saida.push({
      nome: nome.texto,
      areaM2: (areaTexto ?? areaGeo).toFixed(2),
      fonteArea: areaTexto !== undefined && areaTexto !== null ? "texto" : "polilinha",
      camada: p.camada,
      x: nome.x,
      y: nome.y,
    });
  }

  // 2) sem polilinha: rótulo "SALA" com "ÁREA: 18,50 m²" logo abaixo (até 6× a altura do texto)
  for (const area of candidatos) {
    const valor = lerArea(area.texto);
    if (valor === null || usados.has(area)) continue;
    const perto = candidatos
      .filter((t) => !usados.has(t) && t !== area && pareceNomeDeAmbiente(t.texto))
      .map((t) => ({ t, d: Math.hypot((t.x ?? 0) - (area.x ?? 0), (t.y ?? 0) - (area.y ?? 0)) }))
      .filter(({ t, d }) => d <= 1.5 / fator && (t.y ?? 0) >= (area.y ?? 0))
      .sort((a, b) => a.d - b.d)[0];
    if (!perto) continue;
    usados.add(perto.t);
    usados.add(area);
    saida.push({
      nome: perto.t.texto,
      areaM2: valor.toFixed(2),
      fonteArea: "texto",
      camada: perto.t.camada,
      x: perto.t.x,
      y: perto.t.y,
    });
  }
  return saida.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const CAMPOS_CARIMBO: Record<keyof Omit<Carimbo, "atributos">, RegExp> = {
  cliente: /^(CLIENTE|PROPRIET[AÁ]RIO|CONTRATANTE)$/i,
  obra: /^(OBRA|EMPREENDIMENTO|LOCAL)$/i,
  titulo: /^(T[IÍ]TULO|DESENHO|PRANCHA|ASSUNTO|CONTE[UÚ]DO|PROJETO)$/i,
  fase: /^(FASE|ETAPA|EST[AÁ]GIO)$/i,
  revisao: /^(REV|REVIS[AÃ]O|REVISAO)$/i,
  data: /^(DATA|DT)$/i,
  folha: /^(FOLHA|FL|PRANCHA_N|N[º°]?_?FOLHA)$/i,
  escala: /^(ESCALA|ESC)$/i,
  responsavel: /^(RESPONS[AÁ]VEL|AUTOR|RT|ENGENHEIRO|ARQUITETO|DESENHISTA)$/i,
};

const BLOCO_CARIMBO = /carimbo|selo|legenda|title|formato|^a[0-4]$/i;

function carimbo(textos: TextoLimpo[], r: ResultadoExtracao): Carimbo {
  const ins: Insercao[] = r.insercoes.filter(
    (i) =>
      BLOCO_CARIMBO.test(i.bloco) ||
      i.atributos.some((a) => /^(REV|REVISAO|FOLHA|ESCALA|CLIENTE)$/i.test(a.tag)),
  );
  const atributos: Record<string, string> = {};
  for (const i of ins)
    for (const a of i.atributos) if (a.valor.trim()) atributos[a.tag.toUpperCase()] = limparMtext(a.valor);
  const c: Carimbo = {
    cliente: null,
    obra: null,
    titulo: null,
    fase: null,
    revisao: null,
    data: null,
    folha: null,
    escala: null,
    responsavel: null,
    atributos,
  };
  for (const [tag, valor] of Object.entries(atributos)) {
    for (const [campo, re] of Object.entries(CAMPOS_CARIMBO) as [keyof typeof CAMPOS_CARIMBO, RegExp][]) {
      if (re.test(tag) && !c[campo]) c[campo] = valor;
    }
  }
  const nomesBlocos = new Set(ins.map((i) => i.bloco));
  // título fixo dentro do bloco do carimbo e "FOLHA 01/01" solto no papel
  c.titulo ??=
    textos.find((t) => t.bloco && nomesBlocos.has(t.bloco) && !t.tag && t.texto.length > 8)?.texto ?? null;
  c.folha ??= textos.map((t) => /^FOLHA\s*:?\s*(\S+)/i.exec(t.texto)?.[1]).find(Boolean) ?? null;
  c.escala ??=
    textos.map((t) => /^ESC(?:ALA)?\.?\s*:?\s*(1\s*:\s*\d+)/i.exec(t.texto)?.[1]).find(Boolean) ?? null;
  return c;
}

function notas(textos: TextoLimpo[]): Nota[] {
  const saida: Nota[] = [];
  for (const t of textos) {
    if (t.tag) continue;
    const ehNota =
      /^(NOTA|NOTAS|OBS|OBSERVA[CÇ][AÃ]O|ATEN[CÇ][AÃ]O|IMPORTANTE)\b/i.test(t.texto) ||
      t.texto.split(/\s+/).length >= 5;
    const pend = pareceDependencia(t.texto);
    if (ehNota || pend) saida.push({ texto: t.texto, camada: t.camada, pareceDependencia: pend });
  }
  return saida;
}

export function interpretar(r: ResultadoExtracao): ExtracaoInterpretada {
  const { fator, assumida } = metrosPorUnidade(r.dwg.unidades);
  const textos = textosLimpos(r);
  return {
    textos,
    camadas: r.camadas,
    blocos: blocos(r),
    cotasNivel: cotasNivel(textos, r),
    ambientes: ambientes(textos, r, fator),
    carimbo: carimbo(textos, r),
    notas: notas(textos),
    unidades: { codigo: r.dwg.unidades, metrosPorUnidade: fator, assumida },
  };
}
