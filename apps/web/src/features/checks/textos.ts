import type { EstadoCheck, Momento, TipoResposta } from "@canteirocheck/core";

/** Textos dos checks por fase, comuns à aba Cronograma e à página da fase. PURO: roda no servidor e no cliente. */

const FUSO = "America/Sao_Paulo";
const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** 1 = segunda … 7 = domingo, como `check_fase.dias` do Durante. */
const DIA_DA_SEMANA = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export const MOMENTO: Record<Momento, string> = { antes: "Antes", durante: "Durante", depois: "Depois" };
export const MOMENTO_NA_DICA: Record<Momento, string> = {
  antes: "Antes de começar",
  durante: "Durante",
  depois: "Depois de terminar",
};
export const ESTADO_CHECK: Record<EstadoCheck, string> = {
  ok: "Respondido",
  alerta: "Com alerta",
  naobra: "Na obra",
  agendado: "Agendado",
  aprovar: "Para aprovar",
  sugerido: "Sugerido",
};
/** A ordem da legenda: do que já voltou da obra ao que ainda é só sugestão. */
export const ESTADOS_NA_LEGENDA: EstadoCheck[] = [
  "ok",
  "alerta",
  "naobra",
  "agendado",
  "aprovar",
  "sugerido",
];

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** 2026-11-20 → 20/11 */
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** 2026-11-20 → 20/11/2026 */
export const dataCompleta = (iso: string) => `${ddmm(iso)}/${iso.slice(0, 4)}`;
/** 2026-11-20 → 20/11/26 */
export const dataCurta = (iso: string) => `${ddmm(iso)}/${iso.slice(2, 4)}`;
/** 2026-11-20 → sex 20/11 */
export const diaCurto = (iso: string) => `${SEMANA[new Date(ms(iso)).getUTCDay()]} ${ddmm(iso)}`;

/** O dia de um instante no fuso da obra (AAAA-MM-DD). */
export const diaDe = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: FUSO });
/** 07:00 */
export const horaDe = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
/** 17/11/2026 */
export const diaCompletoDe = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });

/** Há quanto tempo: "3 horas" / "2 dias" (curto: "3 h" / "2 d"). */
export function decorrido(desde: Date, agora: Date, curto = false): string {
  const minutos = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 60_000));
  if (minutos < 60) return curto ? `${minutos} min` : plural(minutos, "minuto", "minutos");
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return curto ? `${horas} h` : plural(horas, "hora", "horas");
  const dias = Math.floor(horas / 24);
  return curto ? `${dias} d` : plural(dias, "dia", "dias");
}

const todo = (dia: number) => `${dia >= 6 ? "todo" : "toda"} ${DIA_DA_SEMANA[dia] ?? "semana"}`;

/** Quando o check sai: "sex 20/11 · 07:00", ou "toda segunda · 07:00" no Durante. */
export function quandoSai(momento: Momento, dias: number, hora: string, proxima: string | null): string {
  if (momento === "durante") return `${todo(dias)} · ${hora}`;
  return proxima ? `${diaCurto(proxima)} · ${hora}` : `sem data · ${hora}`;
}

/** A regra de quando o check sai, como frase: "3 dias antes do início da fase". */
export function regra(momento: Momento, dias: number, datas: string[]): string {
  if (momento === "antes")
    return dias === 0 ? "no dia do início da fase" : `${plural(dias, "dia", "dias")} antes do início da fase`;
  if (momento === "depois") return `${dias}º dia útil após o término da fase`;
  const primeira = datas[0];
  const ultima = datas.at(-1);
  return primeira && ultima ? `de ${ddmm(primeira)} a ${ddmm(ultima)}` : todo(dias);
}

/** O que a regra do Durante acrescenta enquanto nenhum envio saiu. */
export const ENQUANTO_DURAR = "enquanto a fase durar";

/**
 * A regra de um check a partir do dia em que ele sai (a aba Cronograma não recebe `dias`): dias
 * corridos antes do início, dia da semana do Durante, dias úteis depois do término.
 */
export function diasDaRegra(
  momento: Momento,
  saiEm: string,
  fase: { inicio: string | null; termino: string | null },
): number | null {
  if (momento === "antes") return fase.inicio ? Math.round((ms(fase.inicio) - ms(saiEm)) / DIA) : null;
  if (momento === "durante") return new Date(ms(saiEm)).getUTCDay() || 7;
  if (!fase.termino) return null;
  let uteis = 0;
  for (let t = ms(fase.termino) + DIA; t <= ms(saiEm); t += DIA) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) uteis++;
  }
  return uteis;
}

const ou = (itens: string[]) =>
  itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} ou ${itens.at(-1)}`;
const MEDIDA: Record<string, string> = { m: "metros", cm: "centímetros", mm: "milímetros" };

/** O tipo de resposta como a obra vê: "Sim ou não · foto", "R00, R01 ou não sei", "Medida em metros". */
export function tipoDaResposta(p: { tipo: TipoResposta; opcoes: string[]; pedeFoto: boolean }): string {
  const base =
    p.tipo === "sim_nao"
      ? "Sim ou não"
      : p.tipo === "opcao"
        ? ou(p.opcoes)
        : p.tipo === "data"
          ? "Data"
          : p.tipo === "medida"
            ? `Medida em ${MEDIDA[p.opcoes[0] ?? ""] ?? "metros"}`
            : "Texto ou áudio";
  return p.pedeFoto ? `${base} · foto` : base;
}

/** O nome do tipo no select do editor. */
export const TIPO_NO_EDITOR: Record<TipoResposta, string> = {
  sim_nao: "Sim ou não",
  opcao: "Uma opção",
  data: "Data",
  medida: "Medida",
  texto: "Texto",
};

const numero = (n: string) => n.replace(".", ",");

/** A resposta gravada, para ler: "sim" → "Sim", "2026-11-02" → "02/11/2026", "6.002" → "6,002 m". */
export function respostaLegivel(tipo: TipoResposta, valor: string, opcoes: string[]): string {
  if (tipo === "sim_nao") return valor === "sim" ? "Sim" : valor === "nao" ? "Não" : valor;
  if (tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return dataCompleta(valor);
  if (tipo === "medida") return `${numero(valor)} ${opcoes[0] ?? ""}`.trim();
  return valor;
}

/** A resposta esperada, para ler: "<=2026-11-02" → "Até 02/11", "5.995..6.005" → "5,995 a 6,005 m". */
export function esperadaLegivel(tipo: TipoResposta, esperada: string, opcoes: string[]): string {
  if (tipo === "sim_nao") return esperada.toLowerCase() === "sim" ? "Sim" : "Não";
  if (tipo === "data") {
    const data = esperada.slice(2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return esperada;
    return `${esperada.startsWith("<=") ? "Até" : "A partir de"} ${ddmm(data)}`;
  }
  if (tipo === "medida") {
    const [min, max] = esperada.split("..");
    return min && max ? `${numero(min)} a ${numero(max)} ${opcoes[0] ?? ""}`.trim() : esperada;
  }
  return esperada;
}
