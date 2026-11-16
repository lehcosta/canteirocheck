/**
 * Aceite da etapa 5 (prompt §10): cenário das duas lajes, de ponta a ponta, passando pelo
 * webhook assinado e pelo endpoint do Flow CIFRADO exatamente como a Meta chama.
 */
import { generateKeyPairSync } from "node:crypto";
import { schema, withTenant } from "@canteirocheck/db";
import { comDono, SEED, semearCenario, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import {
  type ClienteWhatsapp,
  definirClienteWhatsapp,
  esquecerConfigWhatsapp,
  type MensagemSaida,
} from "@canteirocheck/whatsapp";
import { webhookSimulado } from "@canteirocheck/whatsapp/simulador";
import {
  assinarCorpo,
  chavePublicaPem,
  cifrarMidiaComoMeta,
  cifrarPedidoComoMeta,
  decifrarRespostaComoMeta,
} from "@canteirocheck/whatsapp/transporte";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anuncioDiario,
  avisarPendencia,
  enviarMensagemPendente,
  linhaDoTempo,
  notificarEncarregado,
  notificarEngenheiro,
  processarMensagemRecebida,
  receberPedidoFlow,
  receberWebhook,
  resumoDaExecucao,
} from "../src";

// ─────────────────────────── Ambiente: Meta simulada ───────────────────────────

const APP_SECRET = "segredo-de-teste-do-app";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLICA = chavePublicaPem(privateKey);
process.env.WHATSAPP_MODO = "simulado";
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = "verificacao-teste";
process.env.WHATSAPP_FLOW_PRIVATE_KEY = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
).toString("base64");
esquecerConfigWhatsapp();

const fila = new FilaEmMemoria();
definirFila(fila);

const enviadas: { destino: string; mensagem: MensagemSaida; wamid: string }[] = [];
const cliente: ClienteWhatsapp = {
  modo: "simulado",
  async enviar(destino, mensagem) {
    const wamid = `wamid.TESTE.${enviadas.length + 1}`;
    enviadas.push({ destino, mensagem, wamid });
    return { waMessageId: wamid };
  },
  baixarMidia: async () => ({ dados: new Uint8Array(), mimeType: "image/jpeg" }),
  baixarCdn: async () => new Uint8Array(),
};
definirClienteWhatsapp(cliente);

const JOAO = SEED.joao.whatsappE164.slice(1);
const ANA = SEED.ana.whatsappE164.slice(1);

let tenantId: string;
let processados = 0;

/** Processa a fila em memória como o worker faria, até esvaziar. */
async function drenar() {
  while (processados < fila.jobs.length) {
    const job = fila.jobs[processados++];
    if (!job) break;
    const p = job.payload as unknown as {
      tenantId: string;
      mensagemId: string;
      execucaoId: string;
      liberacaoId: string;
      rodada: number;
    };
    switch (job.nome) {
      case "processar_mensagem":
        await processarMensagemRecebida(p.tenantId ?? null, p.mensagemId);
        break;
      case "enviar_mensagem":
        await enviarMensagemPendente(p.tenantId, p.mensagemId, cliente);
        break;
      case "notificar_engenheiro":
        await notificarEngenheiro(p.tenantId, p.execucaoId, p.rodada);
        break;
      case "notificar_encarregado":
        await notificarEncarregado(p.tenantId, p.liberacaoId);
        break;
      case "avisar_pendencia":
        await avisarPendencia(p.tenantId, p.execucaoId);
        break;
      default:
        break; // baixar_midia e gerar_pdf: testados no worker
    }
  }
}

async function webhook(corpo: unknown) {
  const texto = JSON.stringify(corpo);
  const r = await receberWebhook(texto, assinarCorpo(texto, APP_SECRET));
  expect(r.status).toBe(200);
  await drenar();
}

type Resposta = { screen: string; data: Record<string, unknown> };

async function flow(token: string, action: string, screen?: string, data?: Record<string, unknown>) {
  const { pedido, chaveAes, iv } = cifrarPedidoComoMeta(
    { version: "3.0", action, ...(screen ? { screen } : {}), ...(data ? { data } : {}), flow_token: token },
    PUBLICA,
  );
  const texto = JSON.stringify(pedido);
  const r = await receberPedidoFlow(texto, assinarCorpo(texto, APP_SECRET));
  const corpo =
    r.status === 200 ? decifrarRespostaComoMeta<Resposta>(r.corpo, chaveAes, iv) : JSON.parse(r.corpo);
  await drenar();
  return { status: r.status, corpo: corpo as Resposta };
}

