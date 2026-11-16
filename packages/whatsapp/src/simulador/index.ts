import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { CHAVES_SIMULADOR, type ItemCaixaSimulada } from "../cliente";
import { assinarCorpo } from "../transporte/assinatura";
import { cifrarPedidoComoMeta, decifrarRespostaComoMeta } from "../transporte/cripto-flow";

/**
 * "Mailpit do WhatsApp": faz o papel da Meta para testar sem conta. Só transporte — nenhuma regra
 * de negócio aqui. Chama o webhook e o endpoint do Flow REAIS, com a mesma assinatura (App Secret)
 * e a mesma criptografia (chave pública do endpoint) que a Meta usa.
 */

const PHONE_NUMBER_ID_SIMULADO = "100000000000001";

function envelope(campo: "messages", value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_SIMULADA",
        changes: [
          {
            field: campo,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511900000000", phone_number_id: PHONE_NUMBER_ID_SIMULADO },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function mensagemDe(waId: string, corpo: Record<string, unknown>, contextoId?: string) {
  return envelope("messages", {
    contacts: [{ profile: { name: "Simulador" }, wa_id: waId }],
    messages: [
      {
        from: waId,
        id: `wamid.SIMIN.${randomUUID()}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...(contextoId ? { context: { from: "5511900000000", id: contextoId } } : {}),
        ...corpo,
      },
    ],
  });
}

export const webhookSimulado = {
  texto: (waId: string, texto: string) => mensagemDe(waId, { type: "text", text: { body: texto } }),
  botao: (waId: string, id: string, titulo: string, contextoId?: string) =>
    mensagemDe(
      waId,
      { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: titulo } } },
      contextoId,
    ),
  respostaTemplate: (waId: string, payload: string, texto: string, contextoId?: string) =>
    mensagemDe(waId, { type: "button", button: { payload, text: texto } }, contextoId),
  flow: (waId: string, resposta: Record<string, unknown>, contextoId?: string) =>
    mensagemDe(
      waId,
      {
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify(resposta) },
        },
      },
      contextoId,
    ),
  imagem: (waId: string, mediaId: string, mimeType: string, legenda?: string) =>
    mensagemDe(waId, {
      type: "image",
      image: { id: mediaId, mime_type: mimeType, ...(legenda ? { caption: legenda } : {}) },
    }),
  audio: (waId: string, mediaId: string, mimeType: string) =>
    mensagemDe(waId, { type: "audio", audio: { id: mediaId, mime_type: mimeType, voice: true } }),
  status: (wamid: string, status: string, waId: string, categoria?: string) =>
    envelope("messages", {
      statuses: [
        {
          id: wamid,
          status,
          timestamp: String(Math.floor(Date.now() / 1000)),
          recipient_id: waId,
          ...(categoria
            ? { pricing: { billable: true, pricing_model: "PMP", type: "regular", category: categoria } }
            : {}),
        },
      ],
    }),
};

/** POST assinado no webhook real. */
export async function postarWebhook(url: string, appSecret: string, corpo: unknown): Promise<number> {
  const texto = JSON.stringify(corpo);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinarCorpo(texto, appSecret) },
    body: texto,
  });
  return r.status;
}

export interface RespostaFlowSimulada<T = unknown> {
  status: number;
  corpo: T | null;
  erroBruto?: string;
}

/** Faz o papel do app do WhatsApp chamando o endpoint do Flow (cifra, assina, decifra). */
export async function chamarEndpointFlow<T = unknown>(
  url: string,
  chavePublicaPem: string,
  appSecret: string,
  corpo: Record<string, unknown>,
): Promise<RespostaFlowSimulada<T>> {
  const { pedido, chaveAes, iv } = cifrarPedidoComoMeta(corpo, chavePublicaPem);
  const texto = JSON.stringify(pedido);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinarCorpo(texto, appSecret) },
    body: texto,
  });
  const resposta = await r.text();
  if (r.status !== 200) return { status: r.status, corpo: null, erroBruto: resposta };
  return { status: 200, corpo: decifrarRespostaComoMeta<T>(resposta, chaveAes, iv) };
}

// ─────────────────────────── Caixa do simulador (Redis) ───────────────────────────

export async function listarConversasSimuladas(redis: Redis): Promise<string[]> {
  return (await redis.smembers(CHAVES_SIMULADOR.conversas)).sort();
}

export async function lerCaixaSimulada(redis: Redis, waId: string): Promise<ItemCaixaSimulada[]> {
  const itens = await redis.lrange(CHAVES_SIMULADOR.caixa(waId.replace(/\D/g, "")), 0, -1);
  return itens.map((i) => JSON.parse(i) as ItemCaixaSimulada);
}

/** Registra na caixa o que o "celular" mandou, para a conversa aparecer completa. */
export async function registrarEntradaSimulada(redis: Redis, waId: string, tipo: string, texto: string) {
  const digitos = waId.replace(/\D/g, "");
  const item: ItemCaixaSimulada = {
    id: `in.${randomUUID()}`,
    direcao: "entrada",
    criadoEm: new Date().toISOString(),
    entrada: { tipo, texto },
  };
  await redis
    .multi()
    .rpush(CHAVES_SIMULADOR.caixa(digitos), JSON.stringify(item))
    .sadd(CHAVES_SIMULADOR.conversas, digitos)
    .exec();
}

export async function limparCaixaSimulada(redis: Redis, waId: string) {
  await redis.del(CHAVES_SIMULADOR.caixa(waId.replace(/\D/g, "")));
}

/** Guarda uma mídia "enviada pelo celular" para o ClienteSimulado.baixarMidia achar. */
export async function guardarMidiaSimulada(
  redis: Redis,
  dados: Uint8Array,
  mimeType: string,
): Promise<string> {
  const id = `simmedia-${randomUUID()}`;
  await redis.set(
    CHAVES_SIMULADOR.midia(id),
    JSON.stringify({ mimeType, base64: Buffer.from(dados).toString("base64") }),
    "EX",
    7 * 24 * 3600,
  );
  return id;
}

/** "CDN" do simulador: guarda o arquivo cifrado do PhotoPicker por 20 dias, como a Meta. */
export async function guardarArquivoCdnSimulado(redis: Redis, arquivo: Uint8Array): Promise<string> {
  const id = randomUUID();
  await redis.set(`sim:wa:cdn:${id}`, Buffer.from(arquivo).toString("base64"), "EX", 20 * 24 * 3600);
  return id;
}

export async function lerArquivoCdnSimulado(redis: Redis, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const b64 = await redis.get(`sim:wa:cdn:${id}`);
  return b64 ? Buffer.from(b64, "base64") : null;
}
