import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Saída estruturada de LLM atrás de uma interface: o domínio não conhece o SDK, e os testes usam
 * `LlmFalso`. Toda saída é validada pelo schema zod (prompt §8): falha de schema → 1 nova
 * tentativa → o chamador marca para revisão humana.
 */

export type Esforco = "low" | "medium" | "high";

export interface TarefaEstruturada<T> {
  /** Identifica a tarefa e a versão do prompt, ex.: "pendencias-v1". Vai para o registro de custo. */
  nome: string;
  modelo: string;
  esforco: Esforco;
  sistema: string;
  usuario: string;
  esquema: z.ZodType<T>;
  maxTokens: number;
}

export interface UsoLlm {
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  /** Estimativa em USD (string decimal) pela tabela de preços abaixo. */
  custoUsd: string;
}

export type ResultadoLlm<T> =
  | { ok: true; saida: T; uso: UsoLlm }
  | { ok: false; motivo: "recusa" | "schema" | "truncado" | "erro"; detalhe: string; uso: UsoLlm | null };

export interface Llm {
  readonly nome: string;
  estruturado<T>(tarefa: TarefaEstruturada<T>): Promise<ResultadoLlm<T>>;
}

// ─────────────────────────── Preços (USD por milhão de tokens) ───────────────────────────

/**
 * Preços da API da Anthropic conferidos em 15/11/2026. Mudam: sobrescreva com
 * IA_PRECOS_USD='{"claude-opus-5-5":{"entrada":4,...}}'. Escrita de cache (5 min) = 1,25 × entrada.
 */
const PRECOS: Record<string, { entrada: number; saida: number; cacheLeitura: number }> = {
  "claude-opus-5-5": { entrada: 4, saida: 20, cacheLeitura: 0.2 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cacheLeitura: 0.2 },
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01 },
};

function precoDe(modelo: string) {
  try {
    const extra = JSON.parse(process.env.IA_PRECOS_USD ?? "{}") as typeof PRECOS;
    return extra[modelo] ?? PRECOS[modelo] ?? null;
  } catch {
    return PRECOS[modelo] ?? null;
  }
}

export function custoEstimado(u: Omit<UsoLlm, "custoUsd">): string {
  const p = precoDe(u.modelo);
  if (!p) return "0";
  const total =
    (u.entrada * p.entrada +
      u.saida * p.saida +
      u.cacheLeitura * p.cacheLeitura +
      u.cacheEscrita * p.entrada * 1.25) /
    1_000_000;
  return total.toFixed(6);
}

// ─────────────────────────── Claude ───────────────────────────

/** Modelos com fallback no servidor em caso de recusa (o Haiku não tem). */
const COM_FALLBACK = /^claude-(opus|sonnet|fable)-/;

export class LlmClaude implements Llm {
  readonly nome = "claude";
  private readonly cliente: Anthropic;

  constructor(cliente?: Anthropic) {
    // Credenciais do ambiente: ANTHROPIC_API_KEY (ou perfil do `ant auth login`).
    this.cliente = cliente ?? new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  }