function ultimaPara(destino: string) {
  const m = enviadas.filter((e) => e.destino === destino).at(-1);
  if (!m) throw new Error(`nada enviado para ${destino}`);
  return m;
}
function tokenDoFlow(destino: string) {
  const m = ultimaPara(destino).mensagem;
  if (m.tipo !== "flow") throw new Error(`última mensagem para ${destino} não é Flow: ${m.tipo}`);
  return m.flowToken;
}
function botoes(destino: string) {
  const m = ultimaPara(destino).mensagem;
  if (m.tipo !== "botoes") throw new Error(`última mensagem para ${destino} não tem botões: ${m.tipo}`);
  return m;
}

function foto() {
  const { arquivoCdn, meta } = cifrarMidiaComoMeta(Buffer.from("jpeg da forma da L4"));
  expect(arquivoCdn.length).toBeGreaterThan(0);
  return [
    { media_id: "m1", cdn_url: "https://cdn.simulado/x", file_name: "forma.jpg", encryption_metadata: meta },
  ];
}

beforeAll(async () => {
  tenantId = (await comDono(urlsDeTeste().dono, semearCenario)).tenantId;
});

describe("segurança do endpoint e do webhook", () => {
  it("assinatura errada → 432 (Flow) e 401 (webhook); lixo → 421; token desconhecido → 427; ping → active", async () => {
    const { pedido } = cifrarPedidoComoMeta({ version: "3.0", action: "ping" }, PUBLICA);
    const texto = JSON.stringify(pedido);
    expect((await receberPedidoFlow(texto, assinarCorpo(texto, "outro"))).status).toBe(432);
    const lixo = JSON.stringify({ ...pedido, encrypted_aes_key: Buffer.from("x").toString("base64") });
    expect((await receberPedidoFlow(lixo, assinarCorpo(lixo, APP_SECRET))).status).toBe(421);
    expect((await flow("token-que-nao-existe-1234567890", "INIT")).status).toBe(427);

    const ping = cifrarPedidoComoMeta({ version: "3.0", action: "ping" }, PUBLICA);
    const tp = JSON.stringify(ping.pedido);
    const r = await receberPedidoFlow(tp, assinarCorpo(tp, APP_SECRET));
    expect(decifrarRespostaComoMeta(r.corpo, ping.chaveAes, ping.iv)).toEqual({ data: { status: "active" } });

    const corpo = JSON.stringify(webhookSimulado.texto(JOAO, "oi"));
    expect((await receberWebhook(corpo, assinarCorpo(corpo, "errado"))).status).toBe(401);
  });

  it("webhook repetido pela Meta grava e processa uma vez só", async () => {
    const corpo = webhookSimulado.texto("5511987654321", "número desconhecido");
    const texto = JSON.stringify(corpo);
    const antes = fila.jobs.length;
    await receberWebhook(texto, assinarCorpo(texto, APP_SECRET));
    await receberWebhook(texto, assinarCorpo(texto, APP_SECRET));
    expect(fila.jobs.length - antes).toBe(1);
    await drenar();
  });
});

