import { randomUUID } from "node:crypto";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import { idJob, obterFila } from "@canteirocheck/queue";
import { chaveDoTenant, gravarObjeto, lerObjeto } from "@canteirocheck/storage";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ator, type Contexto, ErroDominio, exigirPapel } from "./contexto";
import { uuid } from "./validacao";

const { cronogramaVersao, cronogramaTarefa, obra, usuario } = schema;

export const TAMANHO_MAXIMO_CRONOGRAMA = 60 * 1024 * 1024;
/** Acima disso a tela não desenha e a leitura provavelmente pegou o arquivo errado. */
const MAXIMO_DE_TAREFAS = 20_000;
const LOTE = 1000;

/**
 * Tipo pelo conteúdo (não pela extensão): o MPP é um arquivo composto OLE; o XML do MS Project
 * (MSPDI) declara o namespace `schemas.microsoft.com/project` logo no começo.
 */
export function tipoDoCronograma(dados: Uint8Array): "mpp" | "xml" | null {
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (OLE.every((b, i) => dados[i] === b)) return "mpp";
  const inicio = Buffer.from(dados.subarray(0, 4096)).toString("utf8").replace(/^﻿/, "").trimStart();
  if (inicio.startsWith("<") && inicio.includes("schemas.microsoft.com/project")) return "xml";
  return null;
}

/** Só o nome do arquivo, sem caminho nem caractere de controle. */
function nomeLimpo(nome: string): string {
  const base = (nome.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: tirar caracteres de controle é o objetivo
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return base.slice(0, 200) || "cronograma";
}

/**
 * Importação: confere papel, tamanho e tipo pelo conteúdo, grava no bucket do tenant, cria a
 * versão em `pendente` e enfileira a leitura. A versão vigente só muda quando a leitura conclui.
 */
export async function registrarCronograma(
  ctx: Contexto,
  entrada: { obraId: string },
  arquivo: { dados: Uint8Array; nome: string },
): Promise<{ id: string }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(entrada.obraId).success) throw new ErroDominio("invalido", "Obra inválida.");
  if (arquivo.dados.length === 0) throw new ErroDominio("invalido", "Arquivo vazio.");
  if (arquivo.dados.length > TAMANHO_MAXIMO_CRONOGRAMA)
    throw new ErroDominio("invalido", "Arquivo acima de 60 MB.");
  const tipo = tipoDoCronograma(arquivo.dados);
  if (!tipo) throw new ErroDominio("invalido", "Envie um arquivo MPP ou XML do MS Project.");

  const [o] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ id: obra.id }).from(obra).where(eq(obra.id, entrada.obraId)),
  );
  if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");

  const id = randomUUID();
  const nome = nomeLimpo(arquivo.nome);
  const chave = chaveDoTenant(ctx.tenantId, "obras", entrada.obraId, "cronogramas", `${id}.${tipo}`);
  const { sha256 } = await gravarObjeto(
    chave,
    arquivo.dados,
    tipo === "mpp" ? "application/vnd.ms-project" : "application/xml",
  );

  await withTenant(ctx.tenantId, async (tx) => {
    await tx.insert(cronogramaVersao).values({
      id,
      tenantId: ctx.tenantId,
      obraId: entrada.obraId,
      arquivoNome: nome,
      tipoArquivo: tipo,
      arquivoKey: chave,
      arquivoSha256: sha256,
      enviadoPorId: ctx.usuarioId,
    });
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "cronograma.enviado",
      entidade: "cronograma_versao",
      entidadeId: id,
      depois: { obraId: entrada.obraId, tipo, sha256, nome },
    });
  });
  await obterFila().enfileirar(
    "ler_cronograma",
    { tenantId: ctx.tenantId, versaoId: id },
    { jobId: idJob("crono", id) },
  );
  return { id };
}

// ─────────────────────────── Leitura (worker) ───────────────────────────

const dataIso = z.iso.date().nullable();

/** Contrato do mpp-extractor (services/mpp-extractor): só o que o Gantt usa. */
export const esquemaLeitura = z.object({
  versao: z.object({ leitor: z.string(), mpxj: z.string() }),
  projeto: z.object({ nome: z.string().nullable(), inicio: dataIso, termino: dataIso }),
  tarefas: z.array(
    z.object({
      uid: z.number().int(),
      nome: z.string().min(1),
      nivel: z.number().int().min(1),
      resumo: z.boolean(),
      marco: z.boolean(),
      inicio: dataIso,
      termino: dataIso,
      percentual: z.number().int().min(0).max(100),
    }),
  ),
});
export type LeituraCronograma = z.infer<typeof esquemaLeitura>;

/** O arquivo não é legível e não adianta tentar de novo. A mensagem vai para a tela. */
export class ArquivoRecusadoPeloLeitor extends Error {}

