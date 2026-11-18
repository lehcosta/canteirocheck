import { randomUUID } from "node:crypto";
import { registrarAuditoria, schema, withTenant } from "@canteirocheck/db";
import { type ExtracaoInterpretada, esquemaResultado, interpretar } from "@canteirocheck/extracao";
import { idJob, obterFila } from "@canteirocheck/queue";
import { chaveDoTenant, gravarObjeto, lerObjeto, urlDeLeitura } from "@canteirocheck/storage";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { ator, type Contexto, ErroDominio, exigirPapel, traduzirErroBanco } from "./contexto";
import { solicitarCruzamento } from "./cruzamentos";
import { primeiraMensagem, textoObrigatorio, uuid } from "./validacao";

const { projeto, extracaoProjeto, pendencia, obra, usuario, etapa } = schema;

export const TAMANHO_MAXIMO_PROJETO = 60 * 1024 * 1024;

/** Tipo pelo conteúdo (não pela extensão): DWG começa com "AC10xx"/"AC1xxx", PDF com "%PDF-". */
export function tipoDoArquivo(dados: Uint8Array): "dwg" | "pdf" | null {
  const cab = Buffer.from(dados.subarray(0, 6)).toString("latin1");
  if (/^AC1\d{3}$/.test(cab)) return "dwg";
  if (cab.startsWith("%PDF-")) return "pdf";
  return null;
}

export const entradaProjeto = z.object({
  obraId: uuid,
  disciplina: z.enum(["arquitetura", "estrutura", "instalacoes", "interiores"], {
    message: "Disciplina inválida.",
  }),
  titulo: textoObrigatorio("Título", 200),
  codigo: textoObrigatorio("Código", 60),
  revisao: textoObrigatorio("Revisão", 20),
});

/**
 * Upload de projeto: confere papel, tamanho e tipo pelo conteúdo, grava no bucket do tenant,
 * cria a linha (nova revisão marca a anterior do mesmo código como substituída) e, se for DWG,
 * enfileira a extração.
 */
export async function registrarProjeto(
  ctx: Contexto,
  entrada: unknown,
  arquivo: { dados: Uint8Array; nome: string },
): Promise<{ id: string; tipo: "dwg" | "pdf" }> {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  const r = entradaProjeto.safeParse(entrada);
  if (!r.success) throw new ErroDominio("invalido", primeiraMensagem(r.error));
  const d = r.data;
  if (arquivo.dados.length === 0) throw new ErroDominio("invalido", "Arquivo vazio.");
  if (arquivo.dados.length > TAMANHO_MAXIMO_PROJETO)
    throw new ErroDominio("invalido", "Arquivo acima de 60 MB.");
  const tipo = tipoDoArquivo(arquivo.dados);
  if (!tipo)
    throw new ErroDominio(
      "invalido",
      "Envie um DWG ou PDF (o conteúdo do arquivo não é de nenhum dos dois).",
    );

  const [o] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ id: obra.id }).from(obra).where(eq(obra.id, d.obraId)),
  );
  if (!o) throw new ErroDominio("nao_encontrado", "Obra não encontrada.");

  const id = randomUUID();
  const chave = chaveDoTenant(ctx.tenantId, "obras", d.obraId, "projetos", `${id}.${tipo}`);
  const { sha256 } = await gravarObjeto(
    chave,
    arquivo.dados,
    tipo === "dwg" ? "application/acad" : "application/pdf",
  );

  const criado = await withTenant(ctx.tenantId, async (tx) => {
    try {
      const [novo] = await tx
        .insert(projeto)
        .values({
          id,
          tenantId: ctx.tenantId,
          ...d,
          tipoArquivo: tipo,
          arquivoKey: chave,
          arquivoSha256: sha256,
          statusExtracao: tipo === "dwg" ? "pendente" : "nao_aplicavel",
          enviadoPorId: ctx.usuarioId,
        })
        .returning();
      if (!novo) throw new Error("falha ao registrar projeto");
      await tx
        .update(projeto)
        .set({ substituidoPorId: novo.id })
        .where(and(eq(projeto.obraId, d.obraId), eq(projeto.codigo, d.codigo), ne(projeto.id, novo.id)));
      await registrarAuditoria(tx, {
        tenantId: ctx.tenantId,
        ator: ator(ctx),
        acao: "projeto.enviado",
        entidade: "projeto",
        entidadeId: novo.id,
        depois: { ...d, tipo, sha256, nome: arquivo.nome },
      });
      return novo;
    } catch (e) {
      traduzirErroBanco(e, {
        projeto_obra_id_codigo_revisao_unique: "Já existe esta revisão deste projeto na obra.",
      });
    }
  });
  if (tipo === "dwg") {
    await obterFila().enfileirar(
      "extrair_dwg",
      { tenantId: ctx.tenantId, projetoId: criado.id },
      { jobId: idJob("dwg", criado.id) },
    );
  }
  return { id: criado.id, tipo };
}