describe("cenário L3/L4 (§10)", () => {
  let execucaoId: string;
  let tokenRodada1: string;

  it("João anuncia 'Concretagem Laje L4 amanhã' pelo Flow de anúncio", async () => {
    await webhook(webhookSimulado.texto(JOAO, "boa tarde"));
    expect(botoes(JOAO).botoes.map((b) => b.id)).toEqual(["menu:anunciar", "menu:conferir"]);

    await webhook(webhookSimulado.botao(JOAO, "menu:anunciar", "Anunciar execução"));
    const token = tokenDoFlow(JOAO);
    const init = await flow(token, "INIT");
    expect(init.corpo.screen).toBe("ANUNCIO");
    const etapas = init.corpo.data.etapas as { id: string; title: string }[];
    const locais = init.corpo.data.locais as { id: string; title: string }[];
    const concretagem = etapas.find((e) => e.title === "Concretagem");
    const l4 = locais.find((l) => l.title === "L4");
    expect(concretagem && l4).toBeTruthy();

    const fim = await flow(token, "data_exchange", "ANUNCIO", {
      acao: "anunciar",
      etapa: concretagem?.id,
      locais: [l4?.id],
      quando: "amanha",
    });
    expect(fim.corpo).toEqual({
      screen: "SUCCESS",
      data: { extension_message_response: { params: { flow_token: token, anunciadas: "1" } } },
    });
    const resposta = botoes(JOAO);
    expect(resposta.texto).toContain("Concretagem · L4");
    execucaoId = (resposta.botoes[0]?.id ?? "").replace("conferir:", "");
    expect(execucaoId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("checklist: interface primeiro, 6,040 ❌ → refaz → 6,040 ❌ → causa + foto; eixos A e B ✅ → BLOQUEADA", async () => {
    await webhook(webhookSimulado.botao(JOAO, `conferir:${execucaoId}`, "Conferir L4"));
    const token = tokenDoFlow(JOAO);
    tokenRodada1 = token;

    expect((await flow(token, "INIT")).corpo.screen).toBe("INICIO");
    const p1 = await flow(token, "data_exchange", "INICIO", { acao: "comecar" });
    expect(p1.corpo.screen).toBe("MEDIR_A");
    expect(p1.corpo.data).toMatchObject({
      interface: true,
      simples: false,
      esperado: expect.stringContaining("± 0,5 cm"),
    });

    const interfaceL4 = { acao: "medir", referencia: "6,000", novo: "6,040", mesma_rn: "sim" };
    const semFoto = await flow(token, "data_exchange", "MEDIR_A", { ...interfaceL4, foto: [] });
    expect(semFoto.corpo).toMatchObject({
      screen: "MEDIR_A",
      data: { error_message: "Este ponto exige foto." },
    });

    const t1 = await flow(token, "data_exchange", "MEDIR_A", { ...interfaceL4, foto: foto() });
    expect(t1.corpo.screen).toBe("MEDIR_A"); // mesma tela, refrescada
    expect(t1.corpo.data).toMatchObject({ tem_aviso: true, aviso: expect.stringContaining("+4 cm") });

    const t2 = await flow(token, "data_exchange", "MEDIR_A", { ...interfaceL4, foto: foto() });
    expect(t2.corpo.screen).toBe("CAUSA_A");
    expect(t2.corpo.data.falha).toContain("L4 6,040 m × L3 6,000 m");

    const causa = await flow(token, "data_exchange", "CAUSA_A", {
      acao: "causa",
      causa: "forma_fora_do_nivel",
      detalhe: "",
      foto: foto(),
    });
    expect(causa.corpo.screen).toBe("MEDIR_B");

    const eixoA = await flow(token, "data_exchange", "MEDIR_B", { acao: "medir", medida: "6,005" });
    expect(eixoA.corpo).toMatchObject({ screen: "MEDIR_C", data: { aviso: expect.stringContaining("✅") } });
    const eixoB = await flow(token, "data_exchange", "MEDIR_C", { acao: "medir", medida: "6,000" });
    expect(eixoB.corpo.screen).toBe("RESUMO");
    expect(eixoB.corpo.data.status).toContain("BLOQUEADA");
    expect((eixoB.corpo.data.texto as string).split("\n").map((l) => [...l][0])).toEqual(["❌", "✅", "✅"]);

    const fim = await flow(token, "data_exchange", "RESUMO", { acao: "concluir" });
    expect(fim.corpo).toMatchObject({
      screen: "SUCCESS",
      data: { extension_message_response: { params: { status: "bloqueada" } } },
    });
    expect(ultimaPara(JOAO).mensagem).toMatchObject({
      tipo: "texto",
      texto: expect.stringContaining("BLOQUEADA"),
    });

    await withTenant(tenantId, async (tx) => {
      const [e] = await tx.select().from(schema.execucaoEtapa).where(eq(schema.execucaoEtapa.id, execucaoId));
      expect(e?.status).toBe("bloqueada");
      const v = await tx
        .select()
        .from(schema.verificacao)
        .where(eq(schema.verificacao.execucaoId, execucaoId))
        .orderBy(asc(schema.verificacao.criadoEm));
      expect(v.map((x) => [x.tentativa, x.dentroTolerancia, x.diferenca])).toEqual([
        [1, false, "0.0400"],
        [2, false, "0.0400"],
        [1, true, "0.0050"],
        [1, true, "0.0000"],
      ]);
      const d = await tx
        .select()
        .from(schema.divergencia)
        .where(eq(schema.divergencia.execucaoId, execucaoId));
      expect(d.map((x) => x.causaProvavel)).toEqual(["Forma montada fora do nível"]);
      const fotos = await tx.select().from(schema.midia).where(eq(schema.midia.status, "pendente"));
      expect(fotos.length).toBe(3); // 2 medidas da interface + causa
    });
    expect(fila.doTipo("baixar_midia")).toHaveLength(3);
  });

  it("Eng. Ana recebe alerta (template, janela fechada) → Ver → resumo com Liberar/Recusar", async () => {
    const aviso = ultimaPara(ANA).mensagem;
    expect(aviso).toMatchObject({ tipo: "template", nome: "canteiro_aviso" });

    await webhook(webhookSimulado.respostaTemplate(ANA, "ver", "Ver"));
    const resumo = botoes(ANA);
    expect(resumo.texto).toContain("🔴 BLOQUEADA");
    expect(resumo.texto).toContain("+4 cm");
    expect(resumo.texto).toContain("Forma montada fora do nível");
    expect(resumo.botoes.map((b) => b.id)).toEqual([`lib:${execucaoId}:1`, `rec:${execucaoId}:1`]);
  });

  it("Ana recusa com justificativa → João recebe 'Ajustar forma e reenviar conferência'", async () => {
    await webhook(webhookSimulado.botao(ANA, `rec:${execucaoId}:1`, "Recusar"));
    const token = tokenDoFlow(ANA);
    expect((await flow(token, "INIT")).corpo.screen).toBe("JUSTIFICAR");
    const vazia = await flow(token, "data_exchange", "JUSTIFICAR", {
      acao: "justificar",
      justificativa: "  ",
    });
    expect(vazia.corpo.data.error_message).toContain("justificativa");
    const ok = await flow(token, "data_exchange", "JUSTIFICAR", {
      acao: "justificar",
      justificativa: "Forma 4 cm acima da borda da L3. Ajustar forma e reenviar conferência.",
    });
    expect(ok.corpo.screen).toBe("SUCCESS");

    const paraJoao = botoes(JOAO);
    expect(paraJoao.texto).toContain("RECUSADA por Eng. Ana");
    expect(paraJoao.texto).toContain("Ajustar forma e reenviar conferência");
    expect(paraJoao.botoes[0]?.id).toBe(`conferir:${execucaoId}`);

    await withTenant(tenantId, async (tx) => {
      const [l] = await tx.select().from(schema.liberacao).where(eq(schema.liberacao.execucaoId, execucaoId));
      expect(l).toMatchObject({ decisao: "recusada", rodada: 1, canal: "flow" });
      const acoes = await tx
        .select({ acao: schema.auditLog.acao })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.entidade, "execucao_etapa"), eq(schema.auditLog.entidadeId, execucaoId)),
        );
      expect(acoes.map((a) => a.acao)).toEqual([
        "execucao.anunciada",
        "execucao.bloqueada",
        "execucao.conferencia_concluida",
        "execucao.recusada",
      ]);
    });
  });

  it("reconferência (rodada 2) tudo ✅ → Ana libera pelo botão → João recebe LIBERADA; token antigo morre", async () => {
    await webhook(webhookSimulado.botao(JOAO, `conferir:${execucaoId}`, "Reenviar conferência"));
    const token = tokenDoFlow(JOAO);
    expect((await flow(tokenRodada1, "INIT")).status).toBe(427);

    await flow(token, "INIT");
    expect((await flow(token, "data_exchange", "INICIO", { acao: "comecar" })).corpo.screen).toBe("MEDIR_A");
    await flow(token, "data_exchange", "MEDIR_A", {
      acao: "medir",
      referencia: "6,000",
      novo: "6,003",
      mesma_rn: "sim",
      foto: foto(),
    });
    await flow(token, "data_exchange", "MEDIR_B", { acao: "medir", medida: "6,002" });
    const resumo = await flow(token, "data_exchange", "MEDIR_C", { acao: "medir", medida: "5,995" });
    expect(resumo.corpo.data.status).toContain("Tudo dentro da tolerância");
    await flow(token, "data_exchange", "RESUMO", { acao: "concluir" });

    const paraAna = botoes(ANA);
    expect(paraAna.texto).toContain("🟢 Pronta para liberar");
    await webhook(webhookSimulado.botao(ANA, `lib:${execucaoId}:2`, "Liberar"));
    expect(ultimaPara(JOAO).mensagem).toMatchObject({
      tipo: "texto",
      texto: expect.stringContaining("LIBERADA por Eng. Ana"),
    });

    // botão velho (rodada 1) não decide nada
    await webhook(webhookSimulado.botao(ANA, `lib:${execucaoId}:1`, "Liberar"));
    expect(ultimaPara(ANA).mensagem).toMatchObject({
      tipo: "texto",
      texto: expect.stringContaining("não aguarda mais"),
    });

    const r = await withTenant(tenantId, (tx) => resumoDaExecucao(tx, execucaoId));
    expect(r?.status).toBe("liberada");
    expect(r?.rodadas.map((x) => [x.rodada, x.ok, x.divergentes, x.decisao?.decisao])).toEqual([
      [1, 2, 1, "recusada"],
      [2, 3, 0, "liberada"],
    ]);
  });

  it("linha do tempo mostra a execução liberada", async () => {
    const [ana] = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.usuario).where(eq(schema.usuario.whatsappE164, SEED.ana.whatsappE164)),
    );
    if (!ana) throw new Error("Ana não encontrada");
    const itens = await linhaDoTempo(
      { tenantId, usuarioId: ana.id, papel: "engenheiro" },
      (await obraDoSeed()).id,
    );
    expect(itens.map((i) => [i.etapaNome, i.localNome, i.status, i.rodadaAtual])).toEqual([
      ["Concretagem", "L4", "liberada", 2],
    ]);
  });
});

