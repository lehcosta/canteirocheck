/**
 * Riscos por fase: cruzamento do cronograma com o projeto (IA falsa, mesmo schema zod da real),
 * checks por fase no painel (edição, aprovação), o registro de envio e resposta, e a convivência
 * de cruzamentos da mesma obra (um job por vez, o mais novo vence).
 */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Llm, LlmFalso, type SaidaCruzamento, type TarefaEstruturada } from "@canteirocheck/ai";
import { schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria, type PayloadJob } from "@canteirocheck/queue";
import { garantirBucket } from "@canteirocheck/storage";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adicionarMembro,
  aprovarCheck,
  type Contexto,
  criarObra,
  criarUsuario,
  cruzarDeNovo,
  desfazerAprovacaoDoCheck,
  type EntradaCheck,
  ERRO_SEM_IA,
  ERRO_SUBSTITUIDO,
  ErroDeCampo,
  obterCronograma,
  obterFase,
  obterRiscosDoCronograma,
  processarCruzamento,
  processarExtracao,
  processarLeituraCronograma,
  registrarCronograma,
  registrarEnvioDoCheck,
  registrarProjeto,
  registrarRespostasDoCheck,
  restaurarCronograma,
  salvarCheck,
  validarCruzamento,
  varrerParados,
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

// Fases do cronograma de exemplo (uid = ordem + 1)
const REVESTIMENTOS = 109; // 15/03/2027 a 28/05/2027, etapa Acabamentos
const COBERTURA = 49;
const PAVIMENTOS = 33;
/** A nota do DWG de exemplo é "NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO DE AR CONDICIONADO". */
const TRECHO = "PISO A DEFINIR AGUARDANDO PROJETO";

let admin: Contexto;
let eng: Contexto;
let joaoId: string;
let betoId: string;
let obraId: string;

type PerguntaIa = SaidaCruzamento["riscos"][number]["perguntas"][number];
const pergunta = (
  momento: PerguntaIa["momento"],
  texto: string,
  extra: Partial<PerguntaIa> = {},
): PerguntaIa => ({
  momento,
  texto,
  tipo: "sim_nao",
  opcoes: [],
  esperada: "Sim",
  pede_foto: false,
  ...extra,
});
const risco = (extra: Partial<SaidaCruzamento["riscos"][number]>): SaidaCruzamento["riscos"][number] => ({
  fase_uid: REVESTIMENTOS,
  nivel: "alto",
  titulo: "O piso está a definir; o contrapiso do térreo começa em 19/03",
  projeto: "ARQ-01",
  projeto_trecho: TRECHO,
  cronograma_linha: 110,
  cronograma_trecho: "Contrapiso, térreo: de 19/03/27 a 22/03/27",
  consequencia: "O contrapiso sai no nível errado para o piso que vier e precisa ser refeito.",
  perguntas: [],
  ...extra,
});

/** IA que só responde quando o teste abrir o portão: para pôr dois jobs do mesmo cruzamento lado a lado. */
function llmComPortao(roteiro: () => SaidaCruzamento) {
  let abrir = () => {};
  const portao = new Promise<void>((r) => {
    abrir = r;
  });
  let avisar = () => {};
  const chamado = new Promise<void>((r) => {
    avisar = r;
  });
  const falso = new LlmFalso({ cruzamento: roteiro });
  const llm: Llm = {
    nome: "com-portao",
    async estruturado<T>(t: TarefaEstruturada<T>) {
      avisar();
      await portao;
      return falso.estruturado(t);
    },
  };
  return { llm, chamado, abrir: () => abrir() };
}

async function checksDaFase(uid: number, hoje = "2027-03-10", obra = obraId) {
  const f = await obterFase(eng, obra, uid, hoje);
  if (!f) throw new Error(`fase ${uid} não encontrada`);
  const [antes, durante, depois] = f.checks;
  if (!antes || !durante || !depois) throw new Error("a fase não tem os três checks");
  return { fase: f, antes, durante, depois };
}

/** A entrada do formulário a partir do que a página mostra. */
const entradaDe = (c: Awaited<ReturnType<typeof checksDaFase>>["antes"]): EntradaCheck => ({
  dias: c.dias,
  hora: c.hora,
  responsavelId: c.responsavel?.id ?? null,
  perguntas: c.perguntas.map(({ id, texto, tipo, opcoes, esperada, pedeFoto }) => ({
    id,
    texto,
    tipo,
    opcoes,
    esperada,
    pedeFoto,
  })),
});

async function campoDoErro(p: Promise<unknown>): Promise<{ campo: string; mensagem: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDeCampo) return { campo: e.campo, mensagem: e.message };
    throw e;
  }
  throw new Error("esperava ErroDeCampo, mas passou");
}

const perguntasNoBanco = (checkId: string) =>
  withTenant(admin.tenantId, (tx) =>
    tx.select().from(schema.checkPergunta).where(eq(schema.checkPergunta.checkId, checkId)),
  );
const riscosDoCruzamento = async (cruzamentoId: string) =>
  (
    await withTenant(admin.tenantId, (tx) =>
      tx.select().from(schema.riscoFase).where(eq(schema.riscoFase.cruzamentoId, cruzamentoId)),
    )
  ).length;
const cruzamentoNoBanco = async (id: string) => {
  const [c] = await withTenant(admin.tenantId, (tx) =>
    tx.select().from(schema.cruzamento).where(eq(schema.cruzamento.id, id)),
  );
  if (!c) throw new Error("cruzamento sumiu");
  return c;
};
const pedidosDeCruzamento = () =>
  fila.jobs
    .filter((j) => j.nome === "cruzar_cronograma")
    .map((j) => ({ ...(j.payload as PayloadJob<"cruzar_cronograma">), opcoes: j.opcoes }));

