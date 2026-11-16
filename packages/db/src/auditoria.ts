import type { Tx } from "./cliente";
import { auditLog } from "./schema/auditoria";
import type { AtorTipo } from "./schema/comum";

export interface Ator {
  tipo: AtorTipo;
  /** `usuario.id` quando tipo = "usuario". */
  id: string | null;
}

export interface EventoAuditoria {
  tenantId: string;
  ator: Ator;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
}

/** Grava no audit_log (append-only) na MESMA transação da mudança. */
export async function registrarAuditoria(tx: Tx, evento: EventoAuditoria): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: evento.tenantId,
    atorTipo: evento.ator.tipo,
    atorId: evento.ator.id,
    acao: evento.acao,
    entidade: evento.entidade,
    entidadeId: evento.entidadeId,
    antes: evento.antes ?? null,
    depois: evento.depois ?? null,
  });
}
