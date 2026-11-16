import { type ConnectionOptions, type Job, Queue, Worker } from "bullmq";
import {
  FILAS,
  JOBS,
  type NomeFila,
  type NomeJob,
  type OpcoesJob,
  type PayloadJob,
  validarPayload,
} from "./jobs";

/** Produtor de jobs. Web e servicos só conhecem esta interface. */
export interface Fila {
  enfileirar<N extends NomeJob>(nome: N, payload: PayloadJob<N>, opcoes?: OpcoesJob): Promise<void>;
}

export interface JobRegistrado<N extends NomeJob = NomeJob> {
  nome: N;
  payload: PayloadJob<N>;
  opcoes: OpcoesJob;
}

/** Para testes: guarda os jobs em memória (com a mesma validação e a mesma deduplicação por jobId). */
export class FilaEmMemoria implements Fila {
  readonly jobs: JobRegistrado[] = [];

  async enfileirar<N extends NomeJob>(nome: N, payload: PayloadJob<N>, opcoes: OpcoesJob = {}) {
    const validado = validarPayload(nome, payload);
    if (opcoes.jobId && this.jobs.some((j) => j.nome === nome && j.opcoes.jobId === opcoes.jobId)) return;
    this.jobs.push({ nome, payload: validado, opcoes } as JobRegistrado);
  }

  doTipo<N extends NomeJob>(nome: N): PayloadJob<N>[] {
    return this.jobs.filter((j) => j.nome === nome).map((j) => j.payload as PayloadJob<N>);
  }

  limpar() {
    this.jobs.length = 0;
  }
}

export function conexaoRedis(url = process.env.REDIS_URL): ConnectionOptions {
  if (!url) throw new Error("REDIS_URL não definida");
  // maxRetriesPerRequest: null é exigido pelos Workers do BullMQ (comandos bloqueantes).
  return { url, maxRetriesPerRequest: null };
}

/** Prefixo das chaves no Redis. Testes usam um prefixo próprio por rodada. */
export function prefixoFilas() {
  return process.env.QUEUE_PREFIX ?? "canteiro";
}

const OPCOES_PADRAO = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
} as const;

export class FilaBullMQ implements Fila {
  private readonly filas = new Map<NomeFila, Queue>();

  constructor(
    private readonly conexao: ConnectionOptions = conexaoRedis(),
    private readonly prefixo = prefixoFilas(),
  ) {}

  fila(nome: NomeFila): Queue {
    let f = this.filas.get(nome);
    if (!f) {
      f = new Queue(nome, {
        connection: this.conexao,
        prefix: this.prefixo,
        defaultJobOptions: OPCOES_PADRAO,
      });
      this.filas.set(nome, f);
    }
    return f;
  }

  async enfileirar<N extends NomeJob>(nome: N, payload: PayloadJob<N>, opcoes: OpcoesJob = {}) {
    const validado = validarPayload(nome, payload);
    await this.fila(JOBS[nome].fila).add(nome, validado, {
      ...(opcoes.jobId ? { jobId: opcoes.jobId } : {}),
      ...(opcoes.atrasoMs ? { delay: opcoes.atrasoMs } : {}),
    });
  }

  async fechar() {
    await Promise.all([...this.filas.values()].map((f) => f.close()));
    this.filas.clear();
  }
}

// ─────────────────────────── Fila global do processo ───────────────────────────

declare global {
  var __canteiroFila: Fila | undefined;
}

/** Fila do processo: BullMQ por padrão; testes trocam por `FilaEmMemoria` com `definirFila`. */
export function obterFila(): Fila {
  globalThis.__canteiroFila ??= new FilaBullMQ();
  return globalThis.__canteiroFila;
}

export function definirFila(fila: Fila | undefined) {
  globalThis.__canteiroFila = fila;
}

export async function encerrarFila() {
  const f = globalThis.__canteiroFila;
  if (f instanceof FilaBullMQ) await f.fechar();
  globalThis.__canteiroFila = undefined;
}

// ─────────────────────────── Consumidor (worker) ───────────────────────────

export type Processadores = { [N in NomeJob]?: (payload: PayloadJob<N>, job: Job) => Promise<unknown> };

export interface OpcoesWorker {
  concorrencia?: number;
  /** Rate limit da fila (ex.: IA): no máximo `max` jobs a cada `duracaoMs`. */
  limite?: { max: number; duracaoMs: number };
}

/** Sobe um Worker do BullMQ para a fila, validando o payload de cada job com o schema do catálogo. */
export function criarWorker(fila: NomeFila, processadores: Processadores, opcoes: OpcoesWorker = {}): Worker {
  if (!FILAS.includes(fila)) throw new Error(`fila desconhecida: ${fila}`);
  return new Worker(
    fila,
    async (job) => {
      const nome = job.name as NomeJob;
      const processar = processadores[nome] as ((p: unknown, j: Job) => Promise<unknown>) | undefined;
      if (!processar || JOBS[nome]?.fila !== fila)
        throw new Error(`job sem processador: ${fila}/${job.name}`);
      return processar(validarPayload(nome, job.data), job);
    },
    {
      connection: conexaoRedis(),
      prefix: prefixoFilas(),
      concurrency: opcoes.concorrencia ?? 5,
      ...(opcoes.limite ? { limiter: { max: opcoes.limite.max, duration: opcoes.limite.duracaoMs } } : {}),
    },
  );
}
