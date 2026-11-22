/**
 * Envio dos checks pelo WhatsApp: o despacho no dia e na hora, a conversa pergunta a pergunta
 * (botão, texto, foto), a pergunta de passagem entre tarefas saindo antes da tarefa dela, e o
 * aviso ao engenheiro quando a resposta vem fora do esperado.
 */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { LlmFalso } from "@canteirocheck/ai";
import { registrarEntradaWhatsapp, schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria, type PayloadJob } from "@canteirocheck/queue";
import { garantirBucket } from "@canteirocheck/storage";
import type { ConteudoEntrada, MensagemSaida } from "@canteirocheck/whatsapp";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adicionarMembro,
  aprovarCheck,
  type Contexto,
  criarObra,
  criarUsuario,
  despacharCheck,
  lerRespostaDoCheck,
  obterFase,
  processarCruzamento,
  processarExtracao,
  processarLeituraCronograma,
  processarMensagemRecebida,
  registrarCronograma,
  registrarProjeto,
} from "../src";
import type { LeituraCronograma } from "../src/cronogramas";

const fila = new FilaEmMemoria();
definirFila(fila);
const DWG = readFileSync(
  new URL("../../../services/dwg-extractor/test/fixtures/amostra.dwg", import.meta.url),
);
const SAIDA = JSON.parse(
  readFileSync(new URL("../../extracao/test/fixtures/amostra.extracao.json", import.meta.url), "utf8"),
);
const XML = readFileSync(
  new URL("../../../services/mpp-extractor/test/fixtures/cronograma.xml", import.meta.url),
);
const LEITURA: LeituraCronograma = JSON.parse(
  readFileSync(new URL("./fixtures/cronograma.leitura.json", import.meta.url), "utf8"),
);
const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

// Fase "Revestimentos e pisos": 15/03/2027 a 28/05/2027. Linha 109 = Chapisco e emboço, térreo
// (15/03); linha 110 = Contrapiso, térreo (19/03).
const REVESTIMENTOS = 109;
/** 08:00 em São Paulo no dia dado. */
const as8 = (dia: string) => new Date(`${dia}T11:00:00Z`);

let admin: Contexto;
let eng: Contexto;
let joao: Contexto & { tel: string };
let obraId: string;
let antesId: string;

const saidasPara = async (usuarioId: string) =>
  (
    await withTenant(admin.tenantId, (tx) =>
      tx
        .select()
        .from(schema.mensagemWhatsapp)
        .where(
          and(eq(schema.mensagemWhatsapp.usuarioId, usuarioId), eq(schema.mensagemWhatsapp.direcao, "saida")),
        )
        .orderBy(asc(schema.mensagemWhatsapp.criadoEm), asc(schema.mensagemWhatsapp.id)),
    )
  ).map((m) => (m.payload as { mensagem: MensagemSaida }).mensagem);
