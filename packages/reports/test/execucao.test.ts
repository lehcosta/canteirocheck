import { describe, expect, it } from "vitest";
import { type DadosRelatorioExecucao, gerarPdfExecucao, textoPdf } from "../src";

const agora = new Date("2026-11-15T15:00:00Z");
const dados: DadosRelatorioExecucao = {
  id: "00000000-0000-4000-8000-000000000001",
  obraNome: "Edifício Teste",
  etapaNome: "Concretagem",
  localNome: "L4",
  dataPrevista: "2026-11-16",
  status: "recusada",
  rodadaAtual: 1,
  anunciadaPor: "João",
  engenheiroResponsavel: { nome: "Eng. Ana" },
  criadoEm: agora,
  rodadas: [
    {
      rodada: 1,
      ok: 2,
      divergentes: 1,
      pendentes: 0,
      decisao: {
        decisao: "recusada",
        justificativa: "Ajustar forma e reenviar conferência.",
        engenheiroNome: "Eng. Ana",
        canal: "flow",
        criadoEm: agora,
      },
      pontos: [
        {
          pontoId: "p1",
          descricao: "Interface L3/L4",
          esperado: "6,000 m ± 0,5 cm",
          situacao: "divergente",
          tentativas: [
            {
              tentativa: 1,
              texto: "6,040 m (lado executado 6,000 m, dif. +4 cm)",
              dentro: false,
              observacao: null,
              usuarioNome: "João",
              canal: "flow",
              estruturada: true,
              criadoEm: agora,
              midias: [],
            },
          ],
          divergencia: { causa: "Forma montada fora do nível", descricao: null, criadoEm: agora, midias: [] },
        },
      ],
    },
  ],
};

describe("relatório PDF da execução", () => {
  it("gera um PDF válido", async () => {
    const pdf = await gerarPdfExecucao(dados, new Map(), agora);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("troca o que a fonte padrão não desenha", () => {
    expect(textoPdf("❌ dif. −0,5 cm ✅ 🔴")).toBe("[X] dif. -0,5 cm [OK] ");
    expect(textoPdf("Laje L4 · ± 1 cm — ok")).toBe("Laje L4 · ± 1 cm — ok");
  });
});
