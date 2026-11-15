/**
 * Etapa 7: isolamento pelos casos de uso (não só pelo SQL), idempotência ponta a ponta e varredura.
 */
import { generateKeyPairSync, randomInt } from "node:crypto";
import { schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import { garantirBucket } from "@canteirocheck/storage";
import { type ClienteWhatsapp, esquecerConfigWhatsapp } from "@canteirocheck/whatsapp";
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
  emTransacao,
  enviarFlowChecklist,
  enviarMensagemPendente,
  exporMetricas,
  gerarRelatorio,
  indicadoresDaObra,
  listarPontos,
  listarRelatorios,
  obterExecucao,
  obterProjeto,
  prepararMensagem,
  registrarProjeto,
  solicitarRelatorio,
  tratarPedidoFlow,
  urlDaMidia,
  urlDoRelatorio,
  varrerParados,
} from "../src";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.WHATSAPP_MODO = "simulado";
process.env.WHATSAPP_APP_SECRET = "segredo-endurecimento";
process.env.WHATSAPP_VERIFY_TOKEN = "verificacao-endurecimento";
process.env.WHATSAPP_FLOW_PRIVATE_KEY = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
).toString("base64");
esquecerConfigWhatsapp();
const fila = new FilaEmMemoria();
definirFila(fila);

const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
type Cenario = {
  admin: Contexto;
  eng: Contexto;
  enc: Contexto;
  obraId: string;
  localId: string;
  execucaoId: string;
};

