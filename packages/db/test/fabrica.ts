import { randomInt } from "node:crypto";
import { comDono, criarTenantComAdmin, type TenantCriado } from "../src/plataforma";
import { urlsDeTeste } from "../src/testing";

export const digitos = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
export const whatsappAleatorio = () => `+55119${digitos(8)}`;

export async function novoTenant(nome = "Construtora Teste"): Promise<TenantCriado & { adminEmail: string }> {
  const adminEmail = `admin.${digitos(10)}@teste.test`;
  const criado = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome,
      cnpj: digitos(14),
      admin: { nome: `Admin ${nome}`, email: adminEmail, whatsappE164: whatsappAleatorio() },
    }),
  );
  return { ...criado, adminEmail };
}

/** Código SQLSTATE do erro (o Drizzle embrulha o erro do pg em `cause`). */
export function codigoSql(e: unknown): string | undefined {
  const erro = e as { code?: string; cause?: { code?: string } };
  return erro?.code ?? erro?.cause?.code;
}

export async function esperarErroSql(promessa: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await promessa;
  } catch (e) {
    if (codigoSql(e) === codigo) return;
    throw new Error(`Esperava SQLSTATE ${codigo}, veio ${codigoSql(e)}: ${String(e)}`);
  }
  throw new Error(`Esperava SQLSTATE ${codigo}, mas a operação passou`);
}

/** Primeira linha de um resultado, ou falha explícita (no lugar de `!`). */
export function primeira<T>(linhas: T[]): T {
  const [linha] = linhas;
  if (linha === undefined) throw new Error("consulta não retornou linhas");
  return linha;
}
