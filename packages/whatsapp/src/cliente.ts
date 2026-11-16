import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { type ConfigWhatsapp, configWhatsapp } from "./config";
import { type MensagemSaida, paraGraph } from "./mensagens";

export interface ClienteWhatsapp {
  readonly modo: "cloud" | "simulado";
  /** `destino`: wa_id/telefone só com dígitos. Devolve o wamid aceito pela API. */
  enviar(destino: string, mensagem: MensagemSaida): Promise<{ waMessageId: string }>;
  /** Mídia recebida no chat (media id do webhook). */
  baixarMidia(mediaId: string): Promise<{ dados: Uint8Array; mimeType: string }>;
  /** Arquivo cifrado do CDN do Flow (PhotoPicker). */
  baixarCdn(url: string): Promise<Uint8Array>;
}

/** Erro da Graph API. `definitivo` = não adianta tentar de novo (número inválido, template inexistente…). */
export class ErroGraph extends Error {
  constructor(
    readonly status: number,
    readonly codigo: number | null,
    readonly corpo: unknown,
  ) {
    super(`Graph API ${status}${codigo ? ` (código ${codigo})` : ""}`);
    this.name = "ErroGraph";
  }

  get definitivo() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

const TAMANHO_MAXIMO_MIDIA = 25 * 1024 * 1024;

async function lerComLimite(r: Response): Promise<Uint8Array> {
  const tamanho = Number(r.headers.get("content-length") ?? 0);
  if (tamanho > TAMANHO_MAXIMO_MIDIA) throw new Error(`mídia grande demais: ${tamanho} bytes`);
  const dados = new Uint8Array(await r.arrayBuffer());
  if (dados.length > TAMANHO_MAXIMO_MIDIA) throw new Error(`mídia grande demais: ${dados.length} bytes`);
  return dados;
}

/**
 * Flows na Meta: em DRAFT só abrem com mode "draft" (WHATSAPP_FLOWS_RASCUNHO=1), e o envio pode ir
 * por id (WHATSAPP_FLOW_IDS='{"canteiro_checklist_v1":"123",...}', impresso pelo `publicar`).
 */
function ajustarFlow(m: MensagemSaida): MensagemSaida {
  if (m.tipo !== "flow") return m;
  let ids: Record<string, string> = {};
  try {
    ids = JSON.parse(process.env.WHATSAPP_FLOW_IDS ?? "{}") as Record<string, string>;
  } catch {
    ids = {};
  }
  const flowId = ids[m.flowNome];
  return {
    ...m,
    ...(flowId ? { flowId } : {}),
    ...(process.env.WHATSAPP_FLOWS_RASCUNHO === "1" ? { rascunho: true } : {}),
  };
}

export class ClienteCloud implements ClienteWhatsapp {
  readonly modo = "cloud" as const;

  constructor(private readonly cfg: Extract<ConfigWhatsapp, { WHATSAPP_MODO: "cloud" }>) {}

  private url(caminho: string) {
    return `https://graph.facebook.com/${this.cfg.WHATSAPP_GRAPH_VERSION}/${caminho}`;
  }

  private async graph(caminho: string, init: RequestInit = {}) {
    const r = await fetch(this.url(caminho), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const corpo = (await r.json().catch(() => null)) as { error?: { code?: number } } | null;
    if (!r.ok) throw new ErroGraph(r.status, corpo?.error?.code ?? null, corpo);
    return corpo;
  }

  async enviar(destino: string, mensagem: MensagemSaida) {
    const corpo = (await this.graph(`${this.cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(paraGraph(destino, ajustarFlow(mensagem))),
    })) as { messages?: { id: string }[] };
    const id = corpo?.messages?.[0]?.id;
    if (!id) throw new ErroGraph(200, null, corpo);
    return { waMessageId: id };
  }

  async baixarMidia(mediaId: string) {
    const info = (await this.graph(encodeURIComponent(mediaId))) as { url: string; mime_type: string };
    // A URL expira em 5 min e exige o token.
    const r = await fetch(info.url, {
      headers: { Authorization: `Bearer ${this.cfg.WHATSAPP_TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new ErroGraph(r.status, null, null);
    return { dados: await lerComLimite(r), mimeType: info.mime_type };
  }

  async baixarCdn(url: string) {
    if (!/^https:\/\//.test(url)) throw new Error("URL de CDN inválida");
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`CDN respondeu ${r.status}`);
    return lerComLimite(r);
  }
}

// ─────────────────────────── Simulado ───────────────────────────

export const CHAVES_SIMULADOR = {
  caixa: (digitos: string) => `sim:wa:caixa:${digitos}`,
  conversas: "sim:wa:conversas",
  midia: (id: string) => `sim:wa:midia:${id}`,
};

export interface ItemCaixaSimulada {
  id: string;
  direcao: "saida" | "entrada";
  criadoEm: string;
  mensagem?: MensagemSaida; // saída
  entrada?: { tipo: string; texto: string }; // o que o "celular" mandou
}

export class ClienteSimulado implements ClienteWhatsapp {
  readonly modo = "simulado" as const;

  constructor(private readonly redis: Redis) {}

  async enviar(destino: string, mensagem: MensagemSaida) {
    paraGraph(destino, mensagem); // mesma validação de limites do modo cloud
    const digitos = destino.replace(/\D/g, "");
    const item: ItemCaixaSimulada = {
      id: `wamid.SIM.${randomUUID()}`,
      direcao: "saida",
      criadoEm: new Date().toISOString(),
      mensagem,
    };
    await this.redis
      .multi()
      .rpush(CHAVES_SIMULADOR.caixa(digitos), JSON.stringify(item))
      .sadd(CHAVES_SIMULADOR.conversas, digitos)
      .exec();
    return { waMessageId: item.id };
  }

  async baixarMidia(mediaId: string) {
    const salvo = await this.redis.get(CHAVES_SIMULADOR.midia(mediaId));
    if (!salvo) throw new ErroGraph(404, null, { erro: "mídia simulada não encontrada" });
    const { mimeType, base64 } = JSON.parse(salvo) as { mimeType: string; base64: string };
    return { dados: Buffer.from(base64, "base64"), mimeType };
  }

  async baixarCdn(url: string) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`CDN simulado respondeu ${r.status}`);
    return lerComLimite(r);
  }
}

declare global {
  var __canteiroClienteWhatsapp: ClienteWhatsapp | undefined;
  var __canteiroRedisSimulador: Redis | undefined;
}

export function redisDoSimulador(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error("REDIS_URL não definida");
  globalThis.__canteiroRedisSimulador ??= new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  return globalThis.__canteiroRedisSimulador;
}

export function clienteWhatsapp(): ClienteWhatsapp {
  if (!globalThis.__canteiroClienteWhatsapp) {
    const cfg = configWhatsapp();
    globalThis.__canteiroClienteWhatsapp =
      cfg.WHATSAPP_MODO === "cloud"
        ? new ClienteCloud(cfg)
        : new ClienteSimulado(redisDoSimulador(cfg.REDIS_URL));
  }
  return globalThis.__canteiroClienteWhatsapp;
}

export function definirClienteWhatsapp(c: ClienteWhatsapp | undefined) {
  globalThis.__canteiroClienteWhatsapp = c;
}

export async function encerrarClienteWhatsapp() {
  globalThis.__canteiroClienteWhatsapp = undefined;
  await globalThis.__canteiroRedisSimulador?.quit().catch(() => undefined);
  globalThis.__canteiroRedisSimulador = undefined;
}