async function obraComProjetos(nome: string, codigos: string[]) {
  const id = (await criarObra(admin, { nome, engenheiroResponsavelId: eng.usuarioId })).id;
  await adicionarMembro(eng, { obraId: id, usuarioId: joaoId });
  for (const codigo of codigos) await projetoLido(id, codigo);
  return id;
}
async function projetoLido(obra: string, codigo: string) {
  const { id } = await registrarProjeto(
    admin,
    { obraId: obra, disciplina: "arquitetura", titulo: `Planta ${codigo}`, codigo, revisao: "R0" },
    { dados: DWG, nome: `${codigo}.dwg` },
  );
  await processarExtracao(admin.tenantId, id, async () => SAIDA);
  return id;
}
async function importarCronograma(obra: string, nome: string) {
  const { id } = await registrarCronograma(admin, { obraId: obra }, { dados: XML, nome });
  await processarLeituraCronograma(admin.tenantId, id, async () => LEITURA);
  return id;
}

beforeAll(async () => {
  await garantirBucket();
  const t = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome: "Construtora Riscos",
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
  joaoId = (await criarUsuario(admin, { nome: "João", papel: "encarregado", whatsapp: `(11) 9${d(8)}` })).id;
  betoId = (await criarUsuario(admin, { nome: "Beto", papel: "encarregado", whatsapp: `(11) 9${d(8)}` })).id;
  obraId = (await criarObra(admin, { nome: "Edifício Riscos", engenheiroResponsavelId: eng.usuarioId })).id;
  await adicionarMembro(eng, { obraId, usuarioId: betoId });
  await adicionarMembro(eng, { obraId, usuarioId: joaoId });

  // projeto lido antes do cronograma: ainda não há o que cruzar
  await projetoLido(obraId, "ARQ-01");
  expect(pedidosDeCruzamento()).toEqual([]);
  await importarCronograma(obraId, "rev01.xml");
});