// ─────────────────────────── Extração (worker) ───────────────────────────

export class ArquivoRecusadoPeloExtrator extends Error {}

/** Chama o dwg-extractor (serviço GPL isolado, só HTTP). */
export async function chamarExtrator(
  dados: Uint8Array,
  url = process.env.DWG_EXTRACTOR_URL,
): Promise<unknown> {
  if (!url) throw new Error("DWG_EXTRACTOR_URL não definida");
  const r = await fetch(`${url.replace(/\/$/, "")}/extrair`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from(dados),
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = (await r.json().catch(() => null)) as { erro?: string; codigo?: string } | null;
  if (r.status === 400 || r.status === 413) {
    throw new ArquivoRecusadoPeloExtrator(corpo?.erro ?? `extrator recusou o arquivo (${r.status})`);
  }
  if (!r.ok) throw new Error(`extrator respondeu ${r.status}: ${corpo?.codigo ?? ""}`);
  return corpo;
}

/**
 * Job `extrair_dwg`: bucket → extrator → interpretação (código nosso) → `extracao_projeto`, e o
 * projeto lido é cruzado com o cronograma vigente. Arquivo recusado pelo extrator = falha
 * definitiva; erro de rede/5xx = o BullMQ tenta de novo.
 */
export async function processarExtracao(
  tenantId: string,
  projetoId: string,
  extrator: (dados: Uint8Array) => Promise<unknown> = chamarExtrator,
): Promise<{ status: "concluida" | "falhou" | "ignorada"; notasSuspeitas?: number }> {
  const [p] = await withTenant(tenantId, (tx) => tx.select().from(projeto).where(eq(projeto.id, projetoId)));
  if (p?.tipoArquivo !== "dwg" || p.statusExtracao === "concluida") return { status: "ignorada" };
  await withTenant(tenantId, (tx) =>
    tx
      .update(projeto)
      .set({ statusExtracao: "processando", erroExtracao: null })
      .where(eq(projeto.id, projetoId)),
  );

  let interpretada: ExtracaoInterpretada;
  let versaoExtrator: string;
  try {
    const bruto = esquemaResultado.parse(await extrator(await lerObjeto(p.arquivoKey)));
    interpretada = interpretar(bruto);
    versaoExtrator = `dwg-extractor@${bruto.versao.extrator}+libredwg-web@${bruto.versao.libredwgWeb}`;
  } catch (e) {
    const definitiva = e instanceof ArquivoRecusadoPeloExtrator || e instanceof z.ZodError;
    await withTenant(tenantId, (tx) =>
      tx
        .update(projeto)
        .set({
          statusExtracao: definitiva ? "falhou" : "pendente",
          erroExtracao:
            e instanceof z.ZodError ? "resposta do extrator fora do contrato" : (e as Error).message,
        })
        .where(eq(projeto.id, projetoId)),
    );
    if (definitiva) return { status: "falhou" };
    throw e;
  }

  await withTenant(tenantId, async (tx) => {
    const valores = {
      tenantId,
      projetoId,
      textos: interpretada.textos,
      camadas: interpretada.camadas,
      blocos: interpretada.blocos,
      cotasNivel: interpretada.cotasNivel,
      ambientes: interpretada.ambientes,
      carimbo: { ...interpretada.carimbo, notas: interpretada.notas, unidades: interpretada.unidades },
      versaoExtrator,
    };
    await tx
      .insert(extracaoProjeto)
      .values(valores)
      .onConflictDoUpdate({ target: extracaoProjeto.projetoId, set: valores });
    await tx.update(projeto).set({ statusExtracao: "concluida" }).where(eq(projeto.id, projetoId));
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "sistema", id: null },
      acao: "projeto.extraido",
      entidade: "projeto",
      entidadeId: projetoId,
      depois: {
        textos: interpretada.textos.length,
        ambientes: interpretada.ambientes.length,
        cotasNivel: interpretada.cotasNivel.length,
        notas: interpretada.notas.length,
        versaoExtrator,
      },
    });
  });
  const fila = obterFila();
  await fila.enfileirar("detectar_pendencias", { tenantId, projetoId }, { jobId: idJob("pend", projetoId) });
  await fila.enfileirar("gerar_pontos", { tenantId, projetoId }, { jobId: idJob("pontos", projetoId) });
  await solicitarCruzamento(tenantId, p.obraId, null);
  return {
    status: "concluida",
    notasSuspeitas: interpretada.notas.filter((n) => n.pareceDependencia).length,
  };
}

