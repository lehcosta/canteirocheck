/**
 * Aceite da etapa 3 (prompt §9.3): notas "a definir"/"aguardando" viram pendências com etapa e risco;
 * pontos de interface aparecem com trecho_origem. IA falsa (roteiro), mesmo schema zod da real.
 */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { LlmFalso, type SaidaPontos } from "@canteirocheck/ai";
import { registrarEntradaWhatsapp, schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import { garantirBucket } from "@canteirocheck/storage";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anunciarExecucoes,
  type Contexto,
  confirmarMedidaDaConversa,
  criarLocal,
  criarObra,
  criarPontoManual,
  criarUsuario,
  detectarPendencias,
  emTransacao,
  gerarPontosSugeridos,
  interpretarMensagem,
  listarPontos,
  obterProjeto,
  processarExtracao,
  registrarProjeto,
  resolverPendencia,
} from "../src";

const fila = new FilaEmMemoria();
definirFila(fila);
const DWG = readFileSync(
  new URL("../../../services/dwg-extractor/test/fixtures/amostra.dwg", import.meta.url),
);
const SAIDA = JSON.parse(
  readFileSync(new URL("../../extracao/test/fixtures/amostra.extracao.json", import.meta.url), "utf8"),
);
const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

let admin: Contexto;
let eng: Contexto;
let joao: Contexto & { tel: string };
let obraId: string;
let projetoId: string;

