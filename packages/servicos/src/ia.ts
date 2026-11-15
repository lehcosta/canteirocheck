import {
  comNovaTentativa,
  type Llm,
  llmPadrao,
  type SaidaPontos,
  tarefaPendencias,
  tarefaPontos,
  type UsoLlm,
  VERSAO_PENDENCIAS,
  VERSAO_PONTOS,
} from "@canteirocheck/ai";
import { lerNumero } from "@canteirocheck/core";
import { registrarAuditoria, schema, type Tx, withTenant } from "@canteirocheck/db";
import type { ExtracaoInterpretada } from "@canteirocheck/extracao";
import { and, eq } from "drizzle-orm";

const { projeto, extracaoProjeto, pendencia, pontoControle, local, etapa, eventoCusto } = schema;

/**
 * Etapa 3: pendências e pontos sugeridos a partir da extração do DWG. A IA sugere, o engenheiro
 * decide: nada aqui entra em checklist sem aprovação (`status_revisao = sugerido`).
 */

async function registrarCusto(tx: Tx, tenantId: string, obraId: string, usos: UsoLlm[], tarefa: string) {
  for (const u of usos) {
    await tx.insert(eventoCusto).values({
      tenantId,
      obraId,
      tipo: "llm_tokens",
      quantidade: String(u.entrada + u.saida + u.cacheLeitura + u.cacheEscrita),
      custoEstimado: u.custoUsd,
      moeda: "USD",
      referencia: `${u.modelo}@${tarefa}`,
    });
  }
}

async function carregar(tenantId: string, projetoId: string) {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx.select().from(projeto).where(eq(projeto.id, projetoId));
    const [x] = await tx.select().from(extracaoProjeto).where(eq(extracaoProjeto.projetoId, projetoId));
    return { p, x };
  });
}

// ─────────────────────────── Pendências ───────────────────────────

export async function detectarPendencias(
  tenantId: string,
  projetoId: string,
  llm: Llm | null = llmPadrao(),
): Promise<{ criadas: number; por: string }> {
  const { p, x } = await carregar(tenantId, projetoId);
  if (!p || !x) return { criadas: 0, por: "sem_extracao" };
  const jaRegistradas = new Set(
    (
      await withTenant(tenantId, (tx) =>
        tx.select({ t: pendencia.textoOriginal }).from(pendencia).where(eq(pendencia.projetoId, projetoId)),
      )
    ).map((l) => l.t),
  );
  // Só o que passou no pré-filtro e ainda não virou pendência vai para a IA (custo).
  const notas = ((x.carimbo as { notas?: ExtracaoInterpretada["notas"] }).notas ?? []).filter(
    (n) => n.pareceDependencia && !jaRegistradas.has(n.texto),
  );
  if (notas.length === 0) return { criadas: 0, por: "pre_filtro" };

  // Sem IA disponível ou falhando: o pré-filtro já disse que é suspeito → pendência para revisão humana.
  let classificadas: {
    texto: string;
    etapa: string | null;
    risco: "alto" | "medio" | "baixo";
    por: string;
  }[];
  let usos: UsoLlm[] = [];
  const porRegex = () =>
    notas.map((n) => ({
      texto: n.texto,
      etapa: null,
      risco: "medio" as const,
      por: "regex (revisão humana)",
    }));
  if (!llm) {
    classificadas = porRegex();
  } else {
    const r = await comNovaTentativa(
      llm,
      tarefaPendencias(
        notas.map((n) => n.texto),
        { disciplina: p.disciplina, titulo: p.titulo },
      ),
    );
    usos = r.usos;
    if (r.resultado.ok) {
      const modelo = r.usos.at(-1)?.modelo ?? "llm";
      classificadas = r.resultado.saida.itens
        .filter((i) => i.eh_pendencia && notas[i.indice])
        .map((i) => ({
          texto: notas[i.indice]?.texto ?? "",
          etapa: i.etapa_bloqueada,
          risco: i.risco,
          por: `${modelo}@${VERSAO_PENDENCIAS}`,
        }));
    } else {
      classificadas = porRegex();
    }
  }

  return withTenant(tenantId, async (tx) => {
    const etapas = await tx.select({ id: etapa.id, codigo: etapa.codigo }).from(etapa);
    const existentes = new Set(
      (
        await tx
          .select({ t: pendencia.textoOriginal })
          .from(pendencia)
          .where(eq(pendencia.projetoId, projetoId))
      ).map((l) => l.t),
    );
    let criadas = 0;
    for (const c of classificadas) {
      if (!c.texto || existentes.has(c.texto)) continue;
      await tx.insert(pendencia).values({
        tenantId,
        obraId: p.obraId,
        projetoId,
        textoOriginal: c.texto,
        etapaBloqueadaId: etapas.find((e) => e.codigo === c.etapa)?.id ?? null,
        risco: c.risco,
        classificadoPor: c.por,
      });
      criadas++;
    }
    await registrarCusto(tx, tenantId, p.obraId, usos, VERSAO_PENDENCIAS);
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "ia", id: null },
      acao: "projeto.pendencias_detectadas",
      entidade: "projeto",
      entidadeId: projetoId,
      depois: { notasSuspeitas: notas.length, criadas, por: classificadas[0]?.por ?? null },
    });
    return { criadas, por: classificadas[0]?.por ?? "nenhuma" };
  });
}

