import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { obterDb, withTenant } from "../src/cliente";
import * as schema from "../src/schema";
import { resolverUsuarioDoPainel } from "../src/sistema";
import { esperarErroSql, novoTenant } from "./fabrica";

/** Tabelas sem RLS de propósito. Qualquer outra tabela precisa de RLS + política. */
const SEM_RLS = new Set(["etapa", "auth_user", "auth_session", "auth_account", "auth_verification"]);

let a: Awaited<ReturnType<typeof novoTenant>>;
let b: Awaited<ReturnType<typeof novoTenant>>;
let obraA: string;
let obraB: string;

async function criarObra(tenantId: string, engenheiroId: string, nome: string) {
  return withTenant(tenantId, async (tx) => {
    const [o] = await tx
      .insert(schema.obra)
      .values({ tenantId, nome, engenheiroResponsavelId: engenheiroId })
      .returning({ id: schema.obra.id });
    if (!o) throw new Error("obra não criada");
    return o.id;
  });
}

beforeAll(async () => {
  a = await novoTenant("Construtora A");
  b = await novoTenant("Construtora B");
  obraA = await criarObra(a.tenantId, a.adminUsuarioId, "Obra da A");
  obraB = await criarObra(b.tenantId, b.adminUsuarioId, "Obra da B");
});

describe("catálogo do Postgres", () => {
  it("toda tabela de cliente tem RLS ligado e ao menos uma política", async () => {
    const r = await obterDb().execute<{ tabela: string; rls: boolean; politicas: number }>(sql`
      select c.relname as tabela, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      order by 1`);
    const problemas = r.rows
      .filter((t) => !SEM_RLS.has(t.tabela))
      .filter((t) => !t.rls || t.politicas < 1)
      .map((t) => t.tabela);
    expect(problemas).toEqual([]);
    expect(r.rows.length).toBeGreaterThan(20);
  });

  it("os testes rodam como o usuário de runtime, que herda canteiro_app e não tem BYPASSRLS", async () => {
    const r = await obterDb().execute<{
      usuario: string;
      herda_app: boolean;
      herda_sistema: boolean;
      bypass: boolean;
    }>(sql`
      select current_user as usuario,
             pg_has_role(current_user, 'canteiro_app', 'USAGE') as herda_app,
             pg_has_role(current_user, 'canteiro_sistema', 'USAGE') as herda_sistema,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
    expect(r.rows[0]).toEqual({
      usuario: "canteiro_runtime",
      herda_app: true,
      herda_sistema: false,
      bypass: false,
    });
  });
});

describe("isolamento entre construtoras (RLS)", () => {
  it("sem tenant definido não enxerga nada", async () => {
    const obras = await obterDb().select().from(schema.obra);
    expect(obras).toEqual([]);
    const usuarios = await obterDb().select().from(schema.usuario);
    expect(usuarios).toEqual([]);
  });

  it("dentro de withTenant enxerga só a própria construtora", async () => {
    const daA = await withTenant(a.tenantId, (tx) => tx.select({ id: schema.obra.id }).from(schema.obra));
    const daB = await withTenant(b.tenantId, (tx) => tx.select({ id: schema.obra.id }).from(schema.obra));
    expect(daA.map((o) => o.id)).toEqual([obraA]);
    expect(daB.map((o) => o.id)).toEqual([obraB]);
  });

  it("não grava linha de outra construtora (WITH CHECK)", async () => {
    await esperarErroSql(
      withTenant(a.tenantId, (tx) =>
        tx
          .insert(schema.obra)
          .values({ tenantId: b.tenantId, nome: "Invasão", engenheiroResponsavelId: b.adminUsuarioId }),
      ),
      "42501",
    );
  });

  it("não altera nem apaga linha de outra construtora (USING filtra)", async () => {
    const alteradas = await withTenant(a.tenantId, (tx) =>
      tx.update(schema.obra).set({ nome: "Alterada por A" }).where(eq(schema.obra.id, obraB)).returning(),
    );
    const apagadas = await withTenant(a.tenantId, (tx) =>
      tx.delete(schema.local).where(eq(schema.local.obraId, obraB)).returning(),
    );
    expect(alteradas).toEqual([]);
    expect(apagadas).toEqual([]);
    const [obra] = await withTenant(b.tenantId, (tx) =>
      tx.select({ nome: schema.obra.nome }).from(schema.obra).where(eq(schema.obra.id, obraB)),
    );
    expect(obra?.nome).toBe("Obra da B");
  });

  it("o tenant não vaza para a próxima transação na mesma conexão", async () => {
    await withTenant(a.tenantId, (tx) => tx.select().from(schema.obra));
    const depois = await obterDb().select().from(schema.obra);
    expect(depois).toEqual([]);
  });

  it("rejeita tenantId que não é UUID", async () => {
    await expect(withTenant("'; drop table obra; --", async () => 1)).rejects.toThrow(/tenantId inválido/);
  });

  it("a construtora só enxerga o próprio registro em tenant", async () => {
    const vistos = await withTenant(a.tenantId, (tx) =>
      tx.select({ id: schema.tenant.id }).from(schema.tenant),
    );
    expect(vistos.map((t) => t.id)).toEqual([a.tenantId]);
  });
});

describe("funções de sistema (BYPASSRLS só via SET LOCAL ROLE)", () => {
  it("resolve o usuário do painel de qualquer construtora pela sessão", async () => {
    const [u] = await withTenant(b.tenantId, (tx) =>
      tx
        .select({ authUserId: schema.usuario.authUserId })
        .from(schema.usuario)
        .where(eq(schema.usuario.id, b.adminUsuarioId)),
    );
    const resolvido = await resolverUsuarioDoPainel(u?.authUserId ?? "");
    expect(resolvido).toMatchObject({ usuarioId: b.adminUsuarioId, tenantId: b.tenantId, papel: "admin" });
  });

  it("usuário inativo não entra no painel", async () => {
    await withTenant(a.tenantId, (tx) =>
      tx.update(schema.usuario).set({ ativo: false }).where(eq(schema.usuario.id, a.adminUsuarioId)),
    );
    const [u] = await withTenant(a.tenantId, (tx) =>
      tx
        .select({ authUserId: schema.usuario.authUserId })
        .from(schema.usuario)
        .where(eq(schema.usuario.id, a.adminUsuarioId)),
    );
    expect(await resolverUsuarioDoPainel(u?.authUserId ?? "")).toBeNull();
    await withTenant(a.tenantId, (tx) =>
      tx.update(schema.usuario).set({ ativo: true }).where(eq(schema.usuario.id, a.adminUsuarioId)),
    );
  });

  it("o papel de sistema não fica ativo depois da transação", async () => {
    await resolverUsuarioDoPainel("qualquer");
    const r = await obterDb().execute<{ papel: string }>(sql`select current_user as papel`);
    expect(r.rows[0]?.papel).toBe("canteiro_runtime");
  });
});
