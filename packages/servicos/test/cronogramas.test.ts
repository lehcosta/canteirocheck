/** Cronograma do MS Project: importação, leitura (leitor falso com a saída real da amostra), versões e restauração. */
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
  obterCronograma,
  processarLeituraCronograma,
  registrarCronograma,
  restaurarCronograma,
  tipoDoCronograma,
} from "../src";
import { ArquivoRecusadoPeloLeitor, type LeituraCronograma } from "../src/cronogramas";

const fila = new FilaEmMemoria();
definirFila(fila);
const XML = readFileSync(
  new URL("../../../services/mpp-extractor/test/fixtures/cronograma.xml", import.meta.url),
);
/** Saída real do mpp-extractor para o XML acima. */
const LEITURA: LeituraCronograma = JSON.parse(
  readFileSync(new URL("./fixtures/cronograma.leitura.json", import.meta.url), "utf8"),
);
const leitorFalso = async () => LEITURA;
const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

let admin: Contexto;
let obraId: string;

async function criarObraDeTeste(nome: string) {
  const eng = await criarUsuario(admin, {
    nome: "Eng. Lia",
    papel: "engenheiro",
    email: `l${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  return (await criarObra(admin, { nome, engenheiroResponsavelId: eng.id })).id;
}
const importar = (nome: string, leitor: (dados: Uint8Array) => Promise<unknown> = leitorFalso) =>
  registrarCronograma(admin, { obraId }, { dados: XML, nome }).then(async ({ id }) => ({
    id,
    resultado: await processarLeituraCronograma(admin.tenantId, id, leitor),
  }));

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora Cronograma",
      cnpj: d(14),
      admin: { nome: "Admin", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  admin = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  obraId = await criarObraDeTeste("Edifício Cronograma");
});

describe("cronogramas", () => {
  it("reconhece MPP e XML do MS Project pelo conteúdo, não pela extensão", () => {
    expect(tipoDoCronograma(XML)).toBe("xml");
    expect(tipoDoCronograma(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe("mpp");
    expect(tipoDoCronograma(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(
      tipoDoCronograma(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
  });

  it("recusa arquivo que não é do MS Project e encarregado", async () => {
    await expect(
      registrarCronograma(admin, { obraId }, { dados: Buffer.from("%PDF-1.7 ..."), nome: "cronograma.mpp" }),
    ).rejects.toThrow(/MPP ou XML/);
    await expect(
      registrarCronograma({ ...admin, papel: "encarregado" }, { obraId }, { dados: XML, nome: "c.xml" }),
    ).rejects.toThrow(/permissão/);
  });

  it("obra sem importação: nada vigente", async () => {
    expect(await obterCronograma(admin, obraId)).toEqual({ versoes: [], vigente: null, tarefas: [] });
  });

  it("importa: fica lendo, e ao concluir vira a v1 vigente com as tarefas na ordem do arquivo", async () => {
    const { id } = await registrarCronograma(admin, { obraId }, { dados: XML, nome: "C:\\obras\\rev01.xml" });
    expect(fila.doTipo("ler_cronograma")).toContainEqual({ tenantId: admin.tenantId, versaoId: id });
    const antes = await obterCronograma(admin, obraId);
    expect(antes.vigente).toBeNull();
    expect(antes.versoes[0]).toMatchObject({
      numero: null,
      statusLeitura: "pendente",
      arquivoNome: "rev01.xml",
    });

    const r = await processarLeituraCronograma(admin.tenantId, id, leitorFalso);
    expect(r).toEqual({ status: "concluida", numero: 1, tarefas: 142 });
    const c = await obterCronograma(admin, obraId);
    expect(c.vigente).toMatchObject({ id, numero: 1, totalTarefas: 142, termino: "2027-06-30" });
    expect(c.tarefas).toHaveLength(142);
    expect(c.tarefas[0]).toMatchObject({ nome: "Infraestrutura", nivel: 1, resumo: true, percentual: 100 });
    expect(c.tarefas.at(-1)).toMatchObject({ nome: "Entrega da obra", marco: true, termino: "2027-06-30" });
    // repetir o job não duplica nada
    expect(await processarLeituraCronograma(admin.tenantId, id, leitorFalso)).toEqual({ status: "ignorada" });
  });

  it("segunda importação vira a v2 vigente e a v1 fica no histórico", async () => {
    const { resultado } = await importar("rev02.xml");
    expect(resultado).toMatchObject({ status: "concluida", numero: 2 });
    const c = await obterCronograma(admin, obraId);
    expect(c.versoes.map((v) => [v.numero, v.vigente])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it("arquivo recusado ou sem tarefas: falha definitiva, com o motivo, e a vigente não muda", async () => {
    const recusado = await importar("corrompido.mpp", async () => {
      throw new ArquivoRecusadoPeloLeitor("Não consegui ler o arquivo do MS Project.");
    });
    expect(recusado.resultado).toEqual({ status: "falhou" });
    const vazio = await importar("vazio.xml", async () => ({ ...LEITURA, tarefas: [] }));
    expect(vazio.resultado).toEqual({ status: "falhou" });

    const c = await obterCronograma(admin, obraId);
    expect(c.vigente?.numero).toBe(2);
    expect(c.versoes[0]).toMatchObject({
      numero: null,
      statusLeitura: "falhou",
      erroLeitura: "Não encontrei tarefas no arquivo.",
    });
    expect(c.versoes[1]?.erroLeitura).toBe("Não consegui ler o arquivo do MS Project.");
    await expect(restaurarCronograma(admin, vazio.id)).rejects.toThrow(/não foi lida/);
  });

  it("leitor fora do ar: volta para a fila (pendente) e o erro sobe para o BullMQ tentar de novo", async () => {
    const { id } = await registrarCronograma(admin, { obraId }, { dados: XML, nome: "rev03.xml" });
    await expect(
      processarLeituraCronograma(admin.tenantId, id, async () => {
        throw new Error("leitor respondeu 503");
      }),
    ).rejects.toThrow(/503/);
    expect((await obterCronograma(admin, obraId)).versoes[0]).toMatchObject({ statusLeitura: "pendente" });
    // na nova tentativa conclui; as que falharam não gastam número
    expect(await processarLeituraCronograma(admin.tenantId, id, leitorFalso)).toMatchObject({ numero: 3 });
  });

  it("restaura uma versão anterior sem apagar nada, e não deixa restaurar a vigente", async () => {
    const antes = await obterCronograma(admin, obraId);
    const v1 = antes.versoes.find((v) => v.numero === 1);
    const v3 = antes.versoes.find((v) => v.numero === 3);
    if (!v1 || !v3) throw new Error("faltam versões");
    await expect(restaurarCronograma(admin, v3.id)).rejects.toThrow(/já é a vigente/);
    await expect(restaurarCronograma({ ...admin, papel: "encarregado" }, v1.id)).rejects.toThrow(/permissão/);

    expect(await restaurarCronograma(admin, v1.id)).toEqual({ numero: 1 });
    const depois = await obterCronograma(admin, obraId);
    expect(depois.vigente?.numero).toBe(1);
    expect(depois.versoes).toHaveLength(antes.versoes.length);
    expect(depois.versoes.filter((v) => v.vigente)).toHaveLength(1);
    expect(depois.tarefas).toHaveLength(142);
  });

  it("outra construtora não vê nem restaura o cronograma", async () => {
    const outro = await comDono(urlsDeTeste().dono, (db) =>
      criarTenantComAdmin(db, {
        nome: "Outra Construtora",
        cnpj: d(14),
        admin: { nome: "Admin", email: `o${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
      }),
    );
    const ctx: Contexto = { tenantId: outro.tenantId, usuarioId: outro.adminUsuarioId, papel: "admin" };
    expect((await obterCronograma(ctx, obraId)).versoes).toEqual([]);
    const [v] = (await obterCronograma(admin, obraId)).versoes;
    await expect(restaurarCronograma(ctx, v?.id ?? "")).rejects.toThrow(/não encontrada/);
    await expect(registrarCronograma(ctx, { obraId }, { dados: XML, nome: "x.xml" })).rejects.toThrow(
      /Obra não encontrada/,
    );
  });
});