/** Chama o mpp-extractor (MPXJ numa JVM isolada, só HTTP). */
export async function chamarLeitor(dados: Uint8Array, url = process.env.MPP_EXTRACTOR_URL): Promise<unknown> {
  if (!url) throw new Error("MPP_EXTRACTOR_URL não definida");
  const r = await fetch(`${url.replace(/\/$/, "")}/ler`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from(dados),
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = (await r.json().catch(() => null)) as { erro?: string; codigo?: string } | null;
  if (r.status === 400 || r.status === 413) {
    throw new ArquivoRecusadoPeloLeitor(corpo?.erro ?? "Não consegui ler o arquivo do MS Project.");
  }
  if (!r.ok) throw new Error(`leitor respondeu ${r.status}: ${corpo?.codigo ?? ""}`);
  return corpo;
}

/** Uma obra por vez: numerar a versão e trocar a vigente não pode correr em paralelo. */
const travarObra = (tx: Tx, obraId: string) =>
  tx.execute(sql`select 1 from obra where id = ${obraId} for update`);

/**
 * Job `ler_cronograma`: bucket → leitor → tarefas no banco. A versão ganha o próximo número da
 * obra e vira a vigente. Arquivo recusado ou sem tarefas = falha definitiva (a vigente não
 * muda); erro de rede/5xx = o BullMQ tenta de novo.
 */
export async function processarLeituraCronograma(
  tenantId: string,
  versaoId: string,
  leitor: (dados: Uint8Array) => Promise<unknown> = chamarLeitor,
): Promise<{ status: "concluida" | "falhou" | "ignorada"; numero?: number; tarefas?: number }> {
  const [v] = await withTenant(tenantId, (tx) =>
    tx.select().from(cronogramaVersao).where(eq(cronogramaVersao.id, versaoId)),
  );
  if (!v || v.statusLeitura === "concluida" || v.statusLeitura === "falhou") return { status: "ignorada" };
  const marcar = (statusLeitura: "processando" | "pendente" | "falhou", erroLeitura: string | null) =>
    withTenant(tenantId, (tx) =>
      tx
        .update(cronogramaVersao)
        .set({ statusLeitura, erroLeitura })
        .where(eq(cronogramaVersao.id, versaoId)),
    );
  await marcar("processando", null);

  let leitura: LeituraCronograma;
  try {
    leitura = esquemaLeitura.parse(await leitor(await lerObjeto(v.arquivoKey)));
    if (leitura.tarefas.length === 0)
      throw new ArquivoRecusadoPeloLeitor("Não encontrei tarefas no arquivo.");
    if (leitura.tarefas.length > MAXIMO_DE_TAREFAS)
      throw new ArquivoRecusadoPeloLeitor("O arquivo tem mais de 20.000 tarefas.");
  } catch (e) {
    if (e instanceof ArquivoRecusadoPeloLeitor) {
      await marcar("falhou", e.message);
      return { status: "falhou" };
    }
    if (e instanceof z.ZodError) {
      await marcar("falhou", "Não consegui entender o conteúdo do arquivo.");
      return { status: "falhou" };
    }
    await marcar("pendente", null);
    throw e;
  }

  const datas = (campo: "inicio" | "termino") =>
    leitura.tarefas
      .map((t) => t[campo])
      .filter((d): d is string => d !== null)
      .sort();
  const inicio = datas("inicio")[0] ?? leitura.projeto.inicio;
  const termino = datas("termino").at(-1) ?? leitura.projeto.termino;
  const versaoLeitor = `mpp-extractor@${leitura.versao.leitor}+mpxj@${leitura.versao.mpxj}`;

  const numero = await withTenant(tenantId, async (tx) => {
    await travarObra(tx, v.obraId);
    const [{ ultimo } = { ultimo: 0 }] = await tx
      .select({ ultimo: sql<number>`coalesce(max(${cronogramaVersao.numero}), 0)::int` })
      .from(cronogramaVersao)
      .where(eq(cronogramaVersao.obraId, v.obraId));
    const numero = ultimo + 1;
    for (let i = 0; i < leitura.tarefas.length; i += LOTE) {
      await tx.insert(cronogramaTarefa).values(
        leitura.tarefas.slice(i, i + LOTE).map((t, j) => ({
          tenantId,
          versaoId,
          ordem: i + j,
          uid: t.uid,
          nome: t.nome.slice(0, 500),
          nivel: t.nivel,
          resumo: t.resumo,
          marco: t.marco,
          inicio: t.inicio,
          termino: t.termino,
          percentual: t.percentual,
        })),
      );
    }
    await tx
      .update(cronogramaVersao)
      .set({ vigente: false })
      .where(and(eq(cronogramaVersao.obraId, v.obraId), eq(cronogramaVersao.vigente, true)));
    await tx
      .update(cronogramaVersao)
      .set({
        numero,
        vigente: true,
        statusLeitura: "concluida",
        erroLeitura: null,
        totalTarefas: leitura.tarefas.length,
        inicio,
        termino,
        versaoLeitor,
      })
      .where(eq(cronogramaVersao.id, versaoId));
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "sistema", id: null },
      acao: "cronograma.lido",
      entidade: "cronograma_versao",
      entidadeId: versaoId,
      depois: { numero, tarefas: leitura.tarefas.length, inicio, termino, versaoLeitor },
    });
    return numero;
  });
  return { status: "concluida", numero, tarefas: leitura.tarefas.length };
}