async function projetoExtraido(codigo: string) {
  const { id } = await registrarProjeto(
    admin,
    { obraId, disciplina: "arquitetura", titulo: "Planta", codigo, revisao: "R0" },
    { dados: DWG, nome: "p.dwg" },
  );
  await processarExtracao(admin.tenantId, id, async () => SAIDA);
  return id;
}

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora IA",
      cnpj: d(14),
      admin: { nome: "Admin", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  admin = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  const e = await criarUsuario(admin, {
    nome: "Eng. Dora",
    papel: "engenheiro",
    email: `d${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  eng = { tenantId: t.tenantId, usuarioId: e.id, papel: "engenheiro" };
  const tel = `9${d(8)}`;
  const j = await criarUsuario(admin, { nome: "João", papel: "encarregado", whatsapp: `(11) ${tel}` });
  joao = { tenantId: t.tenantId, usuarioId: j.id, papel: "encarregado", tel: `5511${tel}` };
  obraId = (await criarObra(admin, { nome: "Obra IA", engenheiroResponsavelId: eng.usuarioId })).id;
  await criarLocal(eng, { obraId, tipo: "laje", nome: "L3" });
  await criarLocal(eng, { obraId, tipo: "laje", nome: "L4" });
  await withTenant(t.tenantId, (tx) =>
    tx
      .insert(schema.obraMembro)
      .values({ tenantId: t.tenantId, obraId, usuarioId: j.id, papel: "encarregado" }),
  );
  projetoId = await projetoExtraido("ARQ-01");
});

describe("pendências", () => {
  it("nota 'a definir / aguardando' → pendência com etapa e risco (modelo pequeno, prompt versionado)", async () => {
    const llm = new LlmFalso({
      pendencias: (t) => {
        expect(t.usuario).toContain("PISO A DEFINIR");
        return {
          itens: [
            {
              indice: 0,
              eh_pendencia: true,
              etapa_bloqueada: "piso",
              risco: "alto",
              motivo: "Piso indefinido.",
            },
          ],
        };
      },
    });
    expect(await detectarPendencias(admin.tenantId, projetoId, llm)).toEqual({
      criadas: 1,
      por: "claude-haiku-5-5@pendencias-v1",
    });
    expect(await detectarPendencias(admin.tenantId, projetoId, llm)).toMatchObject({ criadas: 0 }); // idempotente
    const p = await obterProjeto(eng, projetoId);
    expect(p?.pendencias).toEqual([
      expect.objectContaining({
        textoOriginal: "NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO DE AR CONDICIONADO",
        etapaNome: "Piso",
        risco: "alto",
        status: "aberta",
      }),
    ]);
  });

  it("sem IA: o pré-filtro vira pendência para revisão humana; o engenheiro resolve com nota", async () => {
    const outro = await projetoExtraido("ARQ-02");
    expect(await detectarPendencias(admin.tenantId, outro, null)).toEqual({
      criadas: 1,
      por: "regex (revisão humana)",
    });
    const [pend] = (await obterProjeto(eng, outro))?.pendencias ?? [];
    if (!pend) throw new Error("sem pendência");
    await expect(
      resolverPendencia(eng, { pendenciaId: pend.id, status: "resolvida", nota: " " }),
    ).rejects.toThrow(/como/);
    await resolverPendencia(eng, {
      pendenciaId: pend.id,
      status: "resolvida",
      nota: "Definido porcelanato 60x60 (RQ-12).",
    });
    await expect(resolverPendencia(eng, { pendenciaId: pend.id, status: "descartada" })).rejects.toThrow(
      /já foi tratada/,
    );
  });
});

describe("pontos sugeridos pela IA", () => {
  const ponto = (extra: Partial<SaidaPontos["pontos"][number]>): SaidaPontos["pontos"][number] => ({
    etapa: "concretagem",
    local: "L4",
    regiao: null,
    descricao: "x",
    grandeza: "nivel",
    valor_esperado: "6.00",
    unidade: "m",
    tolerancia_mais: null,
    tolerancia_menos: null,
    eh_interface: false,
    local_referencia: null,
    referencia_nivel: null,
    exige_foto: false,
    trecho_origem: "+6,00",
    ...extra,
  });

  it("interface com trecho_origem entra como sugerido; trecho inventado e tolerância negativa são descartados", async () => {
    const llm = new LlmFalso({
      pontos: () => ({
        pontos: [
          ponto({
            descricao: "Interface L3/L4 — nível da forma da L4 junto à borda da L3",
            eh_interface: true,
            local_referencia: "L3",
            tolerancia_mais: "0.005",
            tolerancia_menos: "0.005",
            referencia_nivel: "N.A.",
            trecho_origem: "+6,00",
          }),
          ponto({
            etapa: "contrapiso",
            local: "SALA",
            descricao: "Nível do contrapiso da sala",
            valor_esperado: "3.05",
            trecho_origem: "N.A. +3,05",
          }),
          ponto({ descricao: "Inventado", trecho_origem: "NÍVEL +7,25 CONFORME PROJETO" }),
          ponto({ descricao: "Tolerância negativa", tolerancia_mais: "-0.01", tolerancia_menos: "0.01" }),
        ],
      }),
    });
    const r = await gerarPontosSugeridos(admin.tenantId, projetoId, llm);
    expect(r).toEqual({
      criados: 2,
      status: "ok",
      descartados: [
        { descricao: "Inventado", motivo: "trecho de origem não encontrado no projeto" },
        { descricao: "Tolerância negativa", motivo: "tolerância inválida" },
      ],
    });
    // o prompt leva os locais da obra e os ambientes do projeto, sem o carimbo
    expect(llm.chamadas[0]?.usuario).toContain("- L4 (laje)");
    expect(llm.chamadas[0]?.usuario).toContain("- SALA — 18.50 m²");
    expect(llm.chamadas[0]?.usuario).not.toContain("CONSTRUTORA EXEMPLO LTDA");

    const pontos = await listarPontos(eng, obraId);
    expect(
      pontos.map((p) => [
        p.descricao,
        p.origem,
        p.statusRevisao,
        p.ehInterface,
        p.localReferenciaNome,
        p.trechoOrigem,
        p.localNome,
      ]),
    ).toEqual([
      [
        "Interface L3/L4 — nível da forma da L4 junto à borda da L3",
        "ia",
        "sugerido",
        true,
        "L3",
        "+6,00",
        "L4",
      ],
      ["Nível do contrapiso da sala", "ia", "sugerido", false, null, "N.A. +3,05", "SALA"], // ambiente virou local
    ]);
    expect(pontos[0]?.esperado).toBe("6,000 m ± 0,5 cm");
    expect(await gerarPontosSugeridos(admin.tenantId, projetoId, llm)).toMatchObject({ status: "ja_gerado" });

    const custos = await withTenant(admin.tenantId, (tx) =>
      tx
        .select()
        .from(schema.eventoCusto)
        .where(and(eq(schema.eventoCusto.obraId, obraId), eq(schema.eventoCusto.tipo, "llm_tokens"))),
    );
    expect(custos.map((c) => c.referencia).sort()).toEqual([
      "claude-haiku-5-5@pendencias-v1",
      "claude-opus-5-5@pontos-v1",
    ]);
  });
});

describe("fallback conversacional", () => {
  it("texto livre → IA acha ponto e valor → pede confirmação → grava verificação não estruturada (core decide)", async () => {
    const { id: pontoId } = await criarPontoManual(eng, {
      obraId,
      etapaId: "3",
      localId: (await listarPontos(eng, obraId))[0]?.localId ?? "",
      descricao: "Nível do fundo da forma — eixo C",
      grandeza: "nivel",
      unidade: "m",
      valorEsperado: "6,00",
      toleranciaMais: "0,01",
      toleranciaMenos: "0,01",
    });
    const l4 = (await listarPontos(eng, obraId))[0]?.localId ?? "";
    const anuncio = await emTransacao(admin.tenantId, (tx, ef) =>
      anunciarExecucoes(tx, ef, joao, { obraId, etapaId: 3, localIds: [l4], dataPrevista: "2026-11-20" }),
    );
    expect(anuncio.execucoes).toHaveLength(1);

    const entrada = await registrarEntradaWhatsapp({
      waMessageId: `wamid.${d(10)}`,
      waId: joao.tel,
      tipo: "text",
      payload: { conteudo: { tipo: "texto", texto: "eixo C da L4 deu 6,005" } },
    });
    const llm = new LlmFalso({
      interpretacao: (t) => {
        expect(t.usuario).toContain("[0] Nível do fundo da forma — eixo C");
        return {
          classificacao: "medida",
          medidas: [{ ponto: 0, valor: "6.005", unidade: "m", valor_referencia: null, mesma_rn: null }],
          resumo: "Eixo C da L4 = 6,005 m",
        };
      },
    });
    expect(await interpretarMensagem(admin.tenantId, entrada.mensagemId, llm)).toEqual({
      status: "confirmacao_pedida",
      medidas: 1,
    });

    const [pedido] = await withTenant(admin.tenantId, (tx) =>
      tx
        .select()
        .from(schema.mensagemWhatsapp)
        .where(
          and(
            eq(schema.mensagemWhatsapp.usuarioId, joao.usuarioId),
            eq(schema.mensagemWhatsapp.direcao, "saida"),
          ),
        ),
    );
    expect(pedido?.payload).toMatchObject({
      mensagem: {
        tipo: "botoes",
        texto: expect.stringContaining("= 6,005 m. Confirma?"),
        botoes: [{ id: `conf:${entrada.mensagemId}:0` }, {}],
      },
    });

    const r = await emTransacao(admin.tenantId, (tx, ef) =>
      confirmarMedidaDaConversa(tx, ef, joao, entrada.mensagemId, 0),
    );
    expect(r).toEqual({ acao: "conversa:medida_ok" });
    const [v] = await withTenant(admin.tenantId, (tx) =>
      tx.select().from(schema.verificacao).where(eq(schema.verificacao.pontoId, pontoId)),
    );
    expect(v).toMatchObject({
      canal: "conversa",
      estruturada: false,
      dentroTolerancia: true,
      valorMedido: "6.0050",
      flowToken: null,
    });
    await expect(
      emTransacao(admin.tenantId, (tx, ef) => confirmarMedidaDaConversa(tx, ef, joao, entrada.mensagemId, 0)),
    ).rejects.toThrow(/não espera medida/);
  });
});