// ─────────────────────────── Pontos de controle ───────────────────────────

const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** O trecho citado precisa existir no material extraído (anti-alucinação): texto ou nome de camada. */
export function trechoExiste(
  trecho: string,
  x: Pick<ExtracaoInterpretada, "textos" | "camadas" | "cotasNivel">,
): boolean {
  const alvo = normalizar(trecho);
  if (alvo.length < 2) return false;
  return (
    x.textos.some((t) => {
      const texto = normalizar(t.texto);
      // o trecho está no texto, ou a IA citou o texto inteiro com algo a mais em volta
      return texto.includes(alvo) || (texto.length >= 4 && alvo.includes(texto));
    }) ||
    x.camadas.some((c) => normalizar(c.nome) === alvo) ||
    x.cotasNivel.some((c) => normalizar(c.texto) === alvo)
  );
}

type PontoSugerido = SaidaPontos["pontos"][number];

export interface ResultadoGeracao {
  criados: number;
  descartados: { descricao: string; motivo: string }[];
  status: "ok" | "sem_ia" | "falhou" | "sem_extracao" | "ja_gerado";
}

export async function gerarPontosSugeridos(
  tenantId: string,
  projetoId: string,
  llm: Llm | null = llmPadrao(),
): Promise<ResultadoGeracao> {
  const { p, x } = await carregar(tenantId, projetoId);
  if (!p || !x) return { criados: 0, descartados: [], status: "sem_extracao" };
  if (!llm) return { criados: 0, descartados: [], status: "sem_ia" };

  const extracao = {
    textos: x.textos as ExtracaoInterpretada["textos"],
    camadas: x.camadas as ExtracaoInterpretada["camadas"],
    cotasNivel: x.cotasNivel as ExtracaoInterpretada["cotasNivel"],
    ambientes: x.ambientes as ExtracaoInterpretada["ambientes"],
  };
  const [jaTem] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: pontoControle.id })
      .from(pontoControle)
      .where(and(eq(pontoControle.projetoId, projetoId), eq(pontoControle.origem, "ia")))
      .limit(1),
  );
  if (jaTem) return { criados: 0, descartados: [], status: "ja_gerado" };

  const locais = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: local.id, nome: local.nome, tipo: local.tipo })
      .from(local)
      .where(eq(local.obraId, p.obraId)),
  );
  const { resultado, usos } = await comNovaTentativa(
    llm,
    tarefaPontos({
      projeto: { disciplina: p.disciplina, titulo: p.titulo, codigo: p.codigo, revisao: p.revisao },
      locais: locais.map((l) => ({ nome: l.nome, tipo: l.tipo })),
      ambientes: extracao.ambientes.map((a) => ({ nome: a.nome, areaM2: a.areaM2 })),
      cotasNivel: extracao.cotasNivel.map((c) => ({ texto: c.texto, camada: c.camada })),
      // Carimbo e atributos não ajudam a gerar pontos e custam tokens.
      textos: extracao.textos.filter((t) => !t.tag).map((t) => ({ texto: t.texto, camada: t.camada })),
      camadas: extracao.camadas
        .filter((c) => !c.desligada && !c.congelada && c.entidades > 0)
        .map((c) => c.nome),
    }),
  );

  return withTenant(tenantId, async (tx) => {
    await registrarCusto(tx, tenantId, p.obraId, usos, VERSAO_PONTOS);
    if (!resultado.ok) {
      await registrarAuditoria(tx, {
        tenantId,
        ator: { tipo: "ia", id: null },
        acao: "projeto.pontos_falhou",
        entidade: "projeto",
        entidadeId: projetoId,
        depois: { motivo: resultado.motivo, detalhe: resultado.detalhe.slice(0, 500) },
      });
      return { criados: 0, descartados: [], status: "falhou" };
    }
    const etapas = await tx.select({ id: etapa.id, codigo: etapa.codigo }).from(etapa);
    const porNome = new Map(locais.map((l) => [normalizar(l.nome), l.id]));
    const ambientes = new Set(extracao.ambientes.map((a) => normalizar(a.nome)));
    const modelo = usos.at(-1)?.modelo ?? "llm";
    const descartados: ResultadoGeracao["descartados"] = [];
    let criados = 0;

    // Ambiente do projeto que ainda não é local da obra vira local (tipo ambiente).
    const localDe = async (nome: string): Promise<string | null> => {
      const n = normalizar(nome);
      const existente = porNome.get(n);
      if (existente) return existente;
      if (!ambientes.has(n)) return null;
      const [novo] = await tx
        .insert(local)
        .values({ tenantId, obraId: p.obraId, tipo: "ambiente", nome: nome.trim() })
        .onConflictDoNothing()
        .returning({ id: local.id });
      if (novo) porNome.set(n, novo.id);
      return novo?.id ?? null;
    };

    for (const s of resultado.saida.pontos) {
      const motivo = validarSugestao(s, extracao);
      if (motivo) {
        descartados.push({ descricao: s.descricao, motivo });
        continue;
      }
      const localId = await localDe(s.local);
      const refId = s.local_referencia ? await localDe(s.local_referencia) : null;
      const etapaId = etapas.find((e) => e.codigo === s.etapa)?.id;
      if (!localId || !etapaId || (s.eh_interface && !refId)) {
        descartados.push({ descricao: s.descricao, motivo: "local desconhecido na obra e no projeto" });
        continue;
      }
      const num = (v: string | null) => {
        if (v === null) return null;
        const r = lerNumero(v);
        return r.ok ? r.valor.toFixed() : null;
      };
      await tx.insert(pontoControle).values({
        tenantId,
        obraId: p.obraId,
        etapaId,
        localId,
        regiao: s.regiao,
        descricao: s.descricao.slice(0, 300),
        grandeza: s.grandeza,
        valorEsperado: s.grandeza === "existencia" ? null : num(s.valor_esperado),
        unidade: s.grandeza === "existencia" ? "booleano" : s.unidade,
        toleranciaMais: num(s.tolerancia_mais),
        toleranciaMenos: num(s.tolerancia_menos),
        ehInterface: s.eh_interface,
        localReferenciaId: refId,
        referenciaNivel: s.referencia_nivel,
        exigeFoto: s.exige_foto || s.eh_interface,
        origem: "ia",
        statusRevisao: "sugerido",
        projetoId,
        trechoOrigem: s.trecho_origem.slice(0, 1000),
      });
      criados++;
    }
    await registrarAuditoria(tx, {
      tenantId,
      ator: { tipo: "ia", id: null },
      acao: "projeto.pontos_sugeridos",
      entidade: "projeto",
      entidadeId: projetoId,
      depois: { criados, descartados, modelo: `${modelo}@${VERSAO_PONTOS}` },
    });
    return { criados, descartados, status: "ok" };
  });
}

/** Regras determinísticas sobre a sugestão da IA. Devolve o motivo do descarte ou null. */
export function validarSugestao(
  s: PontoSugerido,
  x: Pick<ExtracaoInterpretada, "textos" | "camadas" | "cotasNivel">,
): string | null {
  if (!trechoExiste(s.trecho_origem, x)) return "trecho de origem não encontrado no projeto";
  if (s.grandeza === "existencia") return null;
  if (s.unidade === "booleano") return "unidade incompatível com a grandeza";
  if (!s.valor_esperado || !lerNumero(s.valor_esperado).ok) return "valor esperado inválido";
  for (const t of [s.tolerancia_mais, s.tolerancia_menos]) {
    if (t !== null) {
      const r = lerNumero(t);
      if (!r.ok || r.valor.isNegative()) return "tolerância inválida";
    }
  }
  if ((s.tolerancia_mais === null) !== (s.tolerancia_menos === null)) return "tolerância incompleta";
  return null;
}