const ultimaPara = async (usuarioId: string) => {
  const m = (await saidasPara(usuarioId)).at(-1);
  if (!m || m.tipo === "flow" || m.tipo === "template") throw new Error("sem mensagem de texto ou botões");
  return m;
};
const botao = (m: MensagemSaida, titulo: string) => {
  const b = m.tipo === "botoes" ? m.botoes.find((x) => x.titulo === titulo) : undefined;
  if (!b) throw new Error(`sem botão ${titulo}`);
  return b;
};
async function recebe(conteudo: ConteudoEntrada) {
  const e = await registrarEntradaWhatsapp({
    waMessageId: `wamid.${d(12)}`,
    waId: joao.tel,
    tipo: conteudo.tipo,
    payload: { conteudo },
  });
  return processarMensagemRecebida(e.tenantId, e.mensagemId);
}
const envios = () =>
  withTenant(admin.tenantId, (tx) =>
    tx
      .select()
      .from(schema.checkEnvio)
      .where(eq(schema.checkEnvio.checkId, antesId))
      .orderBy(asc(schema.checkEnvio.previstoPara)),
  );

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora Envio",
      cnpj: d(14),
      admin: { nome: "Admin", email: `a${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
    }),
  );
  admin = { tenantId: t.tenantId, usuarioId: t.adminUsuarioId, papel: "admin" };
  const e = await criarUsuario(admin, {
    nome: "Eng. Rita",
    papel: "engenheiro",
    email: `r${d(8)}@t.test`,
    whatsapp: `(11) 9${d(8)}`,
  });
  eng = { tenantId: t.tenantId, usuarioId: e.id, papel: "engenheiro" };
  const tel = `9${d(8)}`;
  const j = await criarUsuario(admin, { nome: "João", papel: "encarregado", whatsapp: `(11) ${tel}` });
  joao = { tenantId: t.tenantId, usuarioId: j.id, papel: "encarregado", tel: `5511${tel}` };
  obraId = (await criarObra(admin, { nome: "Edifício Envio", engenheiroResponsavelId: eng.usuarioId })).id;
  await adicionarMembro(eng, { obraId, usuarioId: joao.usuarioId });

  const p = await registrarProjeto(
    admin,
    { obraId, disciplina: "arquitetura", titulo: "Planta", codigo: "ARQ-01", revisao: "R0" },
    { dados: DWG, nome: "ARQ-01.dwg" },
  );
  await processarExtracao(admin.tenantId, p.id, async () => SAIDA);
  const v = await registrarCronograma(admin, { obraId }, { dados: XML, nome: "rev01.xml" });
  await processarLeituraCronograma(admin.tenantId, v.id, async () => LEITURA);
  const pedido = fila.jobs.find((x) => x.nome === "cruzar_cronograma")?.payload as
    | PayloadJob<"cruzar_cronograma">
    | undefined;
  if (!pedido) throw new Error("sem pedido de cruzamento");

  const pergunta = (texto: string, extra = {}) => ({
    momento: "antes" as const,
    texto,
    tipo: "sim_nao" as const,
    opcoes: [] as string[],
    esperada: "Sim" as string | null,
    pede_foto: false,
    ...extra,
  });
  const llm = new LlmFalso({
    cruzamento: () => ({
      riscos: [
        {
          fase_uid: REVESTIMENTOS,
          nivel: "alto",
          titulo: "O piso está a definir; o contrapiso começa em 19/03",
          projeto: "ARQ-01",
          projeto_trecho: "PISO A DEFINIR AGUARDANDO PROJETO",
          cronograma_linha: 110,
          cronograma_trecho: "Contrapiso, térreo: 19/03 a 22/03",
          consequencia: "O contrapiso sai no nível errado.",
          perguntas: [
            pergunta("O piso do térreo já foi definido?"),
            pergunta("Qual a espessura prevista do contrapiso?", {
              tipo: "medida",
              opcoes: ["cm"],
              esperada: "2..5",
              pede_foto: true,
            }),
          ],
        },
      ],
      passagens: [
        {
          anterior_linha: 109,
          proxima_linha: 110,
          nivel: "medio",
          titulo: "O contrapiso começa em 19/03 e o emboço está em 0%",
          consequencia: "Contrapiso antes do emboço suja e quebra a base.",
          perguntas: [pergunta("O chapisco e o emboço do térreo já terminaram?")],
        },
      ],
    }),
  });
  expect(await processarCruzamento(admin.tenantId, pedido.cruzamentoId, llm)).toMatchObject({
    status: "concluida",
    riscos: 2,
  });
  const fase = await obterFase(eng, obraId, REVESTIMENTOS, "2027-03-01");
  const antes = fase?.checks.find((k) => k.momento === "antes");
  if (!antes) throw new Error("sem check antes");
  antesId = antes.id;
});

describe("respostas lidas do texto", () => {
  it("cada tipo aceita o que o encarregado escreve; o resto pede de novo", () => {
    const p = (tipoResposta: "sim_nao" | "opcao" | "data" | "medida" | "texto", opcoes: string[] = []) => ({
      tipoResposta,
      opcoes,
    });
    const hoje = "2026-11-21";
    expect(lerRespostaDoCheck(p("sim_nao"), " Não. ", hoje)).toBe("nao");
    expect(lerRespostaDoCheck(p("sim_nao"), "talvez", hoje)).toBeNull();
    expect(lerRespostaDoCheck(p("opcao", ["Cerâmica", "Porcelanato"]), "2", hoje)).toBe("Porcelanato");
    expect(lerRespostaDoCheck(p("opcao", ["Cerâmica", "Porcelanato"]), "cerâmica", hoje)).toBe("Cerâmica");
    expect(lerRespostaDoCheck(p("opcao", ["Cerâmica", "Porcelanato"]), "3", hoje)).toBeNull();
    expect(lerRespostaDoCheck(p("data"), "25/11", hoje)).toBe("2026-11-25");
    expect(lerRespostaDoCheck(p("data"), "5/1/27", hoje)).toBe("2027-01-05");
    expect(lerRespostaDoCheck(p("data"), "31/02/2027", hoje)).toBeNull();
    expect(lerRespostaDoCheck(p("medida", ["cm"]), "3,5 cm", hoje)).toBe("3.5");
    expect(lerRespostaDoCheck(p("medida", ["cm"]), "uns três", hoje)).toBeNull();
    expect(lerRespostaDoCheck(p("texto"), " ficou bom ", hoje)).toBe("ficou bom");
  });
});

describe("envio do check pelo WhatsApp", () => {
  it("a pergunta de passagem mostra a data da tarefa dela; as outras saem com a fase", async () => {
    const fase = await obterFase(eng, obraId, REVESTIMENTOS, "2027-03-01");
    const antes = fase?.checks.find((k) => k.momento === "antes");
    expect(antes?.perguntas.map((p) => [p.texto, p.saiEm])).toEqual([
      ["O piso do térreo já foi definido?", null],
      ["Qual a espessura prevista do contrapiso?", null],
      // 3 dias antes do Contrapiso (19/03), não da fase (15/03)
      [
        "O chapisco e o emboço do térreo já terminaram?",
        { data: "2027-03-16", tarefa: "Contrapiso, térreo" },
      ],
    ]);
  });

  it("só sai aprovado, no dia e depois da hora; uma pergunta por mensagem", async () => {
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-12"))).toMatchObject({
      enviado: false,
      motivo: "não aprovado",
    });
    await aprovarCheck(eng, antesId);
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-11"))).toMatchObject({
      enviado: false,
      motivo: "nada para hoje",
    });
    // 06:00 em São Paulo: a regra é 07:00
    expect(await despacharCheck(admin.tenantId, antesId, new Date("2027-03-12T09:00:00Z"))).toMatchObject({
      enviado: false,
      motivo: "antes da hora",
    });

    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-12"))).toMatchObject({ enviado: true });
    const [envio] = await envios();
    expect(envio).toMatchObject({ previstoPara: "2027-03-12", entrega: "enviado", respondidoEm: null });
    expect(envio?.perguntaIds).toHaveLength(2);

    const primeira = await ultimaPara(joao.usuarioId);
    expect(primeira.tipo).toBe("botoes");
    expect(primeira.texto).toBe(
      "*Check · Edifício Envio*\nAntes de começar: Revestimentos e pisos\n2 perguntas rápidas.\n\n1/2 · O piso do térreo já foi definido?",
    );
    // enquanto ele não responde, nada mais sai para ele
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-12"))).toMatchObject({
      enviado: false,
      motivo: "outro check espera resposta",
    });
  });

  it("botão, texto que não serve, medida, foto: cada resposta é gravada e a seguinte é perguntada", async () => {
    const primeira = await ultimaPara(joao.usuarioId);
    expect(await recebe({ tipo: "botao", id: botao(primeira, "Não").id, titulo: "Não" })).toEqual({
      acao: "check:proxima",
    });
    const segunda = await ultimaPara(joao.usuarioId);
    expect(segunda).toEqual({
      tipo: "texto",
      texto: "2/2 · Qual a espessura prevista do contrapiso?\n\nResponda só com o número, em cm.",
    });
    // tocar de novo no botão da primeira não grava outra resposta
    expect(await recebe({ tipo: "botao", id: botao(primeira, "Sim").id, titulo: "Sim" })).toEqual({
      acao: "erro:conflito",
    });

    expect(await recebe({ tipo: "texto", texto: "uns três dedos" })).toEqual({
      acao: "check:resposta_invalida",
    });
    expect((await ultimaPara(joao.usuarioId)).texto).toMatch(/Não entendi o número/);
    expect(await recebe({ tipo: "texto", texto: "3,5 cm" })).toEqual({ acao: "check:foto_pedida" });
    const foto = await ultimaPara(joao.usuarioId);
    expect(foto.texto).toMatch(/Mande uma foto/);
    expect(botao(foto, "Sem foto").id).toContain(":x");
    expect(await recebe({ tipo: "texto", texto: "já mando" })).toEqual({ acao: "check:esperando_foto" });

    expect(
      await recebe({ tipo: "imagem", mediaId: `m${d(8)}`, mimeType: "image/jpeg", legenda: null }),
    ).toEqual({ acao: "check:respondido_com_alerta" });
    const [envio] = await envios();
    expect(envio).toMatchObject({
      respondidoPorId: joao.usuarioId,
      foraDoEsperado: 1,
      aguardandoPerguntaId: null,
      aguardandoFoto: false,
    });
    expect(envio?.respondidoEm).not.toBeNull();
    expect((await ultimaPara(joao.usuarioId)).texto).toBe("✅ Respostas registradas. Obrigado!");

    const respostas = await withTenant(admin.tenantId, (tx) =>
      tx
        .select()
        .from(schema.checkResposta)
        .where(eq(schema.checkResposta.envioId, envio?.id ?? "")),
    );
    expect(respostas.map((r) => [r.valor, r.dentroDoEsperado, r.midiaId !== null]).sort()).toEqual([
      ["3.5", true, true],
      ["nao", false, false],
    ]);
  });

  it("resposta fora do esperado avisa o engenheiro responsável e libera o próximo envio", async () => {
    const aviso = await ultimaPara(eng.usuarioId);
    expect(aviso.texto).toContain("⚠️ *Check · Edifício Envio*");
    expect(aviso.texto).toContain("João respondeu 1 pergunta fora do esperado:");
    expect(aviso.texto).toContain("• O piso do térreo já foi definido?\n  Resposta: Não (esperado: Sim)");
    expect(fila.jobs.some((j) => j.nome === "despachar_checks")).toBe(true);
  });

  it("a pergunta de passagem sai sozinha, 3 dias antes da tarefa dela, e responde por texto", async () => {
    // no dia do primeiro envio ela ainda não é devida
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-13"))).toMatchObject({
      enviado: false,
      motivo: "nada para hoje",
    });
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-16"))).toMatchObject({ enviado: true });
    const pergunta = await ultimaPara(joao.usuarioId);
    expect(pergunta.texto).toBe(
      "*Check · Edifício Envio*\nAntes de começar: Contrapiso, térreo\n1 pergunta rápida.\n\nO chapisco e o emboço do térreo já terminaram?",
    );
    expect(await recebe({ tipo: "texto", texto: "Sim" })).toEqual({ acao: "check:respondido" });
    expect((await envios()).map((e) => [e.previstoPara, e.foraDoEsperado])).toEqual([
      ["2027-03-12", 1],
      ["2027-03-16", 0],
    ]);
    // cada pergunta do "antes" sai uma vez só
    expect(await despacharCheck(admin.tenantId, antesId, as8("2027-03-17"))).toMatchObject({
      enviado: false,
      motivo: "nada para hoje",
    });

    const fase = await obterFase(eng, obraId, REVESTIMENTOS, "2027-03-17");
    const antes = fase?.checks.find((k) => k.momento === "antes");
    expect(antes?.estado).toBe("ok");
    expect(antes?.envios.map((e) => [e.previstoPara, e.total, e.respostas.length])).toEqual([
      ["2027-03-16", 1, 1],
      ["2027-03-12", 2, 2],
    ]);
  });

  it("quem não tem check esperando resposta segue no caminho de sempre", async () => {
    expect((await recebe({ tipo: "texto", texto: "oi" })).acao).toMatch(/^(menu:texto|ia:interpretar)$/);
  });
});
