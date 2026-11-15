import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lerWebhook, paraGraph } from "../src";
import { webhookSimulado } from "../src/simulador";
import {
  assinarCorpo,
  assinaturaValida,
  chavePublicaPem,
  cifrarMidiaComoMeta,
  cifrarPedidoComoMeta,
  cifrarResposta,
  decifrarMidiaDoFlow,
  decifrarPedido,
  decifrarRespostaComoMeta,
  FalhaDecifrar,
} from "../src/transporte";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const outra = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

describe("criptografia do endpoint de Flows", () => {
  it("ida e volta: Meta cifra → servidor decifra → servidor cifra (IV invertido) → Meta decifra", () => {
    const corpo = { version: "3.0", action: "INIT", flow_token: "tok", data: {} };
    const { pedido, chaveAes, iv } = cifrarPedidoComoMeta(corpo, chavePublicaPem(privateKey));
    const decifrado = decifrarPedido(pedido, privateKey);
    expect(decifrado.corpo).toEqual(corpo);
    expect(decifrado.chaveAes.equals(chaveAes)).toBe(true);

    const resposta = { screen: "INICIO", data: { titulo: "Concretagem · L4" } };
    const base64 = cifrarResposta(resposta, decifrado.chaveAes, decifrado.iv);
    expect(decifrarRespostaComoMeta(base64, chaveAes, iv)).toEqual(resposta);
  });

  it("a resposta NÃO decifra com o IV original (tem que ser o invertido)", () => {
    const { pedido, chaveAes, iv } = cifrarPedidoComoMeta({ a: 1 }, chavePublicaPem(privateKey));
    const d = decifrarPedido(pedido, privateKey);
    const base64 = cifrarResposta({ ok: true }, d.chaveAes, d.iv);
    const ivInvertidoDeNovo = Buffer.from(iv.map((b) => b ^ 0xff));
    expect(() => decifrarRespostaComoMeta(base64, chaveAes, ivInvertidoDeNovo)).toThrow();
  });

  it("chave errada ou dado adulterado → FalhaDecifrar (endpoint responde 421)", () => {
    const { pedido } = cifrarPedidoComoMeta({ a: 1 }, chavePublicaPem(outra));
    expect(() => decifrarPedido(pedido, privateKey)).toThrow(FalhaDecifrar);

    const ok = cifrarPedidoComoMeta({ a: 1 }, chavePublicaPem(privateKey)).pedido;
    const dados = Buffer.from(ok.encrypted_flow_data, "base64");
    dados[0] = (dados[0] ?? 0) ^ 1;
    expect(() =>
      decifrarPedido({ ...ok, encrypted_flow_data: dados.toString("base64") }, privateKey),
    ).toThrow(FalhaDecifrar);
  });
});

describe("assinatura X-Hub-Signature-256", () => {
  const corpo = '{"object":"whatsapp_business_account"}';
  it("aceita a assinatura certa e recusa as outras", () => {
    const ass = assinarCorpo(corpo, "segredo-do-app");
    expect(ass).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(assinaturaValida(corpo, ass, "segredo-do-app")).toBe(true);
    expect(assinaturaValida(corpo, ass, "outro-segredo")).toBe(false);
    expect(assinaturaValida(`${corpo} `, ass, "segredo-do-app")).toBe(false);
    expect(assinaturaValida(corpo, null, "segredo-do-app")).toBe(false);
    expect(assinaturaValida(corpo, "sha256=abc", "segredo-do-app")).toBe(false);
  });
});

describe("mídia do PhotoPicker (AES-256-CBC + HMAC truncado)", () => {
  it("decifra o que o CDN entrega e confere os hashes", () => {
    const foto = Buffer.from("conteúdo de uma foto jpeg".repeat(50));
    const { arquivoCdn, meta } = cifrarMidiaComoMeta(foto);
    expect(decifrarMidiaDoFlow(arquivoCdn, meta).equals(foto)).toBe(true);
  });

  it("recusa arquivo adulterado", () => {
    const { arquivoCdn, meta } = cifrarMidiaComoMeta(Buffer.from("foto"));
    const adulterado = Buffer.from(arquivoCdn);
    adulterado[0] = (adulterado[0] ?? 0) ^ 1;
    expect(() => decifrarMidiaDoFlow(adulterado, meta)).toThrow(/hash/);
    // hash recalculado pelo atacante, mas sem a chave HMAC
    const meta2 = { ...meta, encrypted_hash: createHash("sha256").update(adulterado).digest("base64") };
    expect(() => decifrarMidiaDoFlow(adulterado, meta2)).toThrow(/HMAC/);
  });
});

describe("payloads da Cloud API", () => {
  it("botões respeitam os limites", () => {
    const p = paraGraph("5511900000003", {
      tipo: "botoes",
      texto: "Concretagem da L4 bloqueada",
      botoes: [
        { id: "lib:1:1", titulo: "Liberar" },
        { id: "rec:1:1", titulo: "Recusar" },
      ],
    });
    expect(p).toMatchObject({ type: "interactive", interactive: { type: "button" } });
    expect(() =>
      paraGraph("1", {
        tipo: "botoes",
        texto: "x",
        botoes: [{ id: "a", titulo: "um título longo demais aqui" }],
      }),
    ).toThrow();
  });

  it("Flow com data_exchange e sem flow_action_payload", () => {
    const p = paraGraph("5511900000003", {
      tipo: "flow",
      texto: "Conferência da concretagem da L4",
      flowNome: "canteiro_checklist_v1",
      flowToken: "tok",
      cta: "Conferir agora",
    }) as { interactive: { action: { parameters: Record<string, unknown> } } };
    expect(p.interactive.action.parameters).toEqual({
      flow_message_version: "3",
      flow_token: "tok",
      flow_name: "canteiro_checklist_v1",
      flow_cta: "Conferir agora",
      flow_action: "data_exchange",
    });
  });

  it("template com resposta rápida", () => {
    const p = paraGraph("5511900000002", {
      tipo: "template",
      nome: "canteiro_aviso",
      idioma: "pt_BR",
      parametros: ["Ana", "Edifício Teste", "x"],
      respostasRapidas: ["ver"],
    }) as { template: { components: unknown[] } };
    expect(p.template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana" },
          { type: "text", text: "Edifício Teste" },
          { type: "text", text: "x" },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: "ver" }],
      },
    ]);
  });
});

describe("leitura do webhook", () => {
  it("normaliza texto, botão, resposta de template, nfm_reply e status", () => {
    const tipos = [
      webhookSimulado.texto("5511900000003", "oi"),
      webhookSimulado.botao("5511900000002", "lib:x:1", "Liberar"),
      webhookSimulado.respostaTemplate("5511900000002", "ver", "Ver"),
      webhookSimulado.flow("5511900000003", { flow_token: "tok", acao: "x" }),
    ].map((c) => lerWebhook(c).mensagens[0]?.conteudo);
    expect(tipos).toEqual([
      { tipo: "texto", texto: "oi" },
      { tipo: "botao", id: "lib:x:1", titulo: "Liberar" },
      { tipo: "resposta_template", payload: "ver", texto: "Ver" },
      { tipo: "flow", resposta: { flow_token: "tok", acao: "x" } },
    ]);
    const st = lerWebhook(webhookSimulado.status("wamid.1", "delivered", "5511900000002", "utility"))
      .status[0];
    expect(st).toMatchObject({
      id: "wamid.1",
      status: "delivered",
      pricing: { type: "regular", category: "utility" },
    });
  });
});