async function cenario(nome: string): Promise<Cenario> {
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome,
      cnpj: d(14),
      admin: { nome: "Adm", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  const admin: Contexto = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  const e = await criarUsuario(admin, {
    nome: "Eng",
    papel: "engenheiro",
    email: `e${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  const eng: Contexto = { tenantId: t.tenantId, usuarioId: e.id, papel: "engenheiro" };
  const j = await criarUsuario(admin, { nome: "Enc", papel: "encarregado", whatsapp: `(11) 9${d(8)}` });
  const enc: Contexto = { tenantId: t.tenantId, usuarioId: j.id, papel: "encarregado" };
  const obraId = (await criarObra(admin, { nome: `Obra ${nome}`, engenheiroResponsavelId: eng.usuarioId }))
    .id;
  const localId = (await criarLocal(eng, { obraId, tipo: "laje", nome: "L1" })).id;
  await withTenant(t.tenantId, (tx) =>
    tx
      .insert(schema.obraMembro)
      .values({ tenantId: t.tenantId, obraId, usuarioId: j.id, papel: "encarregado" }),
  );
  await criarPontoManual(eng, {
    obraId,
    etapaId: "3",
    localId,
    descricao: "Nível do fundo",
    grandeza: "nivel",
    unidade: "m",
    valorEsperado: "3,00",
    toleranciaMais: "0,01",
    toleranciaMenos: "0,01",
  });
  const r = await emTransacao(t.tenantId, (tx, ef) =>
    anunciarExecucoes(tx, ef, enc, { obraId, etapaId: 3, localIds: [localId], dataPrevista: "2026-11-20" }),
  );
  return { admin, eng, enc, obraId, localId, execucaoId: r.execucoes[0]?.id ?? "" };
}

let a: Cenario;
let b: Cenario;

beforeAll(async () => {
  await garantirBucket();
  a = await cenario("Construtora A7");
  b = await cenario("Construtora B7");
});

describe("isolamento pelos casos de uso", () => {
  it("B não lê nem decide nada de A, mesmo com os ids certos", async () => {
    expect(await obterExecucao(b.eng, a.execucaoId)).toBeNull();
    expect(await listarPontos(b.eng, a.obraId)).toEqual([]);
    expect(await indicadoresDaObra(b.eng, a.obraId)).toEqual([]);
    await expect(
      decidirPeloPainel(b.eng, { execucaoId: a.execucaoId, rodada: 1, decisao: "liberada" }),
    ).rejects.toThrow(/não encontrada/);
    await expect(solicitarRelatorio(b.eng, { obraId: a.obraId })).rejects.toThrow(/não encontrada/);

    const projeto = await registrarProjeto(
      a.admin,
      { obraId: a.obraId, disciplina: "estrutura", titulo: "x", codigo: "E1", revisao: "R0" },
      { dados: Buffer.from("%PDF-1.7\n"), nome: "x.pdf" },
    );
    expect(await obterProjeto(b.eng, projeto.id)).toBeNull();
    const { relatorioId } = await gerarRelatorio({
      tenantId: a.admin.tenantId,
      obraId: a.obraId,
      execucaoId: null,
      solicitadoPorId: null,
    });
    expect(await urlDoRelatorio(b.eng, relatorioId)).toBeNull();
    expect(await urlDoRelatorio(a.eng, relatorioId)).toMatch(/^http/);
    expect(await listarRelatorios(b.eng, { obraId: a.obraId })).toEqual([]);
  });

  it("mídia de A não sai por URL assinada para B", async () => {
    const [m] = await withTenant(a.admin.tenantId, (tx) =>
      tx
        .insert(schema.midia)
        .values({
          tenantId: a.admin.tenantId,
          origem: "upload_painel",
          status: "armazenada",
          storageKey: "tenants/x/y.jpg",
          sha256: "0",
        })
        .returning(),
    );
    expect(await urlDaMidia(b.eng, m?.id ?? "")).toBeNull();
  });
});

describe("idempotência", () => {
  it("o mesmo data_exchange repetido (retry do app) não grava a medida duas vezes", async () => {
    await emTransacao(a.admin.tenantId, (tx, ef) =>
      enviarFlowChecklist(tx, ef, { usuarioId: a.enc.usuarioId, execucaoId: a.execucaoId }),
    );
    const [sessao] = await withTenant(a.admin.tenantId, (tx) =>
      tx.select().from(schema.flowSessao).where(eq(schema.flowSessao.execucaoId, a.execucaoId)),
    );
    const token = sessao?.token ?? "";
    const pedido = {
      version: "3.0",
      action: "data_exchange",
      screen: "MEDIR_A",
      flow_token: token,
      data: { acao: "medir", medida: "3,004" },
    };
    const r1 = await tratarPedidoFlow(pedido);
    const r2 = await tratarPedidoFlow(pedido);
    expect(r1).toMatchObject({ status: 200, corpo: { screen: "RESUMO" } });
    expect(r2).toMatchObject({ status: 200, corpo: { screen: "RESUMO" } });
    const v = await withTenant(a.admin.tenantId, (tx) =>
      tx.select().from(schema.verificacao).where(eq(schema.verificacao.execucaoId, a.execucaoId)),
    );
    expect(v).toHaveLength(1);
  });

  it("job de envio repetido manda a mensagem uma vez só", async () => {
    let enviadas = 0;
    const cliente: ClienteWhatsapp = {
      modo: "simulado",
      enviar: async () => ({ waMessageId: `wamid.end.${++enviadas}` }),
      baixarMidia: async () => ({ dados: new Uint8Array(), mimeType: "image/jpeg" }),
      baixarCdn: async () => new Uint8Array(),
    };
    const id = await emTransacao(a.admin.tenantId, (tx, ef) =>
      prepararMensagem(tx, ef, {
        tenantId: a.admin.tenantId,
        usuarioId: a.enc.usuarioId,
        payload: {
          assunto: "teste",
          mensagem: {
            tipo: "template",
            nome: "canteiro_aviso",
            idioma: "pt_BR",
            parametros: ["a", "b", "c"],
          },
        },
      }),
    );
    expect(await enviarMensagemPendente(a.admin.tenantId, id, cliente)).toMatchObject({ tipo: "enviada" });
    expect(await enviarMensagemPendente(a.admin.tenantId, id, cliente)).toMatchObject({ tipo: "ignorada" });
    expect(enviadas).toBe(1);
  });
});

describe("varredura e métricas", () => {
  it("mensagem esquecida em 'pendente' volta para a fila", async () => {
    const [m] = await withTenant(b.admin.tenantId, (tx) =>
      tx
        .insert(schema.mensagemWhatsapp)
        .values({
          tenantId: b.admin.tenantId,
          usuarioId: b.enc.usuarioId,
          direcao: "saida",
          tipo: "texto",
          payload: { assunto: "x", mensagem: { tipo: "texto", texto: "oi" } },
          statusEntrega: "pendente",
          criadoEm: new Date(Date.now() - 10 * 60 * 1000),
        })
        .returning(),
    );
    fila.limpar();
    const r = await varrerParados(3);
    expect(r.reenfileirados).toBeGreaterThanOrEqual(1);
    expect(fila.doTipo("enviar_mensagem")).toContainEqual({ tenantId: b.admin.tenantId, mensagemId: m?.id });
  });

  it("exposição Prometheus traz contagem por etapa sem identificar construtora", async () => {
    const texto = await exporMetricas();
    expect(texto).toMatch(
      /canteiro_execucoes\{etapa="concretagem",status="(anunciada|em_conferencia|aguardando_liberacao)"\} \d+/,
    );
    expect(texto).not.toContain(a.admin.tenantId);
    const ind = await indicadoresDaObra(a.eng, a.obraId);
    expect(ind[0]).toMatchObject({ etapa: "Concretagem", execucoes: 1 });
  });
});
