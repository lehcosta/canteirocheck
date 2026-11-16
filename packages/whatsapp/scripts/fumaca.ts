/**
 * Teste de fumaça do sistema RODANDO (pnpm dev): faz o papel do celular do João e da Ana no modo
 * simulado e percorre o cenário L3/L4 pelo webhook e pelo endpoint do Flow reais, com o worker
 * respondendo pela fila. Uso: pnpm --filter @canteirocheck/whatsapp fumaca
 */
import { setTimeout as esperar } from "node:timers/promises";
import { Redis } from "ioredis";
import sharp from "sharp";
import { configWhatsapp } from "../src/config";
import type { MensagemSaida } from "../src/mensagens";
import {
  chamarEndpointFlow,
  lerCaixaSimulada,
  limparCaixaSimulada,
  postarWebhook,
  webhookSimulado,
} from "../src/simulador";
import { chavePublicaPem, cifrarMidiaComoMeta } from "../src/transporte";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const cfg = configWhatsapp();
const redis = new Redis(process.env.REDIS_URL ?? "");
const PUBLICA = chavePublicaPem(cfg.chavePrivada);
const JOAO = "5511900000003";
const ANA = "5511900000002";

async function webhook(corpo: unknown) {
  const s = await postarWebhook(`${BASE}/api/whatsapp/webhook`, cfg.WHATSAPP_APP_SECRET, corpo);
  if (s !== 200) throw new Error(`webhook ${s}`);
}

async function proxima(tel: string, depoisDe: number, tipo?: MensagemSaida["tipo"]) {
  for (let i = 0; i < 60; i++) {
    const itens = (await lerCaixaSimulada(redis, tel)).filter((x) => x.direcao === "saida");
    const novo = itens.slice(depoisDe).find((x) => !tipo || x.mensagem?.tipo === tipo);
    if (novo?.mensagem) return { ...novo, mensagem: novo.mensagem, total: itens.length };
    await esperar(250);
  }
  throw new Error(`nada chegou para ${tel} (${tipo ?? "qualquer"})`);
}

const contar = async (tel: string) =>
  (await lerCaixaSimulada(redis, tel)).filter((x) => x.direcao === "saida").length;

async function flow(token: string, action: string, screen?: string, data?: Record<string, unknown>) {
  const r = await chamarEndpointFlow<{ screen: string; data: Record<string, unknown> }>(
    `${BASE}/api/whatsapp/flow`,
    PUBLICA,
    cfg.WHATSAPP_APP_SECRET,
    { version: "3.0", action, flow_token: token, ...(screen ? { screen } : {}), ...(data ? { data } : {}) },
  );
  if (r.status !== 200 || !r.corpo) throw new Error(`flow ${r.status} ${r.erroBruto}`);
  return r.corpo;
}

function passo(nome: string) {
  console.log(`✔ ${nome}`);
}

async function foto() {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#8a8a8a" } })
    .jpeg()
    .toBuffer();
  const { arquivoCdn, meta } = cifrarMidiaComoMeta(jpeg);
  const id = crypto.randomUUID();
  await redis.set(`sim:wa:cdn:${id}`, arquivoCdn.toString("base64"), "EX", 3600);
  return [
    {
      media_id: id,
      cdn_url: `${BASE}/dev/whatsapp/cdn/${id}`,
      file_name: "forma.jpg",
      encryption_metadata: meta,
    },
  ];
}

await limparCaixaSimulada(redis, JOAO);
await limparCaixaSimulada(redis, ANA);

let n = await contar(JOAO);
await webhook(webhookSimulado.texto(JOAO, "boa tarde"));
let m = await proxima(JOAO, n, "botoes");
passo("João manda 'boa tarde' → menu com botões");

n = m.total;
await webhook(webhookSimulado.botao(JOAO, "menu:anunciar", "Anunciar execução", m.id));
m = await proxima(JOAO, n, "flow");
if (m.mensagem.tipo !== "flow") throw new Error();
let token = m.mensagem.flowToken;
const anuncio = await flow(token, "INIT");
const etapa = (anuncio.data.etapas as { id: string; title: string }[]).find((e) => e.title === "Concretagem");
const l4 = (anuncio.data.locais as { id: string; title: string }[]).find((l) => l.title === "L4");
n = m.total;
const fimAnuncio = await flow(token, "data_exchange", "ANUNCIO", {
  acao: "anunciar",
  etapa: etapa?.id,
  locais: [l4?.id],
  quando: "amanha",
});
if (fimAnuncio.screen !== "SUCCESS") throw new Error(JSON.stringify(fimAnuncio));
m = await proxima(JOAO, n, "botoes");
if (m.mensagem.tipo !== "botoes") throw new Error();
const conferir = m.mensagem.botoes[0];
if (!conferir) throw new Error("sem botão conferir");
passo(`Anúncio pelo Flow → "${m.mensagem.texto.split("\n")[1]}"`);

