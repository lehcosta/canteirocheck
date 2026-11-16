import { describe, expect, it } from "vitest";
import { FLOWS, jsonDoFlow, lerTelaDoChecklist, MAX_PONTOS_FLOW, type NomeFlow, TELAS } from "../src/flows";

/**
 * Regras do validador da Meta conferidas aqui (docs/referencia-meta-whatsapp.md §2):
 * rota para si mesma é proibida, sem ida e volta declaradas, sem loop, uma tela de entrada,
 * ≤10 ramos por tela, ≤100 telas, ≤50 componentes, Footer em tela terminal, limites de rótulo,
 * `__example__` em todo dado, nada de null e PhotoPicker fora de If/Switch.
 */

type Tela = {
  id: string;
  terminal?: boolean;
  data?: Record<string, { __example__?: unknown }>;
  layout: { children: Componente[] };
};
type Componente = Record<string, unknown> & { type: string };
type Flow = {
  version: string;
  data_api_version: string;
  routing_model: Record<string, string[]>;
  screens: Tela[];
};

const nomes = Object.values(FLOWS) as NomeFlow[];

function alcancaveis(rotas: Record<string, string[]>, de: string, visto = new Set<string>()): Set<string> {
  for (const p of rotas[de] ?? []) {
    if (!visto.has(p)) {
      visto.add(p);
      alcancaveis(rotas, p, visto);
    }
  }
  return visto;
}

describe.each(nomes)("Flow %s", (nome) => {
  const flow = jsonDoFlow(nome) as unknown as Flow;
  const ids = flow.screens.map((s) => s.id);

  it("versões e telas", () => {
    expect(flow.version).toBe("7.3");
    expect(flow.data_api_version).toBe("3.0");
    expect(flow.screens.length).toBeLessThanOrEqual(100);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("SUCCESS");
    for (const id of ids) expect(id).toMatch(/^[A-Z_]+$/);
  });

  it("routing model válido", () => {
    const r = flow.routing_model;
    expect(Object.keys(r).sort()).toEqual([...ids].sort());
    const entradas = ids.filter((id) => !Object.values(r).some((destinos) => destinos.includes(id)));
    expect(entradas).toHaveLength(1);
    for (const [de, para] of Object.entries(r)) {
      expect(para.length).toBeLessThanOrEqual(10);
      expect(para).not.toContain(de);
      for (const p of para) {
        expect(ids).toContain(p);
        expect(r[p] ?? []).not.toContain(de); // ida e volta declaradas
        expect(alcancaveis(r, p).has(de)).toBe(false); // loop
      }
    }
    // toda tela alcançável a partir da entrada
    const entrada = entradas[0] ?? "";
    expect(new Set([entrada, ...alcancaveis(r, entrada)])).toEqual(new Set(ids));
    // todo caminho termina numa terminal
    for (const t of flow.screens.filter((s) => (r[s.id] ?? []).length === 0)) expect(t.terminal).toBe(true);
  });

  it("componentes dentro dos limites", () => {
    for (const tela of flow.screens) {
      const filhos = tela.layout.children;
      expect(filhos.length).toBeLessThanOrEqual(50);
      expect(filhos.filter((c) => c.type === "Footer")).toHaveLength(1);
      expect(filhos.filter((c) => c.type === "PhotoPicker").length).toBeLessThanOrEqual(1);
      for (const c of filhos) {
        expect(["If", "Switch"]).not.toContain(c.type);
        const label = c.label as string | undefined;
        if (label && !label.startsWith("${")) {
          const max =
            c.type === "Footer"
              ? 35
              : c.type === "RadioButtonsGroup" || c.type === "CheckboxGroup"
                ? 30
                : c.type === "PhotoPicker"
                  ? 80
                  : 20;
          expect(label.length, `${tela.id}/${c.type}: ${label}`).toBeLessThanOrEqual(max);
        }
      }
      for (const [campo, def] of Object.entries(tela.data ?? {})) {
        expect(def.__example__, `${tela.id}.${campo}`).toBeDefined();
        expect(def.__example__).not.toBeNull();
      }
    }
  });
});

describe("checklist", () => {
  it("9 pontos por sessão: entrada alcança cada MEDIR e o RESUMO", () => {
    const flow = jsonDoFlow(FLOWS.checklist) as unknown as Flow;
    expect(flow.routing_model[TELAS.inicio]).toHaveLength(MAX_PONTOS_FLOW + 1);
    expect(flow.screens).toHaveLength(2 + 2 * MAX_PONTOS_FLOW);
  });

  it("nomes de tela ↔ índice", () => {
    expect(TELAS.medir(0)).toBe("MEDIR_A");
    expect(lerTelaDoChecklist("CAUSA_C")).toEqual({ tipo: "causa", indice: 2 });
    expect(lerTelaDoChecklist("MEDIR_J")).toBeNull();
    expect(() => TELAS.medir(MAX_PONTOS_FLOW)).toThrow();
  });
});
