import { sql } from "drizzle-orm";
import { obterDb, type Tx } from "../cliente";

/**
 * Transação com o papel canteiro_sistema (BYPASSRLS). INTERNO: não é exportado pelo pacote.
 * BYPASSRLS é atributo de papel e nunca é herdado, por isso o `SET LOCAL ROLE` explícito.
 * Use só por meio das funções estreitas de `sistema.ts`.
 */
export async function comoSistema<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return obterDb().transaction(async (tx) => {
    await tx.execute(sql`set local role canteiro_sistema`);
    return fn(tx);
  });
}