n = m.total;
await webhook(webhookSimulado.botao(JOAO, conferir.id, conferir.titulo, m.id));
m = await proxima(JOAO, n, "flow");
if (m.mensagem.tipo !== "flow") throw new Error();
token = m.mensagem.flowToken;
await flow(token, "INIT");
let r = await flow(token, "data_exchange", "INICIO", { acao: "comecar" });
const interfaceL4 = { acao: "medir", referencia: "6,000", novo: "6,040", mesma_rn: "sim" };
r = await flow(token, "data_exchange", r.screen, { ...interfaceL4, foto: await foto() });
passo(`Interface 6,040 (1ª) → ${r.screen}: ${r.data.aviso}`);
r = await flow(token, "data_exchange", r.screen, { ...interfaceL4, foto: await foto() });
passo(`Interface 6,040 (2ª) → ${r.screen}: ${r.data.falha}`);
r = await flow(token, "data_exchange", r.screen, {
  acao: "causa",
  causa: "forma_fora_do_nivel",
  detalhe: "",
  foto: await foto(),
});
r = await flow(token, "data_exchange", r.screen, { acao: "medir", medida: "6,005" });
r = await flow(token, "data_exchange", r.screen, { acao: "medir", medida: "6,000" });
passo(`Resumo: ${String(r.data.status)}`);
const nAna = await contar(ANA);
n = await contar(JOAO);
const fim = await flow(token, "data_exchange", "RESUMO", { acao: "concluir" });
if (fim.screen !== "SUCCESS") throw new Error(JSON.stringify(fim));
await webhook(
  webhookSimulado.flow(
    JOAO,
    (fim.data.extension_message_response as { params: object }).params as Record<string, unknown>,
  ),
);
m = await proxima(JOAO, n, "texto");
passo(`João recebe: ${m.mensagem.tipo === "texto" ? m.mensagem.texto : ""}`);

let a = await proxima(ANA, nAna);
passo(
  `Ana recebe ${a.mensagem.tipo}${a.mensagem.tipo === "template" ? ` (${a.mensagem.nome}, janela fechada)` : ""}`,
);
if (a.mensagem.tipo === "template") {
  // a Meta confirma a entrega com o preço (utility) → evento de custo da obra
  await webhook(webhookSimulado.status(a.id, "delivered", ANA, "utility"));
  const total = a.total;
  await webhook(webhookSimulado.respostaTemplate(ANA, "ver", "Ver", a.id));
  a = await proxima(ANA, total, "botoes");
}
if (a.mensagem.tipo !== "botoes") throw new Error("resumo sem botões");
passo(`Resumo para a Ana: ${a.mensagem.texto.split("\n")[0]}`);
const recusar = a.mensagem.botoes.find((b) => b.titulo === "Recusar");
if (!recusar) throw new Error("sem Recusar");
const total = a.total;
await webhook(webhookSimulado.botao(ANA, recusar.id, "Recusar", a.id));
a = await proxima(ANA, total, "flow");
if (a.mensagem.tipo !== "flow") throw new Error();
await flow(a.mensagem.flowToken, "INIT");
n = await contar(JOAO);
const just = await flow(a.mensagem.flowToken, "data_exchange", "JUSTIFICAR", {
  acao: "justificar",
  justificativa: "Forma 4 cm acima da borda da L3. Ajustar forma e reenviar conferência.",
});
if (just.screen !== "SUCCESS") throw new Error(JSON.stringify(just));
m = await proxima(JOAO, n, "botoes");
passo(`João recebe: ${m.mensagem.tipo === "botoes" ? m.mensagem.texto.split("\n").join(" / ") : ""}`);

await esperar(1500); // tempo para o worker baixar e guardar as fotos
console.log("\nFumaça OK: anúncio → checklist → bloqueio → alerta → recusa → aviso ao encarregado.");
await redis.quit();
