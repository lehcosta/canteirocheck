/**
 * Operações de PLATAFORMA: rodam como o dono das tabelas (DATABASE_URL_MIGRATOR), fora do RLS.
 * Usadas só por scripts (migrar, resetar, seed, criar-tenant) e por testes. Nunca pelo runtime.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type DbDono = NodePgDatabase<typeof schema>;

const PASTA_MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function comDono<T>(url: string | undefined, fn: (db: DbDono) => Promise<T>): Promise<T> {
  if (!url) throw new Error("URL do dono do banco não definida (DATABASE_URL_MIGRATOR)");
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    return await fn(drizzle({ client: pool, schema }));
  } finally {
    await pool.end();
  }
}

export async function migrar(url: string | undefined): Promise<void> {
  await comDono(url, (db) => migrate(db, { migrationsFolder: PASTA_MIGRATIONS }));
}

/** Apaga TUDO (schema public + histórico de migrations). Recusa rodar fora de localhost. */
export async function resetarBanco(url: string | undefined): Promise<void> {
  if (!url) throw new Error("URL do dono do banco não definida");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "postgres"].includes(host)) {
    throw new Error(`Recusando resetar banco fora do ambiente local (host: ${host})`);
  }
  await comDono(url, async (db) => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
  });
}

export const ETAPAS = [
  { codigo: "forma", nome: "Forma", ordem: 1 },
  { codigo: "armacao", nome: "Armação", ordem: 2 },
  { codigo: "concretagem", nome: "Concretagem", ordem: 3 },
  { codigo: "drywall_1a_face", nome: "Drywall — 1ª face", ordem: 4 },
  { codigo: "drywall_fechamento", nome: "Drywall — fechamento", ordem: 5 },
  { codigo: "contrapiso", nome: "Contrapiso", ordem: 6 },
  { codigo: "piso", nome: "Piso", ordem: 7 },
  { codigo: "forro", nome: "Forro", ordem: 8 },
  { codigo: "marcenaria", nome: "Marcenaria", ordem: 9 },
] as const;

export async function semearEtapas(db: DbDono): Promise<void> {
  await db
    .insert(schema.etapa)
    .values(ETAPAS.map((e) => ({ ...e })))
    .onConflictDoNothing({ target: schema.etapa.codigo });
}

export interface DadosNovoTenant {
  nome: string;
  cnpj: string;
  admin: { nome: string; email: string; whatsappE164: string };
}

export interface TenantCriado {
  tenantId: string;
  adminUsuarioId: string;
  adminAuthUserId: string;
}

/** Cria construtora + admin com login no painel (auth_user vinculado), com auditoria. */
export async function criarTenantComAdmin(db: DbDono, dados: DadosNovoTenant): Promise<TenantCriado> {
  return db.transaction(async (tx) => {
    const email = dados.admin.email.trim().toLowerCase();
    const [t] = await tx
      .insert(schema.tenant)
      .values({ nome: dados.nome, cnpj: dados.cnpj.replace(/\D/g, "") })
      .returning({ id: schema.tenant.id });
    if (!t) throw new Error("falha ao criar tenant");

    const authUserId = randomUUID();
    await tx.insert(schema.auth_user).values({
      id: authUserId,
      name: dados.admin.nome,
      email,
      emailVerified: true,
    });

    const [u] = await tx
      .insert(schema.usuario)
      .values({
        tenantId: t.id,
        nome: dados.admin.nome,
        email,
        whatsappE164: dados.admin.whatsappE164,
        papel: "admin",
        authUserId,
      })
      .returning({ id: schema.usuario.id });
    if (!u) throw new Error("falha ao criar admin");

    await tx.insert(schema.auditLog).values({
      tenantId: t.id,
      atorTipo: "sistema",
      atorId: null,
      acao: "tenant.criado",
      entidade: "tenant",
      entidadeId: t.id,
      depois: { nome: dados.nome, admin: { usuarioId: u.id, email } },
    });

    return { tenantId: t.id, adminUsuarioId: u.id, adminAuthUserId: authUserId };
  });
}