describe("custo e janela", () => {
  it("status com pricing regular vira um evento de custo por wamid", async () => {
    const template = enviadas.find((e) => e.destino === ANA && e.mensagem.tipo === "template");
    if (!template) throw new Error("template não enviado");
    await webhook(webhookSimulado.status(template.wamid, "sent", ANA, "utility"));
    await webhook(webhookSimulado.status(template.wamid, "delivered", ANA, "utility"));
    await webhook(webhookSimulado.status(template.wamid, "read", ANA));
    await withTenant(tenantId, async (tx) => {
      const custos = await tx
        .select()
        .from(schema.eventoCusto)
        .where(eq(schema.eventoCusto.referencia, template.wamid));
      expect(custos).toHaveLength(1);
      expect(custos[0]).toMatchObject({ tipo: "whatsapp_template", quantidade: "1.0000" });
      const [m] = await tx
        .select()
        .from(schema.mensagemWhatsapp)
        .where(eq(schema.mensagemWhatsapp.waMessageId, template.wamid));
      expect(m?.statusEntrega).toBe("read");
    });
    // "delivered" atrasado não regride
    await webhook(webhookSimulado.status(template.wamid, "delivered", ANA));
    const [m] = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.mensagemWhatsapp)
        .where(eq(schema.mensagemWhatsapp.waMessageId, template.wamid)),
    );
    expect(m?.statusEntrega).toBe("read");
  });

  it("anúncio diário: janela aberta → Flow direto; a mensagem de abertura do dia é idempotente por obra", async () => {
    const obra = await obraDoSeed();
    const antes = enviadas.length;
    await anuncioDiario(tenantId, obra.id);
    await drenar();
    const novas = enviadas.slice(antes);
    expect(novas.map((n) => [n.destino, n.mensagem.tipo])).toEqual([[JOAO, "flow"]]);
  });
});

async function obraDoSeed() {
  const [o] = await withTenant(tenantId, (tx) =>
    tx.select().from(schema.obra).where(eq(schema.obra.nome, "Edifício Teste")),
  );
  if (!o) throw new Error("obra do seed não encontrada");
  return o;
}
