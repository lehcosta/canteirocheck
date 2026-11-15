import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** Transação já posicionada num tenant (ou no papel de sistema). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

declare global {
  // Sobrevive ao hot reload do Next em dev (evita abrir um pool novo a cada edição).
  var __canteiroDb: { db: Db; pool: Pool } | undefined;
}

/**
 * Conexão de runtime (usuário canteiro_runtime, que herda canteiro_app → sujeito a RLS).
 * Criada na primeira utilização: importar o schema não exige DATABASE_URL.
 */
export function obterDb(): Db {
  if (!globalThis.__canteiroDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    globalThis.__canteiroDb = { db: drizzle({ client: pool, schema }), pool };
  }
  return globalThis.__canteiroDb.db;
}

/** Fecha o pool (scripts e testes). */
export async function encerrarDb(): Promise<void> {
  const atual = globalThis.__canteiroDb;
  globalThis.__canteiroDb = undefined;
  await atual?.pool.end();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Único jeito de ler/gravar dados de cliente.
 * Abre uma transação e fixa `app.tenant_id` só dentro dela (`set_config(..., true)`), então é seguro
 * com pool de conexões: ao fim da transação o valor some e a política volta a não enxergar nada.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`);
  return obterDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