describe("cruzamento", () => {
  it("o cronograma lido com projeto já lido pede o cruzamento sozinho; o feliz grava riscos, checks e perguntas", async () => {
    const pedidos = pedidosDeCruzamento();
    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    if (!pedido) throw new Error("sem pedido");
    // atraso e jobId estável: um lote de DWGs vira um cruzamento só
    expect(pedido.opcoes).toEqual({ jobId: `cruz-${pedido.cruzamentoId}`, atrasoMs: 60_000 });
    const antes = await obterRiscosDoCronograma(eng, obraId, "2027-03-10");
    expect(antes.cruzamento).toMatchObject({ status: "pendente", projetos: 1 });
    expect(antes.analise).toBeNull();
    expect(antes.temProjeto).toBe(true);
    expect(antes.fases.every((f) => f.checks.length === 0)).toBe(true);

    const llm = new LlmFalso({
      cruzamento: (t) => {
        // o modelo vê a nota com a quebra de linha virada espaço, como a conferência do trecho
        const linha = t.usuario.split("\n").find((l) => l.includes("PISO A DEFINIR")) ?? "";
        expect(linha).toBe("- NOTA: PISO A DEFINIR AGUARDANDO PROJETO DE AR CONDICIONADO");
        expect(t.usuario).not.toContain(" / ");
        expect(t.usuario).toContain(
          `fase uid ${REVESTIMENTOS} · linha 108 · Revestimentos e pisos (etapa: Acabamentos)`,
        );
        expect(t.usuario).toContain("  - linha 110 · Contrapiso, térreo · 2027-03-19 a 2027-03-22 · 0%");
        expect(t.usuario).not.toContain("CONSTRUTORA EXEMPLO LTDA"); // carimbo fica de fora
        // e cita copiando do que viu: um trecho que atravessa a quebra de linha do texto original
        const citado = linha.slice(linha.indexOf("PISO"), linha.indexOf(" DE AR"));
        return {
          riscos: [
            risco({
              projeto_trecho: citado,
              perguntas: [
                pergunta("antes", "O piso do térreo já foi definido?"),
                pergunta("antes", "Qual piso vai no térreo?", {
                  tipo: "opcao",
                  opcoes: ["Porcelanato", "Vinílico", "Ainda não sei"],
                  esperada: "porcelanato",
                }),
                pergunta("durante", "Nível do contrapiso no centro da sala", {
                  tipo: "medida",
                  opcoes: ["m"],
                  esperada: "0.02..0.04",
                  pede_foto: true,
                }),
                // medida sem unidade (vai em opcoes[0]) não entra
                pergunta("durante", "Espessura do contrapiso", { tipo: "medida", esperada: "3..5" }),
                pergunta("depois", "Até quando o piso foi entregue?", {
                  tipo: "data",
                  esperada: "<=2027-04-30",
                }),
                pergunta("depois", "Qual o acabamento?", {
                  tipo: "opcao",
                  opcoes: ["Uma opção comprida demais para caber no Flow", "Outra"],
                  esperada: null,
                }),
              ],
            }),
            risco({
              titulo: "Trecho inventado",
              fase_uid: PAVIMENTOS,
              projeto_trecho: "ESCORAMENTO POR 21 DIAS",
            }),
            risco({ titulo: "Fase que não existe", fase_uid: 9999 }),
            risco({ titulo: "Marco não é fase", fase_uid: 142 }),
            risco({ titulo: "Projeto fora do material", projeto: "EST-99" }),
          ],
        };
      },
    });
    expect(await processarCruzamento(admin.tenantId, pedido.cruzamentoId, llm)).toEqual({
      status: "concluida",
      riscos: 1,
    });
    // repetir o job não duplica nada
    expect(await processarCruzamento(admin.tenantId, pedido.cruzamentoId, llm)).toEqual({
      status: "ignorada",
    });

    const r = await obterRiscosDoCronograma(eng, obraId, "2027-03-10");
    expect(r.cruzamento).toMatchObject({
      id: pedido.cruzamentoId,
      status: "concluida",
      erro: null,
      projetos: 1,
    });
    expect(r.analise).toMatchObject({ projetos: 1, riscos: 1, fases: 1, perguntas: 4 });
    expect(r.fases).toHaveLength(9); // as linhas de nível 2 do cronograma de exemplo
    expect(r.fases.every((f) => f.checks.length === 3)).toBe(true);
    expect(r.fases.find((f) => f.uid === REVESTIMENTOS)).toEqual({
      uid: REVESTIMENTOS,
      nivel: "alto",
      riscos: 1,
      checks: [
        {
          momento: "antes",
          estado: "aprovar",
          saiEm: "2027-03-12",
          hora: "07:00",
          perguntas: 2,
          responsavel: "João",
        },
        {
          momento: "durante",
          estado: "sugerido",
          saiEm: "2027-03-22",
          hora: "07:00",
          perguntas: 1,
          responsavel: "João",
        },
        {
          momento: "depois",
          estado: "sugerido",
          saiEm: "2027-05-31",
          hora: "07:00",
          perguntas: 1,
          responsavel: "João",
        },
      ],
    });
    expect(r.fases.find((f) => f.uid === PAVIMENTOS)).toMatchObject({ nivel: null, riscos: 0 });

    const c = await cruzamentoNoBanco(pedido.cruzamentoId);
    expect(c.geradoPor).toBe("claude-opus-5-5@cruzamento-v1");
    expect(c.iniciadoEm).not.toBeNull();
    const custos = await withTenant(admin.tenantId, (tx) =>
      tx
        .select({ referencia: schema.eventoCusto.referencia })
        .from(schema.eventoCusto)
        .where(eq(schema.eventoCusto.obraId, obraId)),
    );
    expect(custos.map((x) => x.referencia)).toContain("claude-opus-5-5@cruzamento-v1");
  });

  it("a página da fase traz a prova do risco, as perguntas e a equipe", async () => {
    const { fase, antes, durante, depois } = await checksDaFase(REVESTIMENTOS);
    expect(fase).toMatchObject({
      nome: "Revestimentos e pisos",
      etapa: "Acabamentos",
      inicio: "2027-03-15",
      termino: "2027-05-28",
      versaoNumero: 1,
      nivel: "alto",
    });
    expect(fase.riscos).toEqual([
      expect.objectContaining({
        codigo: "R1",
        nivel: "alto",
        projeto: expect.objectContaining({ codigo: "ARQ-01", revisao: "R0", tipoArquivo: "dwg" }),
        projetoTrecho: TRECHO,
        cronogramaLinha: 110,
        cronogramaInicio: "2027-03-19",
        cronogramaTermino: "2027-03-22",
        situacao: null,
      }),
    ]);
    expect(antes).toMatchObject({ estado: "aprovar", dias: 3, datas: ["2027-03-12"], proxima: "2027-03-12" });
    expect(antes.responsavel).toEqual({ id: joaoId, nome: "João" }); // o primeiro encarregado da equipe
    expect(antes.perguntas.map((p) => [p.texto, p.tipo, p.esperada, p.riscos])).toEqual([
      ["O piso do térreo já foi definido?", "sim_nao", "Sim", ["R1"]],
      ["Qual piso vai no térreo?", "opcao", "porcelanato", ["R1"]],
    ]);
    expect(durante.datas).toHaveLength(10); // segundas de 22/03 a 24/05
    expect(durante.perguntas).toHaveLength(1);
    expect(durante.perguntas[0]).toMatchObject({
      tipo: "medida",
      opcoes: ["m"],
      esperada: "0.02..0.04",
      pedeFoto: true,
    });
    // a pergunta com opção acima de 30 caracteres não entrou
    expect(depois.perguntas.map((p) => p.texto)).toEqual(["Até quando o piso foi entregue?"]);
    expect(fase.responsaveis.map((u) => u.nome)).toEqual(["João", "Beto"]);
    expect(fase.responsaveis.every((u) => u.papel === "encarregado")).toBe(true);

    expect(await obterFase(eng, obraId, 110, "2027-03-10")).toBeNull(); // tarefa, não fase
    expect(await obterFase(eng, obraId, 9999, "2027-03-10")).toBeNull();
  });

  it("sem LLM: o cruzamento falha com o motivo, sem retry, e a análise anterior continua", async () => {
    await expect(cruzarDeNovo({ ...eng, papel: "encarregado" }, obraId)).rejects.toThrow(/permissão/);
    fila.limpar();
    const { id } = await cruzarDeNovo(eng, obraId);
    expect(await cruzarDeNovo(eng, obraId)).toEqual({ id }); // o pendente é o mesmo
    // o botão sai sem atraso
    expect(pedidosDeCruzamento()).toEqual([
      { tenantId: admin.tenantId, cruzamentoId: id, opcoes: { jobId: `cruz-${id}-agora` } },
    ]);
    expect(await processarCruzamento(admin.tenantId, id, null)).toEqual({ status: "falhou" });
    expect(await processarCruzamento(admin.tenantId, id, null)).toEqual({ status: "ignorada" });
    const r = await obterRiscosDoCronograma(eng, obraId, "2027-03-10");
    expect(r.cruzamento).toMatchObject({ id, status: "falhou", erro: ERRO_SEM_IA });
    expect(r.analise).toMatchObject({ riscos: 1 });

    const semCronograma = (
      await criarObra(admin, { nome: "Obra vazia", engenheiroResponsavelId: eng.usuarioId })
    ).id;
    await expect(cruzarDeNovo(eng, semCronograma)).rejects.toThrow(/cronograma vigente/);
    expect(await obterRiscosDoCronograma(eng, semCronograma, "2027-03-10")).toEqual({
      temProjeto: false,
      cruzamento: null,
      analise: null,
      fases: [],
    });
  });
});

