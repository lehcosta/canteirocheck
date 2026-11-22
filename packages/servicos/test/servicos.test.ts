import { randomInt } from "node:crypto";
import { podeEntrarNoPainel, schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Contexto, ErroDeCampo } from "../src/contexto";
import {
  adicionarMembro,
  andamentoDaObra,
  criarLocal,
  criarObra,
  criarUsuario,
  definirAtivo,
  listarObras,
  listarUsuarios,
  obterObra,
  removerMembro,
} from "../src/index";

const digitos = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const celular = () => `(11) 9${digitos(8)}`;

async function novoTenant(nome: string): Promise<Contexto> {
  const r = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome,
      cnpj: digitos(14),
      admin: {
        nome: `Admin ${nome}`,
        email: `admin.${digitos(8)}@teste.test`,
        whatsappE164: `+55119${digitos(8)}`,
      },
    }),
  );
  return { tenantId: r.tenantId, usuarioId: r.adminUsuarioId, papel: "admin" };
}

let admin: Contexto;
let outro: Contexto;
let engenheiro: Contexto;
let encarregadoId: string;
let emailEng: string;

beforeAll(async () => {
  admin = await novoTenant("Construtora Serviços");
  outro = await novoTenant("Outra Construtora");
  emailEng = `Eng.${digitos(6)}@Teste.TEST`;
  const eng = await criarUsuario(admin, {
    nome: "Eng. Ana",
    papel: "engenheiro",
    email: emailEng,
    whatsapp: celular(),
  });
  engenheiro = { tenantId: admin.tenantId, usuarioId: eng.id, papel: "engenheiro" };
  encarregadoId = (await criarUsuario(admin, { nome: "João", papel: "encarregado", whatsapp: celular() })).id;
});

async function auditoria(ctx: Contexto, entidadeId: string) {
  return withTenant(ctx.tenantId, (tx) =>
    tx.select().from(schema.auditLog).where(eq(schema.auditLog.entidadeId, entidadeId)),
  );
}

describe("usuários", () => {
  it("engenheiro ganha login no painel; e-mail é normalizado", async () => {
    expect(await podeEntrarNoPainel(emailEng)).toBe(true);
    expect(await podeEntrarNoPainel(emailEng.toLowerCase())).toBe(true);
    const lista = await listarUsuarios(admin);
    const ana = lista.find((u) => u.id === engenheiro.usuarioId);
    expect(ana?.email).toBe(emailEng.toLowerCase());
    expect(ana?.whatsappE164).toMatch(/^\+5511/);
    expect(await auditoria(admin, engenheiro.usuarioId)).toHaveLength(1);
  });

  it("encarregado não tem login no painel", async () => {
    const [u] = await withTenant(admin.tenantId, (tx) =>
      tx.select().from(schema.usuario).where(eq(schema.usuario.id, encarregadoId)),
    );
    expect(u?.authUserId).toBeNull();
  });

  it("admin/engenheiro sem e-mail é recusado com mensagem clara", async () => {
    await expect(
      criarUsuario(admin, { nome: "X", papel: "engenheiro", whatsapp: celular() }),
    ).rejects.toThrow(/precisam de e-mail/);
  });

  it("WhatsApp duplicado (mesmo em outra construtora) é conflito", async () => {
    const numero = celular();
    await criarUsuario(admin, { nome: "Mestre 1", papel: "encarregado", whatsapp: numero });
    await expect(
      criarUsuario(outro, { nome: "Mestre 2", papel: "encarregado", whatsapp: numero }),
    ).rejects.toThrow(/WhatsApp já está cadastrado/);
  });

  it("e-mail duplicado entre construtoras é conflito (login é global)", async () => {
    await expect(
      criarUsuario(outro, { nome: "Clone", papel: "engenheiro", email: emailEng, whatsapp: celular() }),
    ).rejects.toThrow(/e-mail já está cadastrado/);
  });

  it("só admin cria usuário", async () => {
    await expect(
      criarUsuario(engenheiro, { nome: "Y", papel: "encarregado", whatsapp: celular() }),
    ).rejects.toThrow(/permissão/);
  });

  it("desativar tira o acesso ao painel", async () => {
    const email = `temp.${digitos(6)}@teste.test`;
    const { id } = await criarUsuario(admin, {
      nome: "Temp",
      papel: "engenheiro",
      email,
      whatsapp: celular(),
    });
    expect(await podeEntrarNoPainel(email)).toBe(true);
    await definirAtivo(admin, { usuarioId: id, ativo: false });
    expect(await podeEntrarNoPainel(email)).toBe(false);
  });
});

