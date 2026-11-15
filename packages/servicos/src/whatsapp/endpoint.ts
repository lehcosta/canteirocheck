import { registrarEntradaWhatsapp } from "@canteirocheck/db";
import { idJob, obterFila } from "@canteirocheck/queue";
import { configWhatsapp, lerWebhook } from "@canteirocheck/whatsapp";
import {
  assinaturaValida,
  cifrarResposta,
  decifrarPedido,
  type PedidoCifrado,
} from "@canteirocheck/whatsapp/transporte";
import { type PedidoFlow, tratarPedidoFlow } from "./flow";
import { registrarStatus } from "./status";

/**
 * Camada HTTP dos route handlers, sem Next: corpo CRU + cabeçalho de assinatura → resposta.
 * Os testes de integração passam por aqui, com a mesma criptografia da Meta.
 */

export interface RespostaHttp {
  status: number;
  corpo: string;
  tipo: "text/plain" | "application/json";
}

const json = (status: number, corpo: unknown): RespostaHttp => ({
  status,
  corpo: JSON.stringify(corpo),
  tipo: "application/json",
});

/** GET de verificação do webhook (hub.challenge). */
export function verificarWebhook(params: URLSearchParams): RespostaHttp {
  const cfg = configWhatsapp();
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === cfg.WHATSAPP_VERIFY_TOKEN
  ) {
    return { status: 200, corpo: params.get("hub.challenge") ?? "", tipo: "text/plain" };
  }
  return { status: 403, corpo: "", tipo: "text/plain" };
}

/**
 * POST do webhook: assinatura → grava cada mensagem (idempotente por wamid) → enfileira o
 * processamento → 200. Status de entrega atualizam a mensagem de saída e o custo.
 */
export async function receberWebhook(corpo: string, assinatura: string | null): Promise<RespostaHttp> {
  const cfg = configWhatsapp();
  if (!assinaturaValida(corpo, assinatura, cfg.WHATSAPP_APP_SECRET))
    return json(401, { erro: "assinatura inválida" });
  let lido: ReturnType<typeof lerWebhook>;
  try {
    lido = lerWebhook(JSON.parse(corpo));
  } catch {
    return json(400, { erro: "corpo inválido" });
  }
  const fila = obterFila();
  for (const m of lido.mensagens) {
    if (!m.waId) continue; // usuário só com BSUID (sem telefone): ainda não identificamos
    const r = await registrarEntradaWhatsapp({
      waMessageId: m.waMessageId,
      waId: m.waId,
      tipo: m.tipo,
      payload: { conteudo: m.conteudo, bruto: m.bruto },
    });
    // Mesmo duplicada: o jobId deduplica no BullMQ e cobre a falha entre gravar e enfileirar.
    await fila.enfileirar(
      "processar_mensagem",
      { tenantId: r.tenantId, mensagemId: r.mensagemId },
      { jobId: idJob("in", r.mensagemId) },
    );
  }
  for (const s of lido.status) await registrarStatus(s);
  return json(200, { ok: true });
}

/** POST do endpoint de Flows: 432 assinatura, 421 não decifra, 427 token inválido, 200 cifrado. */
export async function receberPedidoFlow(corpo: string, assinatura: string | null): Promise<RespostaHttp> {
  const cfg = configWhatsapp();
  if (!assinaturaValida(corpo, assinatura, cfg.WHATSAPP_APP_SECRET))
    return json(432, { erro: "assinatura inválida" });
  let decifrado: ReturnType<typeof decifrarPedido<PedidoFlow>>;
  try {
    decifrado = decifrarPedido<PedidoFlow>(JSON.parse(corpo) as PedidoCifrado, cfg.chavePrivada);
  } catch {
    return json(421, { erro: "não foi possível decifrar" });
  }
  const r = await tratarPedidoFlow(decifrado.corpo);
  if (r.status === 427) return json(427, r.corpo);
  return {
    status: 200,
    corpo: cifrarResposta(r.corpo, decifrado.chaveAes, decifrado.iv),
    tipo: "text/plain",
  };
}