describe("limites na saída da IA", () => {
  it("pergunta longa demais ou com opções demais sai; título e consequência são cortados na palavra", () => {
    const titulo = `O projeto pede escoramento ${"prolongado ".repeat(20)}e o cronograma não`;
    const consequencia = `A laje ${"fissura ".repeat(50)}e precisa de reforço`;
    const opcoes = (n: number) => Array.from({ length: n }, (_, i) => `Opção ${i + 1}`);
    const { riscos } = validarCruzamento(
      {
        riscos: [
          risco({
            titulo,
            consequencia,
            perguntas: [
              pergunta("antes", "x".repeat(301)),
              pergunta("antes", "y".repeat(300)),
              pergunta("antes", "Onze opções?", { tipo: "opcao", opcoes: opcoes(11), esperada: null }),
              pergunta("antes", "Dez opções?", { tipo: "opcao", opcoes: opcoes(10), esperada: null }),
            ],
          }),
        ],
      },
      {
        fases: [{ uid: REVESTIMENTOS }],
        projetos: [{ id: "p1", codigo: "ARQ-01", textos: ["NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO"] }],
        linhas: new Set([110]),
      },
    );
    const [r] = riscos;
    if (!r) throw new Error("o risco devia passar");
    expect(r.perguntas.map((p) => p.texto)).toEqual(["y".repeat(300), "Dez opções?"]);
    for (const [cortado, original, maximo] of [
      [r.titulo, titulo, 160],
      [r.consequencia, consequencia, 300],
    ] as const) {
      expect(cortado.length).toBeLessThanOrEqual(maximo);
      expect(cortado.endsWith("…")).toBe(true);
      const semReticencias = cortado.slice(0, -1);
      expect(original.startsWith(semReticencias)).toBe(true);
      expect(original[semReticencias.length]).toBe(" "); // cortou numa palavra inteira
    }
  });
});

