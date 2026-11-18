const FUSO = "America/Sao_Paulo";
const ENTRADA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Diferença do fuso para UTC no instante dado, em minutos ("GMT-03:00" → -180). */
function deslocamento(instante: Date): number {
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, timeZoneName: "longOffset" })
    .formatToParts(instante)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome ?? "");
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** "2026-11-20T10:12" no relógio de São Paulo → o instante; null se não for esse formato. */
function lerAgora(valor: string): Date | null {
  const m = ENTRADA.exec(valor);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(utc)) return null;
  return new Date(utc - deslocamento(new Date(utc)) * 60_000);
}

/**
 * O dia e a hora da tela, no fuso da obra. Fora de produção, `?agora=2026-11-20T10:12` troca o
 * relógio: é como as cenas de outros dias abrem; em produção o parâmetro é ignorado.
 */
export function agoraDaTela(busca: Record<string, string | string[] | undefined>): {
  /** AAAA-MM-DD */
  hoje: string;
  agora: Date;
} {
  const pedido = busca.agora;
  const simulado =
    process.env.NODE_ENV !== "production" && typeof pedido === "string" ? lerAgora(pedido) : null;
  const agora = simulado ?? new Date();
  // o formato sueco já é ISO
  return { hoje: agora.toLocaleDateString("sv-SE", { timeZone: FUSO }), agora };
}
