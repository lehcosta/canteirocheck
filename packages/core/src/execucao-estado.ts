/**
 * Máquina de estados da execução de uma etapa num local.
 *
 *   anunciada ──iniciar──► em_conferencia ──concluir (tudo ok)──► aguardando_liberacao ──liberar──► liberada
 *                               │   ▲                                    │
 *                    divergência│   │iniciar (rodada + 1)                │recusar
 *                               ▼   │                                    ▼
 *                           bloqueada ──recusar──► recusada ─────────────┘
 *                               └──liberar (com justificativa)──► liberada
 *
 * Qualquer estado em aberto pode ser cancelado. `recusada` continua "em aberto" (o índice
 * `execucao_aberta_unica` só exclui liberada/cancelada): a reconferência reaproveita a mesma
 * execução numa nova rodada, em vez de criar outra.
 */

export type StatusExecucao =
  | "anunciada"
  | "em_conferencia"
  | "bloqueada"
  | "aguardando_liberacao"
  | "liberada"
  | "recusada"
  | "cancelada";

export type EventoExecucao =
  | "iniciar_conferencia"
  | "divergencia_confirmada"
  | "conferencia_concluida"
  | "liberar"
  | "recusar"
  | "cancelar";

export interface EstadoExecucao {
  status: StatusExecucao;
  rodada: number;
}

export const STATUS_EM_ABERTO: readonly StatusExecucao[] = [
  "anunciada",
  "em_conferencia",
  "bloqueada",
  "aguardando_liberacao",
  "recusada",
];

export const STATUS_AGUARDANDO_DECISAO: readonly StatusExecucao[] = ["bloqueada", "aguardando_liberacao"];

export class TransicaoInvalida extends Error {
  constructor(
    readonly de: StatusExecucao,
    readonly evento: EventoExecucao,
  ) {
    super(`transição inválida: ${evento} a partir de ${de}`);
    this.name = "TransicaoInvalida";
  }
}

export function transicionar(estado: EstadoExecucao, evento: EventoExecucao): EstadoExecucao {
  const { status, rodada } = estado;
  const invalida = () => new TransicaoInvalida(status, evento);

  switch (evento) {
    case "iniciar_conferencia":
      if (status === "anunciada") return { status: "em_conferencia", rodada };
      if (status === "em_conferencia") return estado; // reabrir o checklist na mesma rodada
      if (status === "recusada") return { status: "em_conferencia", rodada: rodada + 1 };
      throw invalida();
    case "divergencia_confirmada":
      if (status === "em_conferencia" || status === "bloqueada") return { status: "bloqueada", rodada };
      throw invalida();
    case "conferencia_concluida":
      if (status === "em_conferencia") return { status: "aguardando_liberacao", rodada };
      if (status === "bloqueada") return estado; // continua bloqueada até o engenheiro decidir
      throw invalida();
    case "liberar":
      if (status === "aguardando_liberacao" || status === "bloqueada") return { status: "liberada", rodada };
      throw invalida();
    case "recusar":
      if (status === "aguardando_liberacao" || status === "bloqueada") return { status: "recusada", rodada };
      throw invalida();
    case "cancelar":
      if (STATUS_EM_ABERTO.includes(status)) return { status: "cancelada", rodada };
      throw invalida();
  }
}

export function podeConferir(status: StatusExecucao): boolean {
  return status === "anunciada" || status === "em_conferencia" || status === "recusada";
}

export function aguardaDecisao(status: StatusExecucao): boolean {
  return STATUS_AGUARDANDO_DECISAO.includes(status);
}

/** Liberar uma execução bloqueada (com divergência) exige justificativa escrita do engenheiro. */
export function liberacaoExigeJustificativa(status: StatusExecucao): boolean {
  return status === "bloqueada";
}