describe("obras", () => {
  let obraId: string;

  it("admin cria obra; o engenheiro responsável vira membro; fica auditado", async () => {
    ({ id: obraId } = await criarObra(admin, {
      nome: "Edifício Teste",
      endereco: "Rua A, 1",
      areaM2: "1.250,50",
      engenheiroResponsavelId: engenheiro.usuarioId,
    }));
    const obra = await obterObra(admin, obraId);
    expect(obra).toMatchObject({ nome: "Edifício Teste", areaM2: "1250.50", horarioAnuncio: "16:00" });
    expect(obra?.membros.map((m) => m.usuarioId)).toEqual([engenheiro.usuarioId]);
    const eventos = await auditoria(admin, obraId);
    expect(eventos.map((e) => e.acao)).toContain("obra.criada");
  });

  it("engenheiro não cria obra", async () => {
    await expect(
      criarObra(engenheiro, { nome: "X", engenheiroResponsavelId: engenheiro.usuarioId }),
    ).rejects.toThrow(/permissão/);
  });

  it("responsável precisa ser engenheiro ativo", async () => {
    await expect(criarObra(admin, { nome: "X", engenheiroResponsavelId: encarregadoId })).rejects.toThrow(
      /engenheiro ativo/,
    );
  });

  it("erro de formato aponta o campo, para o formulário mostrar embaixo dele", async () => {
    const erro = await criarObra(admin, {
      nome: "X",
      areaM2: "12,5,0",
      engenheiroResponsavelId: engenheiro.usuarioId,
    }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDeCampo);
    expect(erro).toMatchObject({ campo: "areaM2", message: "Área inválida. Ex.: 1250,50" });
    await expect(
      criarObra(admin, { nome: "X", engenheiroResponsavelId: encarregadoId }),
    ).rejects.toMatchObject({ campo: "engenheiroResponsavelId" });
  });

  it("locais: hierarquia na mesma obra e nome único por tipo", async () => {
    const l4 = await criarLocal(engenheiro, { obraId, tipo: "laje", nome: "L4" });
    await criarLocal(engenheiro, { obraId, tipo: "eixo", nome: "A", paiId: l4.id });
    await expect(criarLocal(engenheiro, { obraId, tipo: "laje", nome: "L4" })).rejects.toThrow(
      /Já existe um local/,
    );
    const obra = await obterObra(admin, obraId);
    expect(obra?.locais.map((l) => `${l.tipo}:${l.nome}`)).toEqual(["laje:L4", "eixo:A"]);
  });

  it("membros: adicionar encarregado, não duplicar, não remover o responsável", async () => {
    await adicionarMembro(engenheiro, { obraId, usuarioId: encarregadoId });
    await expect(adicionarMembro(engenheiro, { obraId, usuarioId: encarregadoId })).rejects.toThrow(
      /já faz parte/,
    );
    await expect(removerMembro(admin, { obraId, usuarioId: engenheiro.usuarioId })).rejects.toThrow(
      /responsável/,
    );
    await removerMembro(admin, { obraId, usuarioId: encarregadoId });
    const obra = await obterObra(admin, obraId);
    expect(obra?.membros.map((m) => m.usuarioId)).toEqual([engenheiro.usuarioId]);
  });

  it("andamento: equipe sem encarregado, locais contados, nada anunciado; outra construtora não vê", async () => {
    const a = await andamentoDaObra(admin, obraId);
    expect(a?.fatos).toEqual({ temEncarregado: false, locais: 2, pontosAprovados: 0, etapaAnunciada: false });
    expect(a?.pontosSugeridos).toEqual({ ia: 0, manual: 0 });
    expect(a?.leitura).toBeNull();
    const disponiveis = a?.encarregadosDisponiveis ?? 0;
    expect(disponiveis).toBeGreaterThan(0);
    await adicionarMembro(engenheiro, { obraId, usuarioId: encarregadoId });
    const b = await andamentoDaObra(admin, obraId);
    expect(b?.fatos.temEncarregado).toBe(true);
    expect(b?.encarregadosDisponiveis).toBe(disponiveis - 1);
    await removerMembro(admin, { obraId, usuarioId: encarregadoId });
    expect(await andamentoDaObra(outro, obraId)).toBeNull();
    expect(await andamentoDaObra(admin, "nao-e-uuid")).toBeNull();
  });

  it("outra construtora não vê nem mexe na obra", async () => {
    expect(await obterObra(outro, obraId)).toBeNull();
    expect((await listarObras(outro)).map((o) => o.id)).not.toContain(obraId);
    await expect(criarLocal(outro, { obraId, tipo: "laje", nome: "L9" })).rejects.toThrow(
      /Obra não encontrada/,
    );
  });

  it("id malformado não estoura", async () => {
    expect(await obterObra(admin, "nao-e-uuid")).toBeNull();
  });
});