  async estruturado<T>(t: TarefaEstruturada<T>): Promise<ResultadoLlm<T>> {
    const fallback = COM_FALLBACK.test(t.modelo);
    let resposta: Awaited<ReturnType<typeof this.cliente.beta.messages.parse>>;
    try {
      resposta = await this.cliente.beta.messages.parse({
        model: t.modelo,
        max_tokens: t.maxTokens,
        // O prompt de sistema é estável por versão → cacheável entre projetos.
        system: [{ type: "text", text: t.sistema, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: t.usuario }],
        output_config: { effort: t.esforco, format: betaZodOutputFormat(t.esquema) },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError && e.status !== undefined && e.status < 500 && e.status !== 429) {
        return { ok: false, motivo: "erro", detalhe: `${e.status}: ${e.message}`, uso: null };
      }
      throw e; // 429/5xx/rede: o job tenta de novo
    }
    const u = resposta.usage;
    const base = {
      modelo: resposta.model,
      entrada: u.input_tokens,
      saida: u.output_tokens,
      cacheLeitura: u.cache_read_input_tokens ?? 0,
      cacheEscrita: u.cache_creation_input_tokens ?? 0,
    };
    const uso: UsoLlm = { ...base, custoUsd: custoEstimado(base) };

    if (resposta.stop_reason === "refusal") {
      return { ok: false, motivo: "recusa", detalhe: resposta.stop_details?.explanation ?? "recusa", uso };
    }
    if (resposta.stop_reason === "max_tokens") {
      return { ok: false, motivo: "truncado", detalhe: `saída passou de ${t.maxTokens} tokens`, uso };
    }
    const saida = resposta.parsed_output;
    if (saida === null || saida === undefined)
      return { ok: false, motivo: "schema", detalhe: "saída fora do schema", uso };
    // Revalida no nosso schema (o SDK remove restrições que a API não aceita e confere no cliente).
    const r = t.esquema.safeParse(saida);
    if (!r.success) return { ok: false, motivo: "schema", detalhe: r.error.message, uso };
    return { ok: true, saida: r.data, uso };
  }
}

// ─────────────────────────── Falso (testes e ambiente sem chave) ───────────────────────────

type Roteiro = (t: TarefaEstruturada<unknown>) => unknown;

/** Responde por nome de tarefa. Passa pelo mesmo schema zod que a resposta real. */
export class LlmFalso implements Llm {
  readonly nome = "falso";
  readonly chamadas: TarefaEstruturada<unknown>[] = [];

  constructor(private readonly roteiros: Record<string, Roteiro | Roteiro[]>) {}

  async estruturado<T>(t: TarefaEstruturada<T>): Promise<ResultadoLlm<T>> {
    this.chamadas.push(t as TarefaEstruturada<unknown>);
    const prefixo = t.nome.split("-v")[0] ?? t.nome;
    const r = this.roteiros[t.nome] ?? this.roteiros[prefixo];
    const fn = Array.isArray(r) ? r.shift() : r;
    const uso: UsoLlm = {
      modelo: t.modelo,
      entrada: 1000,
      saida: 200,
      cacheLeitura: 0,
      cacheEscrita: 0,
      custoUsd: "0",
    };
    if (!fn) return { ok: false, motivo: "erro", detalhe: `sem roteiro para ${t.nome}`, uso };
    const p = t.esquema.safeParse(fn(t as TarefaEstruturada<unknown>));
    return p.success
      ? { ok: true, saida: p.data, uso }
      : { ok: false, motivo: "schema", detalhe: p.error.message, uso };
  }
}

/** Uma tentativa extra quando a saída não passou no schema (prompt §8). */
export async function comNovaTentativa<T>(llm: Llm, t: TarefaEstruturada<T>) {
  const usos: UsoLlm[] = [];
  let r = await llm.estruturado(t);
  if (r.uso) usos.push(r.uso);
  if (!r.ok && (r.motivo === "schema" || r.motivo === "truncado")) {
    r = await llm.estruturado({ ...t, maxTokens: r.motivo === "truncado" ? t.maxTokens * 2 : t.maxTokens });
    if (r.uso) usos.push(r.uso);
  }
  return { resultado: r, usos };
}

declare global {
  var __canteiroLlm: Llm | undefined;
}

/** LLM do processo: Claude se houver credencial; senão null (o chamador marca revisão humana). */
export function llmPadrao(): Llm | null {
  if (globalThis.__canteiroLlm) return globalThis.__canteiroLlm;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  globalThis.__canteiroLlm = new LlmClaude();
  return globalThis.__canteiroLlm;
}

export function definirLlm(llm: Llm | undefined) {
  globalThis.__canteiroLlm = llm;
}
