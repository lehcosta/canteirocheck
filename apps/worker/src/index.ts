import "./env";
import { encerrarDb } from "@canteirocheck/db";
import { criarWorker, definirFila, FilaBullMQ, type NomeFila } from "@canteirocheck/queue";
import {
  anuncioDiario,
  avisarPendencia,
  baixarMidia,
  detectarPendencias,
  enviarMensagemPendente,
  gerarPontosSugeridos,
  gerarRelatorio,
  interpretarMensagem,
  notificarEncarregado,
  notificarEngenheiro,
  processarExtracao,
  processarMensagemRecebida,
  transcreverAudio,
  varrerParados,
} from "@canteirocheck/servicos";
import { garantirBucket } from "@canteirocheck/storage";
import { encerrarClienteWhatsapp } from "@canteirocheck/whatsapp";
import type { Worker } from "bullmq";
import { sincronizarAgendamentos } from "./agendamentos";
import { log } from "./log";

/**
 * Processo separado do Next: consome as filas do BullMQ. Jobs são idempotentes (jobId por
 * entidade) e têm retry com backoff exponencial (opções padrão em packages/queue).
 */

const fila = new FilaBullMQ();
definirFila(fila); // jobs disparados por jobs (ex.: aviso → envio) usam a mesma conexão

const workers: Worker[] = [];

function subir(
  nome: NomeFila,
  processadores: Parameters<typeof criarWorker>[1],
  opcoes?: Parameters<typeof criarWorker>[2],
) {
  const w = criarWorker(nome, processadores, opcoes);
  w.on("completed", (job, resultado) =>
    log("info", "job.ok", {
      fila: nome,
      job: job.name,
      id: job.id,
      ms: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
      resultado,
    }),
  );
  w.on("failed", (job, erro) =>
    log("error", "job.falhou", {
      fila: nome,
      job: job?.name,
      id: job?.id,
      tentativa: job?.attemptsMade,
      erro: erro.message,
    }),
  );
  workers.push(w);
}

subir("whatsapp-entrada", {
  processar_mensagem: (p) => processarMensagemRecebida(p.tenantId, p.mensagemId),
});
// A Cloud API tem limite de vazão por número; 20/s com folga.
subir(
  "whatsapp-saida",
  { enviar_mensagem: (p) => enviarMensagemPendente(p.tenantId, p.mensagemId) },
  {
    concorrencia: 5,
    limite: { max: 20, duracaoMs: 1000 },
  },
);
subir("midia", { baixar_midia: (p) => baixarMidia(p.tenantId, p.midiaId) }, { concorrencia: 3 });
subir("execucao", {
  notificar_engenheiro: (p) => notificarEngenheiro(p.tenantId, p.execucaoId, p.rodada),
  notificar_encarregado: (p) => notificarEncarregado(p.tenantId, p.liberacaoId),
  avisar_pendencia: (p) => avisarPendencia(p.tenantId, p.execucaoId),
});
subir("agenda", {
  anuncio_diario: (p) => anuncioDiario(p.tenantId, p.obraId),
  varredura: () => varrerParados(),
});
subir("relatorios", { gerar_pdf: (p) => gerarRelatorio(p) }, { concorrencia: 2 });
subir("dwg", { extrair_dwg: (p) => processarExtracao(p.tenantId, p.projetoId) }, { concorrencia: 2 });
// IA: sem chave, os jobs registram a falta e caem no caminho de revisão humana.
subir(
  "ia",
  {
    detectar_pendencias: (p) => detectarPendencias(p.tenantId, p.projetoId),
    gerar_pontos: (p) => gerarPontosSugeridos(p.tenantId, p.projetoId),
    transcrever_audio: (p) => transcreverAudio(p.tenantId, p.mensagemId),
    interpretar_mensagem: (p) => interpretarMensagem(p.tenantId, p.mensagemId),
  },
  { concorrencia: 2, limite: { max: 10, duracaoMs: 60_000 } },
);

await garantirBucket().catch((e) => log("warn", "s3.indisponivel", { erro: String(e) }));
await sincronizarAgendamentos(fila).catch((e) => log("error", "agenda.falhou", { erro: String(e) }));
// Varredura de itens parados (outbox): a cada 2 minutos.
await fila
  .fila("agenda")
  .upsertJobScheduler("varredura", { every: 120_000 }, { name: "varredura", data: {} })
  .catch((e) => log("error", "varredura.agendamento_falhou", { erro: String(e) }));
const relogio = setInterval(
  () => sincronizarAgendamentos(fila).catch((e) => log("error", "agenda.falhou", { erro: String(e) })),
  10 * 60 * 1000,
);

log("info", "worker.pronto", { filas: workers.map((w) => w.name) });

async function encerrar(sinal: string) {
  log("info", "worker.encerrando", { sinal });
  clearInterval(relogio);
  await Promise.all(workers.map((w) => w.close()));
  await fila.fechar();
  await encerrarClienteWhatsapp();
  await encerrarDb();
  process.exit(0);
}
process.on("SIGINT", () => void encerrar("SIGINT"));
process.on("SIGTERM", () => void encerrar("SIGTERM"));
