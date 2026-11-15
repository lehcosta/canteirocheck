/** Etapa 2: upload de projeto, extração (extrator falso com a saída real da amostra) e revisões. */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import { garantirBucket } from "@canteirocheck/storage";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Contexto,
  criarObra,
  criarUsuario,
  listarProjetos,
  obterProjeto,
  processarExtracao,
  registrarProjeto,
} from "../src";
import { ArquivoRecusadoPeloExtrator } from "../src/projetos";

const fila = new FilaEmMemoria();
definirFila(fila);
const DWG = readFileSync(
  new URL("../../../services/dwg-extractor/test/fixtures/amostra.dwg", import.meta.url),
);
const SAIDA = JSON.parse(
  readFileSync(new URL("../../extracao/test/fixtures/amostra.extracao.json", import.meta.url), "utf8"),
);
const extratorFalso = async () => SAIDA;
const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

let admin: Contexto;
let obraId: string;
const meta = (revisao: string) => ({
  obraId,
  disciplina: "interiores",
  titulo: "Planta de layout",
  codigo: "INT-01",
  revisao,
});

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora DWG",
      cnpj: d(14),
      admin: { nome: "Admin", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  admin = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  const eng = await criarUsuario(admin, {
    nome: "Eng. Caio",
    papel: "engenheiro",
    email: `c${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  obraId = (await criarObra(admin, { nome: "Interiores Teste", engenheiroResponsavelId: eng.id })).id;
});

describe("projetos", () => {
  it("recusa arquivo que não é DWG nem PDF (pelo conteúdo, não pela extensão)", async () => {
    await expect(
      registrarProjeto(admin, meta("R00"), { dados: Buffer.from("MZ executável"), nome: "planta.dwg" }),
    ).rejects.toThrow(/DWG ou PDF/);
  });

  it("DWG: grava, enfileira a extração e o resultado interpretado fica no projeto", async () => {
    const { id, tipo } = await registrarProjeto(admin, meta("R01"), { dados: DWG, nome: "INT-01-R01.dwg" });
    expect(tipo).toBe("dwg");
    expect(fila.doTipo("extrair_dwg")).toContainEqual({ tenantId: admin.tenantId, projetoId: id });

    const r = await processarExtracao(admin.tenantId, id, extratorFalso);
    expect(r).toEqual({ status: "concluida", notasSuspeitas: 1 });
    const p = await obterProjeto(admin, id);
    expect(p?.statusExtracao).toBe("concluida");
    expect(p?.extracao?.ambientes).toEqual([
      { nome: "SALA", areaM2: "18.50", fonteArea: "texto", camada: "A-AMBIENTE", x: 2, y: 1.8 },
    ]);
    expect(p?.extracao?.notas[0]?.texto).toContain("PISO A DEFINIR");
    expect(p?.extracao?.carimbo.revisao).toBe("R02");
    expect(p?.extracao?.versaoExtrator).toBe("dwg-extractor@0.1.0+libredwg-web@0.9.0");
    expect(fila.doTipo("detectar_pendencias")).toContainEqual({ tenantId: admin.tenantId, projetoId: id });
    expect(fila.doTipo("gerar_pontos")).toContainEqual({ tenantId: admin.tenantId, projetoId: id });
  });

  it("nova revisão substitui a anterior; revisão repetida é recusada", async () => {
    await registrarProjeto(admin, meta("R02"), { dados: DWG, nome: "INT-01-R02.dwg" });
    await expect(registrarProjeto(admin, meta("R02"), { dados: DWG, nome: "x.dwg" })).rejects.toThrow(
      /Já existe esta revisão/,
    );
    const lista = await listarProjetos(admin, obraId);
    expect(lista.map((p) => [p.revisao, p.substituido])).toEqual([
      ["R02", false],
      ["R01", true],
    ]);
  });

  it("arquivo recusado pelo extrator vira falha definitiva; erro de rede tenta de novo", async () => {
    const { id } = await registrarProjeto(admin, meta("R03"), { dados: DWG, nome: "r03.dwg" });
    await expect(
      processarExtracao(admin.tenantId, id, async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect((await obterProjeto(admin, id))?.statusExtracao).toBe("pendente");

    const r = await processarExtracao(admin.tenantId, id, async () => {
      throw new ArquivoRecusadoPeloExtrator("arquivo corrompido");
    });
    expect(r.status).toBe("falhou");
    expect(await obterProjeto(admin, id)).toMatchObject({
      statusExtracao: "falhou",
      erroExtracao: "arquivo corrompido",
    });
  });

  it("PDF entra como referência, sem extração", async () => {
    const pdf = Buffer.from("%PDF-1.7\n%…\n");
    const r = await registrarProjeto(
      admin,
      { ...meta("R00"), codigo: "MEM-01", titulo: "Memorial" },
      { dados: pdf, nome: "m.pdf" },
    );
    expect(r.tipo).toBe("pdf");
    expect((await obterProjeto(admin, r.id))?.statusExtracao).toBe("nao_aplicavel");
  });
});
