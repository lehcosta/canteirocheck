import { z } from "zod";

/**
 * Catálogo de filas e jobs. Produtor (web, servicos) e consumidor (worker) usam os mesmos
 * schemas: payload inválido não entra na fila nem é processado.
 */

export const FILAS = [
  "whatsapp-entrada",
  "whatsapp-saida",
  "midia",
  "execucao",
  "agenda",
  "relatorios",
  "dwg",
  "cronograma",
  "ia",
] as const;
export type NomeFila = (typeof FILAS)[number];

const uuid = z.uuid();
const comTenant = { tenantId: uuid };

export const JOBS = {
  /** Mensagem recebida pelo webhook (já gravada). tenantId null = número desconhecido. */
  processar_mensagem: {
    fila: "whatsapp-entrada",
    payload: z.object({ tenantId: uuid.nullable(), mensagemId: uuid }),
  },
  /** Mensagem de saída já gravada (status `pendente`): o worker envia e grava o wamid. */
  enviar_mensagem: { fila: "whatsapp-saida", payload: z.object({ ...comTenant, mensagemId: uuid }) },
  /** Foto do Flow (CDN cifrado) ou do chat (media id) → bucket. */
  baixar_midia: { fila: "midia", payload: z.object({ ...comTenant, midiaId: uuid }) },
  /** Execução bloqueada ou aguardando liberação → resumo + botões para o engenheiro. */
  notificar_engenheiro: {
    fila: "execucao",
    payload: z.object({ ...comTenant, execucaoId: uuid, rodada: z.number().int().min(1) }),
  },
  /** Liberação gravada → resultado e próximo passo para o encarregado. */
  notificar_encarregado: { fila: "execucao", payload: z.object({ ...comTenant, liberacaoId: uuid }) },
  /** Pendência aberta bloqueia uma etapa recém-anunciada → aviso ao engenheiro. */
  avisar_pendencia: { fila: "execucao", payload: z.object({ ...comTenant, execucaoId: uuid }) },
  /** A cada 2 min: reenfileira o que ficou parado em `pendente` (mensagem, mídia, extração). */
  varredura: { fila: "agenda", payload: z.object({}) },
  /** Cron por obra (Job Scheduler no fuso da obra). */
  anuncio_diario: { fila: "agenda", payload: z.object({ ...comTenant, obraId: uuid }) },
  /** PDF de uma execução (execucaoId) ou da obra inteira (execucaoId null). */
  gerar_pdf: {
    fila: "relatorios",
    payload: z.object({
      ...comTenant,
      obraId: uuid,
      execucaoId: uuid.nullable(),
      solicitadoPorId: uuid.nullable(),
    }),
  },
  extrair_dwg: { fila: "dwg", payload: z.object({ ...comTenant, projetoId: uuid }) },
  /** Arquivo do MS Project já no bucket → tarefas no banco e versão vigente. */
  ler_cronograma: { fila: "cronograma", payload: z.object({ ...comTenant, versaoId: uuid }) },
  detectar_pendencias: { fila: "ia", payload: z.object({ ...comTenant, projetoId: uuid }) },
  gerar_pontos: { fila: "ia", payload: z.object({ ...comTenant, projetoId: uuid }) },
  transcrever_audio: { fila: "ia", payload: z.object({ ...comTenant, mensagemId: uuid }) },
  interpretar_mensagem: { fila: "ia", payload: z.object({ ...comTenant, mensagemId: uuid }) },
} as const satisfies Record<string, { fila: NomeFila; payload: z.ZodType }>;

export type NomeJob = keyof typeof JOBS;
export type PayloadJob<N extends NomeJob> = z.infer<(typeof JOBS)[N]["payload"]>;

export interface OpcoesJob {
  /** Idempotência: o mesmo jobId não entra duas vezes enquanto existir. Sem ":" (regra do BullMQ). */
  jobId?: string;
  atrasoMs?: number;
}

export function validarPayload<N extends NomeJob>(nome: N, payload: unknown): PayloadJob<N> {
  return JOBS[nome].payload.parse(payload) as PayloadJob<N>;
}

/** Monta um jobId estável a partir das partes (uuid, rodada…). */
export function idJob(...partes: (string | number)[]): string {
  return partes.map((p) => String(p).replace(/[^A-Za-z0-9_.-]/g, "_")).join("-");
}