// ─────────────────────────── Painel ───────────────────────────

export interface VersaoCronograma {
  id: string;
  /** null enquanto a leitura não conclui (e nas que falharam). */
  numero: number | null;
  vigente: boolean;
  arquivoNome: string;
  statusLeitura: "pendente" | "processando" | "concluida" | "falhou";
  erroLeitura: string | null;
  totalTarefas: number | null;
  /** AAAA-MM-DD */
  termino: string | null;
  enviadoPor: string;
  criadoEm: Date;
}

export interface TarefaCronograma {
  ordem: number;
  nome: string;
  nivel: number;
  resumo: boolean;
  marco: boolean;
  /** AAAA-MM-DD */
  inicio: string | null;
  termino: string | null;
  percentual: number;
}

export interface CronogramaDaObra {
  /** Da importação mais nova para a mais antiga. */
  versoes: VersaoCronograma[];
  vigente: VersaoCronograma | null;
  /** Tarefas da versão vigente, na ordem do arquivo. */
  tarefas: TarefaCronograma[];
}

export async function obterCronograma(ctx: Contexto, obraId: string): Promise<CronogramaDaObra> {
  if (!uuid.safeParse(obraId).success) return { versoes: [], vigente: null, tarefas: [] };
  return withTenant(ctx.tenantId, async (tx) => {
    const linhas = await tx
      .select({ v: cronogramaVersao, enviadoPor: usuario.nome })
      .from(cronogramaVersao)
      .innerJoin(usuario, eq(usuario.id, cronogramaVersao.enviadoPorId))
      .where(eq(cronogramaVersao.obraId, obraId))
      .orderBy(desc(cronogramaVersao.criadoEm));
    const versoes = linhas.map(({ v, enviadoPor }) => ({
      id: v.id,
      numero: v.numero,
      vigente: v.vigente,
      arquivoNome: v.arquivoNome,
      // "nao_aplicavel" é do PDF de projeto; a coluna de cronograma nunca recebe esse valor
      statusLeitura: v.statusLeitura as VersaoCronograma["statusLeitura"],
      erroLeitura: v.erroLeitura,
      totalTarefas: v.totalTarefas,
      termino: v.termino,
      enviadoPor,
      criadoEm: v.criadoEm,
    }));
    const vigente = versoes.find((v) => v.vigente) ?? null;
    const tarefas = vigente
      ? await tx
          .select({
            ordem: cronogramaTarefa.ordem,
            nome: cronogramaTarefa.nome,
            nivel: cronogramaTarefa.nivel,
            resumo: cronogramaTarefa.resumo,
            marco: cronogramaTarefa.marco,
            inicio: cronogramaTarefa.inicio,
            termino: cronogramaTarefa.termino,
            percentual: cronogramaTarefa.percentual,
          })
          .from(cronogramaTarefa)
          .where(eq(cronogramaTarefa.versaoId, vigente.id))
          .orderBy(asc(cronogramaTarefa.ordem))
      : [];
    return { versoes, vigente, tarefas };
  });
}

/** Volta uma versão já lida a ser a vigente. Nada é apagado: a atual continua no histórico. */
export async function restaurarCronograma(ctx: Contexto, versaoId: string): Promise<{ numero: number }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(versaoId).success) throw new ErroDominio("invalido", "Versão inválida.");
  return withTenant(ctx.tenantId, async (tx) => {
    const [alvo] = await tx.select().from(cronogramaVersao).where(eq(cronogramaVersao.id, versaoId));
    if (!alvo) throw new ErroDominio("nao_encontrado", "Versão não encontrada.");
    await travarObra(tx, alvo.obraId);
    const [atual] = await tx
      .select()
      .from(cronogramaVersao)
      .where(and(eq(cronogramaVersao.obraId, alvo.obraId), eq(cronogramaVersao.vigente, true)));
    if (alvo.statusLeitura !== "concluida" || alvo.numero === null)
      throw new ErroDominio("conflito", "Esta importação não foi lida e não pode ser restaurada.");
    if (atual?.id === alvo.id) throw new ErroDominio("conflito", "Esta versão já é a vigente.");
    if (atual)
      await tx.update(cronogramaVersao).set({ vigente: false }).where(eq(cronogramaVersao.id, atual.id));
    await tx.update(cronogramaVersao).set({ vigente: true }).where(eq(cronogramaVersao.id, alvo.id));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: "cronograma.restaurado",
      entidade: "cronograma_versao",
      entidadeId: alvo.id,
      antes: { vigente: atual?.numero ?? null },
      depois: { vigente: alvo.numero },
    });
    return { numero: alvo.numero };
  });
}
