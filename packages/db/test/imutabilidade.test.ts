import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { registrarAuditoria } from "../src/auditoria";
import { obterDb, withTenant } from "../src/cliente";
import { comDono } from "../src/plataforma";
import * as schema from "../src/schema";
import { urlsDeTeste } from "../src/testing";
import { esperarErroSql, novoTenant, primeira } from "./fabrica";

let t: Awaited<ReturnType<typeof novoTenant>>;
let execucaoId: string;

beforeAll(async () => {
  t = await novoTenant("Construtora Imutável");
  execucaoId = await withTenant(t.tenantId, async (tx) => {
    const obra = primeira(
      await tx
        .insert(schema.obra)
        .values({ tenantId: t.tenantId, nome: "Obra", engenheiroResponsavelId: t.adminUsuarioId })
        .returning(),
    );
    const local = primeira(
      await tx
        .insert(schema.local)
        .values({ tenantId: t.tenantId, obraId: obra.id, tipo: "laje", nome: "L4" })
        .returning(),
    );
    const etapa = primeira(
      await tx.select().from(schema.etapa).where(eq(schema.etapa.codigo, "concretagem")),
    );
    const exec = primeira(
      await tx
        .insert(schema.execucaoEtapa)
        .values({
          tenantId: t.tenantId,
          obraId: obra.id,
          etapaId: etapa.id,
          localId: local.id,
          dataPrevista: "2026-11-16",
          anunciadaPorId: t.adminUsuarioId,
        })
        .returning(),
    );
    return exec.id;
  });
});

describe("append-only", () => {
  it("runtime grava auditoria mas não altera nem apaga", async () => {
    await withTenant(t.tenantId, (tx) =>
      registrarAuditoria(tx, {
        tenantId: t.tenantId,
        ator: { tipo: "usuario", id: t.adminUsuarioId },
        acao: "teste.criado",
        entidade: "teste",
        entidadeId: "1",
      }),
    );
    await esperarErroSql(
      withTenant(t.tenantId, (tx) => tx.update(schema.auditLog).set({ acao: "adulterado" })),
      "42501",
    );
    await esperarErroSql(
      withTenant(t.tenantId, (tx) => tx.delete(schema.auditLog)),
      "42501",
    );
  });

  it("nem o dono das tabelas altera liberação ou auditoria (trigger)", async () => {
    await withTenant(t.tenantId, (tx) =>
      tx.insert(schema.liberacao).values({
        tenantId: t.tenantId,
        execucaoId,
        rodada: 1,
        decisao: "recusada",
        justificativa: "Forma 4 cm acima da L3",
        engenheiroId: t.adminUsuarioId,
        canal: "painel",
      }),
    );
    for (const comando of [
      sql`update liberacao set decisao = 'liberada'`,
      sql`delete from liberacao`,
      sql`truncate liberacao cascade`,
      sql`update audit_log set acao = 'adulterado'`,
    ]) {
      await expect(comDono(urlsDeTeste().dono, (db) => db.execute(comando))).rejects.toThrow();
    }
    const [lib] = await withTenant(t.tenantId, (tx) => tx.select().from(schema.liberacao));
    expect(lib?.decisao).toBe("recusada");
  });

  it("recusa sem justificativa é barrada pelo banco", async () => {
    await esperarErroSql(
      withTenant(t.tenantId, (tx) =>
        tx.insert(schema.liberacao).values({
          tenantId: t.tenantId,
          execucaoId,
          rodada: 2,
          decisao: "recusada",
          justificativa: "   ",
          engenheiroId: t.adminUsuarioId,
          canal: "painel",
        }),
      ),
      "23514",
    );
  });

  it("no máximo uma execução aberta por etapa × local", async () => {
    await esperarErroSql(
      withTenant(t.tenantId, async (tx) => {
        const atual = primeira(
          await tx.select().from(schema.execucaoEtapa).where(eq(schema.execucaoEtapa.id, execucaoId)),
        );
        await tx.insert(schema.execucaoEtapa).values({ ...atual, id: undefined, dataPrevista: "2026-11-17" });
      }),
      "23505",
    );
  });
});

describe("permissões do runtime", () => {
  it("não cria construtora nem mexe no catálogo de etapas", async () => {
    await esperarErroSql(
      withTenant(t.tenantId, (tx) => tx.insert(schema.tenant).values({ nome: "X", cnpj: "1" })),
      "42501",
    );
    await esperarErroSql(
      obterDb().insert(schema.etapa).values({ codigo: "nova", nome: "Nova", ordem: 99 }),
      "42501",
    );
  });

  it("painel exige e-mail para admin/engenheiro", async () => {
    await esperarErroSql(
      withTenant(t.tenantId, (tx) =>
        tx.insert(schema.usuario).values({
          tenantId: t.tenantId,
          nome: "Sem e-mail",
          whatsappE164: "+5511988887777",
          papel: "engenheiro",
        }),
      ),
      "23514",
    );
  });
});