describe("edição do check", () => {
  it("valida cada campo e devolve o caminho dele", async () => {
    const { antes, durante } = await checksDaFase(REVESTIMENTOS);
    const base = entradaDe(antes);
    const com = (extra: Partial<EntradaCheck["perguntas"][number]>) => ({
      ...base,
      perguntas: [
        {
          texto: "Pergunta",
          tipo: "sim_nao" as const,
          opcoes: [],
          esperada: null,
          pedeFoto: false,
          ...extra,
        },
      ],
    });

    const vazia = { texto: "  ", tipo: "sim_nao" as const, opcoes: [], esperada: null, pedeFoto: false };
    expect(
      await campoDoErro(salvarCheck(eng, antes.id, { ...base, perguntas: [...base.perguntas, vazia] })),
    ).toEqual({ campo: "perguntas.2.texto", mensagem: "Escreva a pergunta ou tire-a da lista." });
    expect(
      (
        await campoDoErro(
          salvarCheck(eng, antes.id, {
            ...base,
            perguntas: Array.from({ length: 10 }, (_, i) => ({
              texto: `Pergunta ${i}`,
              tipo: "texto" as const,
              opcoes: [],
              esperada: null,
              pedeFoto: false,
            })),
          }),
        )
      ).campo,
    ).toBe("perguntas");
    expect(
      await campoDoErro(salvarCheck(eng, antes.id, com({ tipo: "opcao", opcoes: ["Sim", "x".repeat(31)] }))),
    ).toEqual({ campo: "perguntas.0.opcoes.1", mensagem: "Cada opção pode ter até 30 caracteres." });
    expect(
      (await campoDoErro(salvarCheck(eng, antes.id, com({ tipo: "opcao", opcoes: ["Só uma"] })))).campo,
    ).toBe("perguntas.0.opcoes");
    expect(
      (
        await campoDoErro(
          salvarCheck(
            eng,
            antes.id,
            com({ tipo: "opcao", opcoes: Array.from({ length: 11 }, (_, i) => `${i}`) }),
          ),
        )
      ).campo,
    ).toBe("perguntas.0.opcoes");
    expect(await campoDoErro(salvarCheck(eng, antes.id, com({ tipo: "medida", esperada: "1..2" })))).toEqual({
      campo: "perguntas.0.opcoes",
      mensagem: "Escolha a unidade da medida: m, cm ou mm.",
    });
    expect(
      (
        await campoDoErro(
          salvarCheck(eng, antes.id, com({ tipo: "medida", opcoes: ["km"], esperada: "1..2" })),
        )
      ).campo,
    ).toBe("perguntas.0.opcoes");
    expect((await campoDoErro(salvarCheck(eng, antes.id, { ...base, hora: "7h" }))).campo).toBe("hora");
    expect((await campoDoErro(salvarCheck(eng, antes.id, { ...base, hora: "24:00" }))).campo).toBe("hora");
    expect((await campoDoErro(salvarCheck(eng, durante.id, { ...entradaDe(durante), dias: 8 }))).campo).toBe(
      "dias",
    );
    expect(
      (await campoDoErro(salvarCheck(eng, antes.id, { ...base, responsavelId: eng.usuarioId }))).campo,
    ).toBe("responsavelId");
    expect(
      (await campoDoErro(salvarCheck(eng, antes.id, com({ tipo: "data", esperada: "até 02/11" })))).campo,
    ).toBe("perguntas.0.esperada");
    expect(
      (
        await campoDoErro(
          salvarCheck(eng, antes.id, com({ tipo: "opcao", opcoes: ["A", "B"], esperada: "C" })),
        )
      ).campo,
    ).toBe("perguntas.0.esperada");
    await expect(salvarCheck({ ...eng, papel: "encarregado" }, antes.id, base)).rejects.toThrow(/permissão/);
    // nada do que falhou ficou gravado, nem a marca de editado
    expect((await checksDaFase(REVESTIMENTOS)).antes.perguntas).toEqual(antes.perguntas);
    const [k] = await withTenant(admin.tenantId, (tx) =>
      tx.select().from(schema.checkFase).where(eq(schema.checkFase.id, antes.id)),
    );
    expect(k?.editadoEm).toBeNull();
  });

  it("recruzar troca só os checks em aberto; editado e aprovado ficam, e as perguntas deles seguem o mesmo risco", async () => {
    const { fase, antes, durante, depois } = await checksDaFase(REVESTIMENTOS);
    const riscoAntigo = fase.riscos[0]?.id;
    const [primeira, segunda] = entradaDe(antes).perguntas;
    if (!primeira || !segunda) throw new Error("faltam perguntas");
    // editar = tirar uma sugestão, mudar a ordem e pôr uma pergunta do engenheiro
    await salvarCheck(eng, antes.id, {
      ...entradaDe(antes),
      perguntas: [
        segunda,
        {
          texto: "O nível da laje foi conferido?",
          tipo: "sim_nao",
          opcoes: [],
          esperada: "Sim",
          pedeFoto: true,
        },
      ],
    });
    await aprovarCheck(eng, durante.id);
    const depoisComoNaTela = entradaDe(depois);

    const { id } = await cruzarDeNovo(eng, obraId);
    const llm = new LlmFalso({
      cruzamento: () => ({
        riscos: [
          risco({
            titulo: "O piso segue a definir",
            // o mesmo trecho com outro espaçamento: é o mesmo risco
            projeto_trecho: "PISO A DEFINIR  AGUARDANDO   PROJETO",
            perguntas: [
              pergunta("antes", "Pergunta nova do antes?"),
              pergunta("durante", "Pergunta nova do durante?"),
              ...Array.from({ length: 10 }, (_, i) => pergunta("depois", `Nova pergunta ${i + 1}?`)),
            ],
          }),
        ],
      }),
    });
    expect(await processarCruzamento(admin.tenantId, id, llm)).toEqual({ status: "concluida", riscos: 1 });

    const agora = await checksDaFase(REVESTIMENTOS);
    const riscoNovo = agora.fase.riscos[0]?.id;
    expect(agora.fase.riscos.map((r) => r.titulo)).toEqual(["O piso segue a definir"]);
    expect(riscoNovo).not.toBe(riscoAntigo);
    // editado: a sugestão tirada continua fora e a ordem do engenheiro fica
    expect(agora.antes.perguntas.map((p) => [p.texto, p.riscos])).toEqual([
      ["Qual piso vai no térreo?", ["R1"]],
      ["O nível da laje foi conferido?", []],
    ]);
    // aprovado: intocado
    expect(agora.durante).toMatchObject({ estado: "agendado", aprovadoPor: "Eng. Rita" });
    expect(agora.durante.perguntas.map((p) => [p.texto, p.riscos])).toEqual([
      ["Nível do contrapiso no centro da sala", ["R1"]],
    ]);
    // e as perguntas que ficaram apontam para o risco novo, não para o antigo
    const ligadas = [...(await perguntasNoBanco(antes.id)), ...(await perguntasNoBanco(durante.id))].filter(
      (p) => p.riscoId,
    );
    expect(ligadas.map((p) => p.riscoId)).toEqual([riscoNovo, riscoNovo]);
    // em aberto: as sugestões novas entram, no máximo 9 por envio
    expect(agora.depois.perguntas.map((p) => p.texto)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Nova pergunta ${i + 1}?`),
    );
    expect(agora.depois.perguntas.every((p) => p.riscos[0] === "R1")).toBe(true);

    // quem estava com a tela aberta antes do recruzamento não salva por cima
    await expect(salvarCheck(eng, depois.id, depoisComoNaTela)).rejects.toMatchObject({
      codigo: "conflito",
      message: "As perguntas deste check mudaram. Recarregue a página e edite de novo.",
    });
    expect((await checksDaFase(REVESTIMENTOS)).depois.perguntas).toHaveLength(9);
  });
});

describe("aprovação", () => {
  it("pede pergunta, responsável e data; não aprova duas vezes; desfaz enquanto não saiu", async () => {
    const { antes } = await checksDaFase(REVESTIMENTOS);
    const semPergunta = (await checksDaFase(PAVIMENTOS)).antes;
    await expect(aprovarCheck(eng, semPergunta.id)).rejects.toThrow(/pelo menos uma pergunta/);

    await salvarCheck(eng, antes.id, { ...entradaDe(antes), responsavelId: null });
    await expect(aprovarCheck(eng, antes.id)).rejects.toThrow(/quem responde/);
    await salvarCheck(eng, antes.id, { ...entradaDe(antes), responsavelId: betoId });
    expect(await aprovarCheck(eng, antes.id)).toEqual({ saiEm: "2027-03-12" });
    await expect(aprovarCheck(eng, antes.id)).rejects.toThrow(/já está aprovado/);
    expect((await checksDaFase(REVESTIMENTOS)).antes).toMatchObject({
      estado: "agendado",
      aprovadoPor: "Eng. Rita",
      responsavel: { id: betoId, nome: "Beto" },
    });

    await desfazerAprovacaoDoCheck(eng, antes.id);
    await expect(desfazerAprovacaoDoCheck(eng, antes.id)).rejects.toThrow(/não está aprovado/);
    expect((await checksDaFase(REVESTIMENTOS)).antes).toMatchObject({ estado: "aprovar", aprovadoEm: null });

    // editar um aprovado que ainda não saiu tira a aprovação
    await aprovarCheck(eng, antes.id);
    await salvarCheck(eng, antes.id, {
      ...entradaDe((await checksDaFase(REVESTIMENTOS)).antes),
      hora: "06:30",
    });
    expect((await checksDaFase(REVESTIMENTOS)).antes).toMatchObject({ hora: "06:30", aprovadoEm: null });
    await expect(aprovarCheck({ ...eng, papel: "encarregado" }, antes.id)).rejects.toThrow(/permissão/);
    await aprovarCheck(eng, antes.id);
  });

  it("fase sem a data da regra: sem saída e sem aprovação", async () => {
    const { versoes } = await obterCronograma(eng, obraId);
    await comDono(urlsDeTeste().dono, (db) =>
      db
        .update(schema.cronogramaTarefa)
        .set({ inicio: null, termino: null })
        .where(
          and(
            eq(schema.cronogramaTarefa.versaoId, versoes[0]?.id ?? ""),
            eq(schema.cronogramaTarefa.uid, COBERTURA),
          ),
        ),
    );
    const { antes } = await checksDaFase(COBERTURA);
    expect(antes).toMatchObject({ estado: "sugerido", datas: [], proxima: null });
    await salvarCheck(eng, antes.id, {
      ...entradaDe(antes),
      perguntas: [
        { texto: "A manta chegou?", tipo: "sim_nao", opcoes: [], esperada: "Sim", pedeFoto: false },
      ],
    });
    await expect(aprovarCheck(eng, antes.id)).rejects.toThrow(/data/);
    const noGantt = (await obterRiscosDoCronograma(eng, obraId, "2027-03-10")).fases.find(
      (f) => f.uid === COBERTURA,
    );
    expect(noGantt?.checks.map((c) => [c.estado, c.saiEm])).toEqual([
      ["sugerido", null],
      ["sugerido", null],
      ["sugerido", null],
    ]);
  });
});

describe("envio e resposta", () => {
  it("com o envio na rua, tirar e editar preservam a pergunta antiga, que ainda pode ser respondida", async () => {
    const { antes, depois } = await checksDaFase(REVESTIMENTOS);
    await expect(
      registrarEnvioDoCheck(admin.tenantId, depois.id, { previstoPara: "2027-05-31", enviadoEm: new Date() }),
    ).rejects.toThrow(/aprovado/);

    const { id: envioId } = await registrarEnvioDoCheck(admin.tenantId, antes.id, {
      previstoPara: "2027-03-12",
      // saiu há uma hora: o que o engenheiro mexer agora é depois do envio
      enviadoEm: new Date(Date.now() - 60 * 60_000),
      entrega: "lido",
      lidoEm: new Date(Date.now() - 34 * 60_000),
    });
    await expect(desfazerAprovacaoDoCheck(eng, antes.id)).rejects.toThrow(/já saiu/);
    const naObra = (await checksDaFase(REVESTIMENTOS, "2027-03-12")).antes;
    expect(naObra.estado).toBe("naobra");
    expect(naObra.envios).toEqual([
      expect.objectContaining({ id: envioId, entrega: "lido", respondidoEm: null, total: 2, respostas: [] }),
    ]);

    // nenhuma das duas tem resposta ainda, mas as duas já foram para a obra
    const [qualPiso, nivelDaLaje] = naObra.perguntas;
    if (!qualPiso || !nivelDaLaje) throw new Error("faltam perguntas");
    await salvarCheck(eng, antes.id, {
      ...entradaDe(naObra),
      perguntas: [
        { ...entradaDe(naObra).perguntas[0], texto: "Qual piso vai no térreo, conforme a ARQ-01?" },
      ] as EntradaCheck["perguntas"],
    });
    const noBanco = await perguntasNoBanco(antes.id);
    expect(noBanco.map((p) => [p.texto, p.removidaEm !== null]).sort()).toEqual([
      ["O nível da laje foi conferido?", true],
      ["Qual piso vai no térreo, conforme a ARQ-01?", false],
      ["Qual piso vai no térreo?", true],
    ]);
    const editada = noBanco.find((p) => p.removidaEm === null);
    expect(editada?.riscoId).toBe(noBanco.find((p) => p.id === qualPiso.id)?.riscoId);
    expect((await checksDaFase(REVESTIMENTOS, "2027-03-12")).antes.aprovadoEm).not.toBeNull(); // já saiu

    await expect(
      registrarRespostasDoCheck(admin.tenantId, envioId, {
        respondidoPorId: betoId,
        respondidoEm: new Date(),
        respostas: [{ perguntaId: depois.perguntas[0]?.id ?? "", valor: "Sim" }],
      }),
    ).rejects.toThrow(/não é deste check/);
    const r = await registrarRespostasDoCheck(admin.tenantId, envioId, {
      respondidoPorId: betoId,
      respondidoEm: new Date(),
      respostas: [
        { perguntaId: qualPiso.id, valor: "Vinílico", observacao: "  O cliente mudou de ideia.  " },
        { perguntaId: nivelDaLaje.id, valor: "Sim" },
      ],
    });
    expect(r).toEqual({ foraDoEsperado: 1 });
    await expect(
      registrarRespostasDoCheck(admin.tenantId, envioId, {
        respondidoPorId: betoId,
        respondidoEm: new Date(),
        respostas: [],
      }),
    ).rejects.toThrow(/já foi respondido/);

    const { fase, antes: respondido } = await checksDaFase(REVESTIMENTOS, "2027-03-12");
    expect(respondido.estado).toBe("alerta");
    expect(respondido.perguntas.map((p) => [p.texto, p.riscos])).toEqual([
      ["Qual piso vai no térreo, conforme a ARQ-01?", ["R1"]],
    ]);
    const [envio] = respondido.envios;
    expect(envio).toMatchObject({ respondidoPor: "Beto", foraDoEsperado: 1, total: 2 });
    expect(envio?.respostas).toEqual([
      {
        perguntaId: qualPiso.id,
        texto: "Qual piso vai no térreo?", // o que foi perguntado, não o texto editado depois
        valor: "Vinílico",
        dentro: false,
        observacao: "O cliente mudou de ideia.",
        temFoto: false,
        riscos: ["R1"],
      },
      {
        perguntaId: nivelDaLaje.id,
        texto: "O nível da laje foi conferido?",
        valor: "sim", // sim ou não fica gravado como sim/nao
        dentro: true,
        observacao: null,
        temFoto: false,
        riscos: [],
      },
    ]);
    expect(fase.riscos[0]?.situacao).toEqual({ tipo: "em_aberto", momento: "antes" });
    const noGantt = (await obterRiscosDoCronograma(eng, obraId, "2027-03-12")).fases.find(
      (f) => f.uid === REVESTIMENTOS,
    );
    expect(noGantt?.checks.map((c) => c.estado)).toEqual(["alerta", "agendado", "sugerido"]);
  });

  it("recruzamento cujo risco não tem par: a pergunta que ficou sai sem etiqueta, nunca com a de outro risco", async () => {
    const { id } = await cruzarDeNovo(eng, obraId);
    const llm = new LlmFalso({
      cruzamento: () => ({
        riscos: [
          risco({
            titulo: "A referência de nível do térreo não bate com a do contrapiso",
            projeto_trecho: "N.A. +3,05",
            perguntas: [pergunta("depois", "O contrapiso ficou no N.A. +3,05?")],
          }),
        ],
      }),
    });
    expect(await processarCruzamento(admin.tenantId, id, llm)).toEqual({ status: "concluida", riscos: 1 });
    const { fase, antes, durante, depois } = await checksDaFase(REVESTIMENTOS, "2027-03-12");
    expect(fase.riscos.map((r) => [r.codigo, r.projetoTrecho, r.situacao])).toEqual([
      ["R1", "N.A. +3,05", null],
    ]);
    expect(antes.perguntas[0]?.riscos).toEqual([]);
    expect(antes.envios[0]?.respostas.map((r) => r.riscos)).toEqual([[], []]);
    expect(durante.perguntas[0]?.riscos).toEqual([]);
    expect(depois.perguntas.map((p) => [p.texto, p.riscos])).toEqual([
      ["O contrapiso ficou no N.A. +3,05?", ["R1"]],
    ]);
  });
});

describe("cruzamentos da mesma obra", () => {
  let obraLote: string;
  const roteiro = () => ({
    riscos: [risco({ projeto: "ARQ-10", perguntas: [pergunta("antes", "O piso já foi definido?")] })],
  });
  const falso = () => new LlmFalso({ cruzamento: roteiro });
  const pendentes = (obra = obraLote) =>
    withTenant(admin.tenantId, (tx) =>
      tx
        .select()
        .from(schema.cruzamento)
        .where(and(eq(schema.cruzamento.obraId, obra), eq(schema.cruzamento.status, "pendente"))),
    );

  beforeAll(async () => {
    obraLote = await obraComProjetos("Edifício Lote", ["ARQ-10", "ARQ-11"]);
    fila.limpar();
    await importarCronograma(obraLote, "lote-rev01.xml");
  });

  it("no máximo um pendente por obra: um lote de DWGs e uma versão nova viram um cruzamento só", async () => {
    const [pedido, ...outros] = pedidosDeCruzamento();
    expect(outros).toEqual([]);
    if (!pedido) throw new Error("sem pedido");
    expect(pedido.opcoes).toEqual({ jobId: `cruz-${pedido.cruzamentoId}`, atrasoMs: 60_000 });

    await projetoLido(obraLote, "ARQ-12"); // mais um DWG do lote
    await importarCronograma(obraLote, "lote-rev02.xml"); // e uma versão nova
    expect(pedidosDeCruzamento()).toHaveLength(1); // o mesmo jobId: entra uma vez só
    const [pendente, ...mais] = await pendentes();
    expect(mais).toEqual([]);
    const { vigente } = await obterCronograma(eng, obraLote);
    expect(pendente).toMatchObject({
      id: pedido.cruzamentoId,
      cronogramaVersaoId: vigente?.id,
      projetos: [],
    });

    expect(await processarCruzamento(admin.tenantId, pedido.cruzamentoId, falso())).toMatchObject({
      status: "concluida",
    });
    // o retrato dos projetos é tirado quando o job começa: os três do lote
    const c = await cruzamentoNoBanco(pedido.cruzamentoId);
    expect((c.projetos as { codigo: string }[]).map((p) => p.codigo)).toEqual(["ARQ-10", "ARQ-11", "ARQ-12"]);
  });

  it("a fase diz qual versão o cruzamento em uso leu, que pode não ser a vigente", async () => {
    const outra = await obraComProjetos("Edifício Versões", ["ARQ-10"]);
    await importarCronograma(outra, "versoes-rev01.xml");
    const [pedido] = (await pendentes(outra)).map((c) => c.id);
    expect(await processarCruzamento(admin.tenantId, pedido ?? "", falso())).toMatchObject({
      status: "concluida",
    });
    expect(await obterFase(eng, outra, REVESTIMENTOS, "2027-03-10")).toMatchObject({
      versaoNumero: 1,
      versaoCruzada: 1,
    });
    // a v2 chega e o cruzamento dela ainda não concluiu: a prova continua sendo da v1
    await importarCronograma(outra, "versoes-rev02.xml");
    expect(await obterFase(eng, outra, REVESTIMENTOS, "2027-03-10")).toMatchObject({
      versaoNumero: 2,
      versaoCruzada: 1,
    });
    expect((await obterRiscosDoCronograma(eng, outra, "2027-03-10")).cruzamento?.status).toBe("pendente");
  });

  it("dois jobs do mesmo cruzamento: o segundo é ignorado, e o dono que perdeu a vez não grava", async () => {
    const { id } = await cruzarDeNovo(eng, obraLote);
    const lento = llmComPortao(roteiro);
    const primeiro = processarCruzamento(admin.tenantId, id, lento.llm);
    await lento.chamado; // o primeiro tomou o cruzamento e está esperando a IA
    expect(await processarCruzamento(admin.tenantId, id, falso())).toEqual({ status: "ignorada" });
    expect((await cruzamentoNoBanco(id)).status).toBe("processando");

    // o primeiro some por mais de 15 minutos: outro job retoma e conclui
    await withTenant(admin.tenantId, (tx) =>
      tx
        .update(schema.cruzamento)
        .set({ iniciadoEm: new Date(Date.now() - 20 * 60_000) })
        .where(eq(schema.cruzamento.id, id)),
    );
    expect(await processarCruzamento(admin.tenantId, id, falso())).toEqual({
      status: "concluida",
      riscos: 1,
    });
    lento.abrir();
    expect(await primeiro).toEqual({ status: "ignorada" });
    expect(await riscosDoCruzamento(id)).toBe(1); // nada em dobro
    expect((await cruzamentoNoBanco(id)).status).toBe("concluida");
  });

  it("o antigo que termina depois de um mais novo é substituído e não vira a análise", async () => {
    const { id: antigo } = await cruzarDeNovo(eng, obraLote);
    const lento = llmComPortao(roteiro);
    const doAntigo = processarCruzamento(admin.tenantId, antigo, lento.llm);
    await lento.chamado;
    const { id: novo } = await cruzarDeNovo(eng, obraLote); // o antigo já está processando
    expect(novo).not.toBe(antigo);
    expect(await processarCruzamento(admin.tenantId, novo, falso())).toEqual({
      status: "concluida",
      riscos: 1,
    });
    lento.abrir();
    expect(await doAntigo).toEqual({ status: "falhou" });
    expect(await cruzamentoNoBanco(antigo)).toMatchObject({ status: "falhou", erro: ERRO_SUBSTITUIDO });
    expect(await riscosDoCruzamento(antigo)).toBe(0);
    const r = await obterRiscosDoCronograma(eng, obraLote, "2027-03-10");
    expect(r.cruzamento?.id).toBe(novo);
    expect(r.analise).toMatchObject({ riscos: 1 });
  });

  it("versão que deixa de ser a vigente no meio: substituído; e restaurar com a fila fora não cai", async () => {
    const { id } = await cruzarDeNovo(eng, obraLote);
    const lento = llmComPortao(roteiro);
    const emAndamento = processarCruzamento(admin.tenantId, id, lento.llm);
    await lento.chamado;

    const v1 = (await obterCronograma(eng, obraLote)).versoes.find((v) => v.numero === 1);
    definirFila({
      enfileirar: async () => {
        throw new Error("Redis fora do ar");
      },
    });
    try {
      expect(await restaurarCronograma(eng, v1?.id ?? "")).toEqual({ numero: 1 });
    } finally {
      definirFila(fila);
    }
    // o pedido ficou no banco, para a varredura reenfileirar
    expect((await pendentes()).map((c) => c.cronogramaVersaoId)).toEqual([v1?.id]);

    lento.abrir();
    expect(await emAndamento).toEqual({ status: "falhou" });
    expect(await cruzamentoNoBanco(id)).toMatchObject({ status: "falhou", erro: ERRO_SUBSTITUIDO });
    expect(await riscosDoCruzamento(id)).toBe(0);
  });
});

describe("isolamento", () => {
  it("outra construtora não vê nem mexe nos riscos, checks, envios e respostas", async () => {
    const outro = await comDono(urlsDeTeste().dono, (db) =>
      criarTenantComAdmin(db, {
        nome: "Outra Construtora",
        cnpj: d(14),
        admin: { nome: "Admin", email: `o${d(8)}@t.test`, whatsappE164: `+55119${d(8)}` },
      }),
    );
    const ctx: Contexto = { tenantId: outro.tenantId, usuarioId: outro.adminUsuarioId, papel: "admin" };
    const { antes } = await checksDaFase(REVESTIMENTOS);
    const envioId = antes.envios[0]?.id ?? "";

    expect(await obterRiscosDoCronograma(ctx, obraId, "2027-03-10")).toEqual({
      temProjeto: false,
      cruzamento: null,
      analise: null,
      fases: [],
    });
    expect(await obterFase(ctx, obraId, REVESTIMENTOS, "2027-03-10")).toBeNull();
    await expect(salvarCheck(ctx, antes.id, entradaDe(antes))).rejects.toThrow(/não encontrado/);
    await expect(aprovarCheck(ctx, antes.id)).rejects.toThrow(/não encontrado/);
    await expect(cruzarDeNovo(ctx, obraId)).rejects.toThrow(/Obra não encontrada/);
    await expect(
      registrarRespostasDoCheck(outro.tenantId, envioId, {
        respondidoPorId: ctx.usuarioId,
        respondidoEm: new Date(),
        respostas: [],
      }),
    ).rejects.toThrow(/não encontrado/);
    const [c] = await withTenant(admin.tenantId, (tx) => tx.select().from(schema.cruzamento).limit(1));
    expect(await processarCruzamento(outro.tenantId, c?.id ?? "", null)).toEqual({ status: "ignorada" });

    const vistos = await withTenant(outro.tenantId, async (tx) => ({
      cruzamentos: await tx.select().from(schema.cruzamento),
      riscos: await tx.select().from(schema.riscoFase),
      checks: await tx.select().from(schema.checkFase),
      perguntas: await tx.select().from(schema.checkPergunta),
      envios: await tx.select().from(schema.checkEnvio),
      respostas: await tx.select().from(schema.checkResposta),
    }));
    expect(vistos).toEqual({
      cruzamentos: [],
      riscos: [],
      checks: [],
      perguntas: [],
      envios: [],
      respostas: [],
    });
  });
});

describe("varredura", () => {
  it("cruzamento pendente sem job, ou processando parado há mais de 15 minutos, volta para a fila", async () => {
    const { versoes } = await obterCronograma(eng, obraId);
    const criar = (valores: Partial<typeof schema.cruzamento.$inferInsert>) =>
      withTenant(admin.tenantId, async (tx) => {
        const [c] = await tx
          .insert(schema.cruzamento)
          .values({ tenantId: admin.tenantId, obraId, cronogramaVersaoId: versoes[0]?.id ?? "", ...valores })
          .returning({ id: schema.cruzamento.id });
        return c?.id;
      });
    const parado = await criar({ criadoEm: new Date(Date.now() - 15 * 60_000) });
    const caiu = await criar({ status: "processando", iniciadoEm: new Date(Date.now() - 20 * 60_000) });
    const andando = await criar({ status: "processando", iniciadoEm: new Date() });
    fila.limpar();
    await varrerParados(3);
    const ids = fila.doTipo("cruzar_cronograma").map((p) => p.cruzamentoId);
    expect(ids).toEqual(expect.arrayContaining([parado, caiu]));
    expect(ids).not.toContain(andando);
  });
});
