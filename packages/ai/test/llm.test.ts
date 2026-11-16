import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { comNovaTentativa, custoEstimado, LlmClaude, LlmFalso, tarefaPendencias, tarefaPontos } from "../src";

const tarefa = tarefaPendencias(["PISO A DEFINIR", "PORCELANATO 60x60"], {
  disciplina: "interiores",
  titulo: "Layout",
});
const valido = {
  itens: [
    {
      indice: 0,
      eh_pendencia: true,
      etapa_bloqueada: "piso",
      risco: "medio",
      motivo: "Material do piso indefinido.",
    },
    { indice: 1, eh_pendencia: false, etapa_bloqueada: null, risco: "baixo", motivo: "Só especificação." },
  ],
};

/** Cliente falso com o formato de resposta do SDK (sem rede). */
function clienteFalso(respostas: Record<string, unknown>[]) {
  const pedidos: Record<string, unknown>[] = [];
  const cliente = {
    beta: {
      messages: {
        parse: async (p: Record<string, unknown>) => {
          pedidos.push(p);
          return respostas.shift();
        },
      },
    },
  } as unknown as Anthropic;
  return { cliente, pedidos };
}

const uso = {
  input_tokens: 2000,
  output_tokens: 300,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 0,
};

describe("LlmClaude (cliente falso)", () => {
  it("monta o pedido: saída estruturada, esforço, cache do sistema; fallback só em Opus/Sonnet", async () => {
    const { cliente, pedidos } = clienteFalso([
      { model: "claude-haiku-5-5", stop_reason: "end_turn", parsed_output: valido, usage: uso },
      { model: "claude-opus-5-5", stop_reason: "end_turn", parsed_output: { pontos: [] }, usage: uso },
    ]);
    const llm = new LlmClaude(cliente);
    const r = await llm.estruturado(tarefa);
    expect(r).toMatchObject({
      ok: true,
      saida: valido,
      uso: { modelo: "claude-haiku-5-5", entrada: 2000, cacheLeitura: 1000 },
    });
    expect(pedidos[0]).toMatchObject({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
      system: [{ type: "text", cache_control: { type: "ephemeral" } }],
    });
    expect(pedidos[0]).not.toHaveProperty("fallbacks");

    const material = {
      projeto: { disciplina: "estrutura", titulo: "Forma L4", codigo: "EST-04", revisao: "R1" },
      locais: [],
      ambientes: [],
      cotasNivel: [],
      textos: [],
      camadas: [],
    };
    await llm.estruturado(tarefaPontos(material));
    expect(pedidos[1]).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });

  it("recusa, truncamento e saída fora do schema viram resultado, não exceção", async () => {
    const { cliente } = clienteFalso([
      {
        model: "claude-haiku-5-5",
        stop_reason: "refusal",
        stop_details: { explanation: "x" },
        parsed_output: null,
        usage: uso,
      },
      { model: "claude-haiku-5-5", stop_reason: "max_tokens", parsed_output: null, usage: uso },
      {
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        parsed_output: { itens: [{ indice: "zero" }] },
        usage: uso,
      },
    ]);
    const llm = new LlmClaude(cliente);
    expect(await llm.estruturado(tarefa)).toMatchObject({ ok: false, motivo: "recusa" });
    expect(await llm.estruturado(tarefa)).toMatchObject({ ok: false, motivo: "truncado" });
    expect(await llm.estruturado(tarefa)).toMatchObject({ ok: false, motivo: "schema" });
  });
});

describe("nova tentativa e custo", () => {
  it("schema inválido → 1 nova tentativa; o custo das duas é contado", async () => {
    const llm = new LlmFalso({ pendencias: [() => ({ itens: "lixo" }), () => valido] });
    const { resultado, usos } = await comNovaTentativa(llm, tarefa);
    expect(resultado.ok).toBe(true);
    expect(usos).toHaveLength(2);
  });

  it("custo pela tabela (Opus 5.5: US$ 4 / 20 por milhão; leitura de cache 0,20)", () => {
    expect(
      custoEstimado({
        modelo: "claude-opus-5-5",
        entrada: 1_000_000,
        saida: 100_000,
        cacheLeitura: 1_000_000,
        cacheEscrita: 0,
      }),
    ).toBe("6.200000");
    expect(
      custoEstimado({ modelo: "desconhecido", entrada: 1, saida: 1, cacheLeitura: 0, cacheEscrita: 0 }),
    ).toBe("0");
  });
});
