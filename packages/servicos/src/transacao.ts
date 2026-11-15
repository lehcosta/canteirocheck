import { type Tx, withTenant } from "@canteirocheck/db";
import { type NomeJob, type OpcoesJob, obterFila, type PayloadJob } from "@canteirocheck/queue";

/**
 * Jobs disparados por um caso de uso só vão para a fila DEPOIS do commit: um job nunca vê
 * dado que ainda não existe, e um rollback não deixa notificação órfã.
 * (Se o processo cair entre o commit e o enfileiramento, a mensagem de saída fica `pendente`
 * no banco e a varredura do worker reenfileira.)
 */
export class Efeitos {
  readonly jobs: { nome: NomeJob; payload: unknown; opcoes: OpcoesJob }[] = [];

  enfileirar<N extends NomeJob>(nome: N, payload: PayloadJob<N>, opcoes: OpcoesJob = {}) {
    this.jobs.push({ nome, payload, opcoes });
  }

  async despachar() {
    const fila = obterFila();
    for (const j of this.jobs) {
      await fila.enfileirar(j.nome, j.payload as PayloadJob<typeof j.nome>, j.opcoes);
    }
  }
}

export async function emTransacao<T>(
  tenantId: string,
  fn: (tx: Tx, efeitos: Efeitos) => Promise<T>,
): Promise<T> {
  const efeitos = new Efeitos();
  const resultado = await withTenant(tenantId, (tx) => fn(tx, efeitos));
  await efeitos.despachar();
  return resultado;
}

/**
 * Mutação dentro de um SAVEPOINT: se falhar, nada dela fica no banco nem na fila, e a transação
 * externa ainda consegue gravar/montar a resposta de erro.
 */
export async function comSavepoint<T>(
  tx: Tx,
  efeitos: Efeitos,
  fn: (sp: Tx, ef: Efeitos) => Promise<T>,
): Promise<T> {
  const locais = new Efeitos();
  const r = await tx.transaction((sp) => fn(sp as unknown as Tx, locais));
  efeitos.jobs.push(...locais.jobs);
  return r;
}