// ─────────────────────────── Painel ───────────────────────────

export interface ProjetoListado {
  id: string;
  disciplina: string;
  titulo: string;
  codigo: string;
  revisao: string;
  tipoArquivo: "dwg" | "pdf";
  statusExtracao: string;
  erroExtracao: string | null;
  substituido: boolean;
  enviadoPor: string;
  criadoEm: Date;
}

export async function listarProjetos(ctx: Contexto, obraId: string): Promise<ProjetoListado[]> {
  if (!uuid.safeParse(obraId).success) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const linhas = await tx
      .select({ p: projeto, enviadoPor: usuario.nome })
      .from(projeto)
      .innerJoin(usuario, eq(usuario.id, projeto.enviadoPorId))
      .where(eq(projeto.obraId, obraId))
      .orderBy(desc(projeto.criadoEm));
    return linhas.map(({ p, enviadoPor }) => ({
      id: p.id,
      disciplina: p.disciplina,
      titulo: p.titulo,
      codigo: p.codigo,
      revisao: p.revisao,
      tipoArquivo: p.tipoArquivo,
      statusExtracao: p.statusExtracao,
      erroExtracao: p.erroExtracao,
      substituido: p.substituidoPorId !== null,
      enviadoPor,
      criadoEm: p.criadoEm,
    }));
  });
}

export interface DetalheProjeto extends ProjetoListado {
  obraId: string;
  extracao: (ExtracaoInterpretada & { versaoExtrator: string; criadoEm: Date }) | null;
  pendencias: {
    id: string;
    textoOriginal: string;
    etapaNome: string | null;
    risco: string;
    status: string;
    classificadoPor: string;
  }[];
}

export async function obterProjeto(ctx: Contexto, projetoId: string): Promise<DetalheProjeto | null> {
  if (!uuid.safeParse(projetoId).success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const [l] = await tx
      .select({ p: projeto, enviadoPor: usuario.nome })
      .from(projeto)
      .innerJoin(usuario, eq(usuario.id, projeto.enviadoPorId))
      .where(eq(projeto.id, projetoId));
    if (!l) return null;
    const [x] = await tx.select().from(extracaoProjeto).where(eq(extracaoProjeto.projetoId, projetoId));
    const pend = await tx
      .select({
        id: pendencia.id,
        textoOriginal: pendencia.textoOriginal,
        etapaNome: etapa.nome,
        risco: pendencia.risco,
        status: pendencia.status,
        classificadoPor: pendencia.classificadoPor,
      })
      .from(pendencia)
      .leftJoin(etapa, eq(etapa.id, pendencia.etapaBloqueadaId))
      .where(eq(pendencia.projetoId, projetoId));
    const carimbo = (x?.carimbo ?? {}) as ExtracaoInterpretada["carimbo"] & {
      notas?: ExtracaoInterpretada["notas"];
      unidades?: ExtracaoInterpretada["unidades"];
    };
    const {
      notas = [],
      unidades = { codigo: null, metrosPorUnidade: 1, assumida: true },
      ...soCarimbo
    } = carimbo;
    return {
      id: l.p.id,
      obraId: l.p.obraId,
      disciplina: l.p.disciplina,
      titulo: l.p.titulo,
      codigo: l.p.codigo,
      revisao: l.p.revisao,
      tipoArquivo: l.p.tipoArquivo,
      statusExtracao: l.p.statusExtracao,
      erroExtracao: l.p.erroExtracao,
      substituido: l.p.substituidoPorId !== null,
      enviadoPor: l.enviadoPor,
      criadoEm: l.p.criadoEm,
      extracao: x
        ? {
            textos: x.textos as ExtracaoInterpretada["textos"],
            camadas: x.camadas as ExtracaoInterpretada["camadas"],
            blocos: x.blocos as ExtracaoInterpretada["blocos"],
            cotasNivel: x.cotasNivel as ExtracaoInterpretada["cotasNivel"],
            ambientes: x.ambientes as ExtracaoInterpretada["ambientes"],
            carimbo: soCarimbo,
            notas,
            unidades,
            versaoExtrator: x.versaoExtrator,
            criadoEm: x.criadoEm,
          }
        : null,
      pendencias: pend,
    };
  });
}

