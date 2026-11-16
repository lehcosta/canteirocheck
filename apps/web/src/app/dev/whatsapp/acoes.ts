"use server";

import type { NomeFlow } from "@canteirocheck/whatsapp/flows";
import {
  chamarEndpointFlow,
  guardarArquivoCdnSimulado,
  guardarMidiaSimulada,
  lerCaixaSimulada,
  limparCaixaSimulada,
  postarWebhook,
  registrarEntradaSimulada,
  webhookSimulado,
} from "@canteirocheck/whatsapp/simulador";
import { cifrarMidiaComoMeta } from "@canteirocheck/whatsapp/transporte";
import { notFound } from "next/navigation";
import { ambienteDoSimulador, simuladorLigado } from "@/lib/simulador";

/**
 * Ações do simulador = o que o app do WhatsApp faria. Só transporte: tudo passa pelo webhook e
 * pelo endpoint de Flow reais, assinados e cifrados.
 */

function ambiente() {
  if (!simuladorLigado()) notFound();
  return ambienteDoSimulador();
}

const digitos = (tel: string) => tel.replace(/\D/g, "");

export async function enviarTexto(tel: string, texto: string) {
  const a = ambiente();
  if (!texto.trim()) return;
  await registrarEntradaSimulada(a.redis, tel, "texto", texto);
  return postarWebhook(a.urlWebhook, a.appSecret, webhookSimulado.texto(digitos(tel), texto));
}

export async function tocarBotao(tel: string, id: string, titulo: string, wamid: string) {
  const a = ambiente();
  await registrarEntradaSimulada(a.redis, tel, "botao", titulo);
  return postarWebhook(a.urlWebhook, a.appSecret, webhookSimulado.botao(digitos(tel), id, titulo, wamid));
}

export async function tocarRespostaTemplate(tel: string, payload: string, texto: string, wamid: string) {
  const a = ambiente();
  await registrarEntradaSimulada(a.redis, tel, "botao", texto);
  return postarWebhook(
    a.urlWebhook,
    a.appSecret,
    webhookSimulado.respostaTemplate(digitos(tel), payload, texto, wamid),
  );
}

export async function enviarFoto(tel: string, form: FormData) {
  const a = ambiente();
  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) return;
  const id = await guardarMidiaSimulada(
    a.redis,
    new Uint8Array(await arquivo.arrayBuffer()),
    arquivo.type || "image/jpeg",
  );
  await registrarEntradaSimulada(a.redis, tel, "imagem", `📷 ${arquivo.name}`);
  return postarWebhook(
    a.urlWebhook,
    a.appSecret,
    webhookSimulado.imagem(digitos(tel), id, arquivo.type || "image/jpeg"),
  );
}

/** Chamada ao endpoint do Flow como o app do WhatsApp faz (cifrada e assinada). */
export async function chamarFlow(
  token: string,
  action: string,
  screen?: string,
  data?: Record<string, unknown>,
) {
  const a = ambiente();
  return chamarEndpointFlow<{ screen?: string; data?: Record<string, unknown> }>(
    a.urlFlow,
    a.chavePublica,
    a.appSecret,
    {
      version: "3.0",
      action,
      flow_token: token,
      ...(screen ? { screen } : {}),
      ...(data ? { data } : {}),
    },
  );
}

/** PhotoPicker: cifra a foto como o CDN do WhatsApp e devolve o objeto que o endpoint recebe. */
export async function subirFotoDoFlow(form: FormData) {
  const a = ambiente();
  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) return null;
  const { arquivoCdn, meta } = cifrarMidiaComoMeta(new Uint8Array(await arquivo.arrayBuffer()));
  const id = await guardarArquivoCdnSimulado(a.redis, arquivoCdn);
  return {
    media_id: id,
    cdn_url: a.urlCdn(id),
    file_name: arquivo.name || "foto.jpg",
    encryption_metadata: meta,
  };
}

/** Fim do Flow: a Meta manda o nfm_reply para o webhook com os params do SUCCESS. */
export async function concluirFlow(
  tel: string,
  nome: NomeFlow,
  params: Record<string, unknown>,
  wamid: string,
) {
  const a = ambiente();
  await registrarEntradaSimulada(a.redis, tel, "flow", `Formulário enviado (${nome})`);
  return postarWebhook(a.urlWebhook, a.appSecret, webhookSimulado.flow(digitos(tel), params, wamid));
}

/** Confirma a entrega das mensagens novas (status delivered com pricing, como a Meta). */
export async function confirmarEntregas(tel: string) {
  const a = ambiente();
  const chave = `sim:wa:entregues:${digitos(tel)}`;
  const itens = await lerCaixaSimulada(a.redis, tel);
  for (const i of itens) {
    if (i.direcao !== "saida" || (await a.redis.sismember(chave, i.id))) continue;
    await a.redis.sadd(chave, i.id);
    // Só template é cobrado no simulador; mensagens de serviço ficam na cota grátis do mês.
    const categoria = i.mensagem?.tipo === "template" ? "utility" : undefined;
    await postarWebhook(
      a.urlWebhook,
      a.appSecret,
      webhookSimulado.status(i.id, "delivered", digitos(tel), categoria),
    );
  }
}

export async function limparConversa(tel: string) {
  const a = ambiente();
  await limparCaixaSimulada(a.redis, tel);
}
