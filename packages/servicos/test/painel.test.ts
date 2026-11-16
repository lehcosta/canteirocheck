/** Etapa 6: pontos no painel, tolerância padrão, decisão pelo painel e relatórios PDF. */
import { randomInt } from "node:crypto";
import { lerNumero } from "@canteirocheck/core";
import { schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import { garantirBucket, lerObjeto } from "@canteirocheck/storage";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anunciarExecucoes,
  type Contexto,
  criarLocal,
  criarObra,
  criarPontoManual,
  criarUsuario,
  decidirPeloPainel,
  definirTolerancia,
  emTransacao,
  gerarRelatorio,
  listarPontos,
  listarRelatorios,
  painelDaObra,
  revisarPonto,
  urlDoRelatorio,
} from "../src";
import {
  abrirConferencia,
  carregarSessaoChecklist,
  concluirLote,
  registrarMedida,
} from "../src/execucoes/conferencia";

const fila = new FilaEmMemoria();
definirFila(fila);

const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
let admin: Contexto;
let eng: Contexto;
let encarregado: Contexto;
let obraId: string;
let localId: string;
let execucaoId: string;
const concretagem = 3;

function num(t: string) {
  const r = lerNumero(t);
  if (!r.ok) throw new Error(t);
  return r.valor;
}

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora Painel",
      cnpj: d(14),
      admin: { nome: "Admin", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  admin = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  const e = await criarUsuario(admin, {
    nome: "Eng. Bia",
    papel: "engenheiro",
    email: `b${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  eng = { tenantId: t.tenantId, usuarioId: e.id, papel: "engenheiro" };
  const enc = await criarUsuario(admin, { nome: "Zé", papel: "encarregado", whatsapp: `(11) 9${d(8)}` });
  encarregado = { tenantId: t.tenantId, usuarioId: enc.id, papel: "encarregado" };
  obraId = (await criarObra(admin, { nome: "Residencial Painel", engenheiroResponsavelId: eng.usuarioId }))
    .id;
  localId = (await criarLocal(eng, { obraId, tipo: "laje", nome: "L1" })).id;
  await withTenant(t.tenantId, (tx) =>
    tx
      .insert(schema.obraMembro)
      .values({ tenantId: t.tenantId, obraId, usuarioId: enc.id, papel: "encarregado" }),
  );
});

describe("pontos e tolerâncias", () => {
  it("engenheiro cria aprovado; admin cria sugerido e só engenheiro aprova", async () => {
    await definirTolerancia(eng, {
      grandeza: "nivel",
      unidade: "cm",
      toleranciaMais: "1",
      toleranciaMenos: "1",
    });
    const base = { obraId, etapaId: String(concretagem), localId, grandeza: "nivel", unidade: "m" };
    await criarPontoManual(eng, { ...base, descricao: "Nível do fundo — eixo 1", valorEsperado: "3,00" });
    const sug = await criarPontoManual(admin, {
      ...base,
      descricao: "Nível do fundo — eixo 2",
      valorEsperado: "3,00",
      toleranciaMais: "0,005",
      toleranciaMenos: "0,005",
    });
    let pontos = await listarPontos(eng, obraId);
    expect(pontos.map((p) => [p.descricao, p.statusRevisao, p.esperado])).toEqual([
      ["Nível do fundo — eixo 1", "aprovado", "3,000 m ± 1 cm"], // tolerância padrão em cm, convertida
      ["Nível do fundo — eixo 2", "sugerido", "3,000 m ± 0,5 cm"],
    ]);
    await expect(revisarPonto(admin, { pontoId: sug.id, decisao: "aprovar" })).rejects.toThrow(/permissão/);
    await revisarPonto(eng, { pontoId: sug.id, decisao: "aprovar" });
    pontos = await listarPontos(eng, obraId);
    expect(pontos.every((p) => p.statusRevisao === "aprovado")).toBe(true);
  });

  it("validação: interface sem referência e existência com valor são recusadas", async () => {
    await expect(
      criarPontoManual(eng, {
        obraId,
        etapaId: "3",
        localId,
        descricao: "Interface",
        grandeza: "nivel",
        unidade: "m",
        valorEsperado: "3",
        ehInterface: "on",
      }),
    ).rejects.toThrow(/referência/);
    await expect(
      criarPontoManual(eng, {
        obraId,
        etapaId: "3",
        localId,
        descricao: "Tem ralo",
        grandeza: "existencia",
        unidade: "m",
      }),
    ).rejects.toThrow(/sim\/não/);
  });
});

describe("decisão pelo painel e relatórios", () => {
  it("conferência ok → aguardando liberação → aparece no painel da obra", async () => {
    const r = await emTransacao(eng.tenantId, (tx, ef) =>
      anunciarExecucoes(tx, ef, encarregado, {
        obraId,
        etapaId: concretagem,
        localIds: [localId],
        dataPrevista: "2026-11-20",
      }),
    );
    execucaoId = r.execucoes[0]?.id ?? "";
    const token = await emTransacao(
      eng.tenantId,
      async (tx) => (await abrirConferencia(tx, execucaoId, encarregado.usuarioId))?.token,
    );
    if (!token) throw new Error("sem sessão");
    await emTransacao(eng.tenantId, async (tx, ef) => {
      const sessao = await carregarSessaoChecklist(tx, token);
      for (const [i, pontoId] of sessao.estado.pontos.entries()) {
        await registrarMedida(tx, ef, {
          sessao,
          pontoId,
          medida: { tipo: "valor", valor: num(i ? "3,004" : "2,995") },
          canal: "flow",
        });
      }
      await concluirLote(tx, ef, sessao);
    });
    const painel = await painelDaObra(eng, obraId);
    expect(painel?.aguardandoDecisao.map((a) => [a.etapaNome, a.localNome, a.status])).toEqual([
      ["Concretagem", "L1", "aguardando_liberacao"],
    ]);
  });

  it("só o engenheiro responsável decide, na rodada certa, uma vez", async () => {
    await expect(decidirPeloPainel(admin, { execucaoId, rodada: 1, decisao: "liberada" })).rejects.toThrow(
      /permissão/,
    );
    await expect(decidirPeloPainel(eng, { execucaoId, rodada: 2, decisao: "liberada" })).rejects.toThrow(
      /rodada anterior/,
    );
    await expect(
      decidirPeloPainel(eng, { execucaoId, rodada: 1, decisao: "recusada", justificativa: " " }),
    ).rejects.toThrow(/justificativa/);
    const r = await decidirPeloPainel(eng, { execucaoId, rodada: 1, decisao: "liberada" });
    expect(r.status).toBe("liberada");
    await expect(decidirPeloPainel(eng, { execucaoId, rodada: 1, decisao: "liberada" })).rejects.toThrow(
      /já foi liberada/,
    );
    const [lib] = await withTenant(eng.tenantId, (tx) =>
      tx.select().from(schema.liberacao).where(eq(schema.liberacao.execucaoId, execucaoId)),
    );
    expect(lib?.canal).toBe("painel");
    expect((await painelDaObra(eng, obraId))?.aguardandoDecisao).toEqual([]);
    expect(fila.doTipo("gerar_pdf")).toEqual([
      { tenantId: eng.tenantId, obraId, execucaoId, solicitadoPorId: null },
    ]);
  });

  it("PDF da execução e da obra: gravados no bucket, listados e servidos por URL assinada", async () => {
    await gerarRelatorio({ tenantId: eng.tenantId, obraId, execucaoId, solicitadoPorId: null });
    await gerarRelatorio({
      tenantId: eng.tenantId,
      obraId,
      execucaoId: null,
      solicitadoPorId: eng.usuarioId,
    });
    const lista = await listarRelatorios(eng, { obraId });
    expect(lista.map((l) => l.titulo).sort()).toEqual(["Concretagem · L1", "Relatório da obra"]);
    for (const rel of lista) {
      const url = await urlDoRelatorio(eng, rel.id);
      const resp = await fetch(url ?? "");
      expect(resp.status).toBe(200);
      expect(
        Buffer.from(await resp.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
    }
    const [linha] = await withTenant(eng.tenantId, (tx) =>
      tx.select().from(schema.relatorio).where(eq(schema.relatorio.obraId, obraId)),
    );
    expect((await lerObjeto(linha?.storageKey ?? "")).length).toBeGreaterThan(1000);
  });
});