export async function urlDoArquivoProjeto(ctx: Contexto, projetoId: string): Promise<string | null> {
  if (!uuid.safeParse(projetoId).success) return null;
  const [p] = await withTenant(ctx.tenantId, (tx) =>
    tx.select().from(projeto).where(eq(projeto.id, projetoId)),
  );
  if (!p) return null;
  return urlDeLeitura(p.arquivoKey, `${p.codigo}-${p.revisao}.${p.tipoArquivo}`);
}

/** Reprocessar a extração (ex.: depois de atualizar o extrator ou de uma falha transitória). */
export async function reprocessarProjeto(ctx: Contexto, projetoId: string) {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(projetoId).success) throw new ErroDominio("invalido", "Projeto inválido.");
  const [p] = await withTenant(ctx.tenantId, (tx) =>
    tx
      .update(projeto)
      .set({ statusExtracao: "pendente", erroExtracao: null })
      .where(and(eq(projeto.id, projetoId), eq(projeto.tipoArquivo, "dwg")))
      .returning({ id: projeto.id }),
  );
  if (!p) throw new ErroDominio("nao_encontrado", "Projeto DWG não encontrado.");
  await obterFila().enfileirar(
    "extrair_dwg",
    { tenantId: ctx.tenantId, projetoId },
    { jobId: idJob("dwg", projetoId, Date.now()) },
  );
}

// ─────────────────────────── Pendências (resolução pelo engenheiro) ───────────────────────────

export async function resolverPendencia(
  ctx: Contexto,
  entrada: { pendenciaId: string; status: "resolvida" | "descartada"; nota?: string | null },
) {
  exigirPapel(ctx, ["admin", "engenheiro"]);
  if (!uuid.safeParse(entrada.pendenciaId).success) throw new ErroDominio("invalido", "Pendência inválida.");
  const nota = entrada.nota?.trim() || null;
  if (entrada.status === "resolvida" && !nota)
    throw new ErroDominio("invalido", "Diga como a pendência foi resolvida.");
  await withTenant(ctx.tenantId, async (tx) => {
    const [antes] = await tx.select().from(pendencia).where(eq(pendencia.id, entrada.pendenciaId));
    if (!antes) throw new ErroDominio("nao_encontrado", "Pendência não encontrada.");
    if (antes.status !== "aberta") throw new ErroDominio("conflito", "Esta pendência já foi tratada.");
    await tx
      .update(pendencia)
      .set({
        status: entrada.status,
        resolvidaPorId: ctx.usuarioId,
        resolvidaEm: new Date(),
        notaResolucao: nota,
      })
      .where(eq(pendencia.id, antes.id));
    await registrarAuditoria(tx, {
      tenantId: ctx.tenantId,
      ator: ator(ctx),
      acao: `pendencia.${entrada.status}`,
      entidade: "pendencia",
      entidadeId: antes.id,
      antes: { status: antes.status },
      depois: { status: entrada.status, nota },
    });
  });
}
