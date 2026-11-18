import { z } from "zod";
import type { Esforco, TarefaEstruturada } from "./llm";

/**
 * Prompts versionados + schemas de saída. Mudou o prompt → suba a versão (vai para
 * `classificado_por` e para o registro de custo, e permite comparar resultados entre versões).
 *
 * Modelos (configuráveis): pontos de controle usam o modelo principal; a classificação de notas,
 * que roda em volume depois de um pré-filtro por regex, usa um modelo pequeno, como previsto em
 * docs/arquitetura.md §9.
 */

export const CODIGOS_ETAPA = [
  "forma",
  "armacao",
  "concretagem",
  "drywall_1a_face",
  "drywall_fechamento",
  "contrapiso",
  "piso",
  "forro",
  "marcenaria",
] as const;

export function modelos() {
  return {
    pontos: process.env.IA_MODELO_PONTOS || "claude-opus-5-5",
    classificacao: process.env.IA_MODELO_CLASSIFICACAO || "claude-haiku-5-5",
  };
}

const CATALOGO = `forma, armacao, concretagem, drywall_1a_face, drywall_fechamento, contrapiso, piso, forro, marcenaria`;

// ─────────────────────────── Pendências ───────────────────────────

export const VERSAO_PENDENCIAS = "pendencias-v1";

export const esquemaPendencias = z.object({
  itens: z.array(
    z.object({
      indice: z.number().int().describe("índice da nota na lista recebida"),
      eh_pendencia: z.boolean(),
      etapa_bloqueada: z
        .enum(CODIGOS_ETAPA)
        .nullable()
        .describe("primeira etapa que não pode ser executada sem resolver"),
      risco: z.enum(["alto", "medio", "baixo"]),
      motivo: z.string().describe("uma frase, em português"),
    }),
  ),
});
export type SaidaPendencias = z.infer<typeof esquemaPendencias>;

const SISTEMA_PENDENCIAS = `Você analisa notas de projetos de construção civil no Brasil (arquitetura, estrutura, instalações, interiores).

Para cada nota, decida se ela é uma PENDÊNCIA de projeto: algo indefinido ou dependente de outra informação que impede executar alguma etapa da obra com segurança (ex.: "piso a definir", "aguardando projeto de ar-condicionado", "verificar no local", "cota a confirmar"). Nota descritiva que só especifica material ou procedimento não é pendência.

Se for pendência, diga a PRIMEIRA etapa do catálogo que fica bloqueada até a resolução e o risco:
- alto: pode causar retrabalho caro ou estrutural se executado sem resolver (concretagem, embutidos em laje, níveis);
- medio: retrabalho de acabamento ou de sistemas;
- baixo: ajuste simples ou informativo.

Catálogo de etapas (use exatamente estes códigos): ${CATALOGO}.
Se nenhuma etapa do catálogo for afetada, use null. Responda para todas as notas, mantendo o índice.`;

export function tarefaPendencias(
  notas: string[],
  contexto: { disciplina: string; titulo: string },
): TarefaEstruturada<SaidaPendencias> {
  return {
    nome: VERSAO_PENDENCIAS,
    modelo: modelos().classificacao,
    esforco: "low" satisfies Esforco,
    sistema: SISTEMA_PENDENCIAS,
    usuario: `Projeto: ${contexto.titulo} (disciplina: ${contexto.disciplina}).\n\nNotas:\n${notas
      .map((n, i) => `[${i}] ${n.replace(/\n/g, " / ")}`)
      .join("\n")}`,
    esquema: esquemaPendencias,
    maxTokens: 4000 + notas.length * 120,
  };
}

// ─────────────────────────── Pontos de controle ───────────────────────────

export const VERSAO_PONTOS = "pontos-v1";

export const esquemaPontos = z.object({
  pontos: z.array(
    z.object({
      etapa: z.enum(CODIGOS_ETAPA),
      local: z.string().describe("nome exato de um local da lista recebida (ou de um ambiente do projeto)"),
      regiao: z.string().nullable().describe("agrupamento para o checklist, ex.: 'Laje L4 — eixos A a D'"),
      descricao: z.string().describe("o que medir, curto e objetivo, em português"),
      grandeza: z.enum(["nivel", "distancia", "prumo", "esquadro", "existencia"]),
      valor_esperado: z
        .string()
        .nullable()
        .describe("número com ponto decimal, na unidade; null só para existência"),
      unidade: z.enum(["m", "cm", "mm", "booleano"]),
      tolerancia_mais: z.string().nullable().describe("null = usar a tolerância padrão da construtora"),
      tolerancia_menos: z.string().nullable(),
      eh_interface: z.boolean().describe("encontro com algo já executado ou de outro material/sistema"),
      local_referencia: z.string().nullable().describe("interface: nome do local já executado"),
      referencia_nivel: z.string().nullable(),
      exige_foto: z.boolean(),
      trecho_origem: z
        .string()
        .describe("cópia EXATA do texto do projeto (ou nome da camada) de onde o ponto saiu"),
    }),
  ),
});
export type SaidaPontos = z.infer<typeof esquemaPontos>;

const SISTEMA_PONTOS = `Você ajuda engenheiros civis no Brasil a conferir a execução da obra contra o projeto ANTES das etapas sem volta (concretagem, fechamento de drywall, piso, forro).

A partir do material extraído de um projeto (textos, cotas de nível, ambientes com área, camadas), proponha PONTOS DE CONTROLE: medidas objetivas que o encarregado faz em campo com trena, nível laser ou topografia, com valor esperado e tolerância.

Regras:
1. Só proponha pontos que o projeto sustenta. Cada ponto cita em trecho_origem uma cópia exata do texto (ou o nome da camada) de onde veio. Não invente valores.
2. Dê ênfase a INTERFACES: encontro entre lajes (níveis dos dois lados com a mesma referência de nível), entre pisos de materiais diferentes, trilhos embutidos piso/forro, vãos alinhados com marcenaria, pontos hidráulicos e elétricos em parede antes do fechamento. Em interface, informe local_referencia (o lado já executado).
3. Use apenas etapas do catálogo: ${CATALOGO}. O local precisa ser um nome da lista de locais da obra ou de um ambiente do projeto.
4. valor_esperado como número com ponto decimal (ex.: "6.00"), na unidade informada; grandeza "existencia" usa unidade "booleano" e valor null.
5. Tolerância: só preencha se o projeto ou norma citada no projeto definir; senão deixe null (vale a padrão da construtora).
6. Prefira poucos pontos certeiros a muitos genéricos. Se o material não sustenta nenhum ponto, devolva a lista vazia.
7. Os pontos são SUGESTÕES: o engenheiro responsável revisa e aprova antes de qualquer uso.`;

export interface MaterialPontos {
  projeto: { disciplina: string; titulo: string; codigo: string; revisao: string };
  locais: { nome: string; tipo: string }[];
  ambientes: { nome: string; areaM2: string | null }[];
  cotasNivel: { texto: string; camada: string }[];
  textos: { texto: string; camada: string }[];
  camadas: string[];
}

export function tarefaPontos(m: MaterialPontos): TarefaEstruturada<SaidaPontos> {
  const secao = (titulo: string, linhas: string[]) =>
    `## ${titulo}\n${linhas.length ? linhas.join("\n") : "(nenhum)"}`;
  return {
    nome: VERSAO_PONTOS,
    modelo: modelos().pontos,
    esforco: "high",
    sistema: SISTEMA_PONTOS,
    usuario: [
      `Projeto ${m.projeto.codigo} rev. ${m.projeto.revisao}: ${m.projeto.titulo} (disciplina: ${m.projeto.disciplina}).`,
      secao(
        "Locais da obra",
        m.locais.map((l) => `- ${l.nome} (${l.tipo})`),
      ),
      secao(
        "Ambientes do projeto",
        m.ambientes.map((a) => `- ${a.nome}${a.areaM2 ? ` — ${a.areaM2} m²` : ""}`),
      ),
      secao(
        "Cotas de nível",
        m.cotasNivel.map((c) => `- ${c.texto} [camada ${c.camada}]`),
      ),
      secao(
        "Textos do projeto",
        m.textos.map((t) => `- ${t.texto.replace(/\n/g, " / ")} [camada ${t.camada}]`),
      ),
      secao(
        "Camadas",
        m.camadas.map((c) => `- ${c}`),
      ),
    ].join("\n\n"),
    esquema: esquemaPontos,
    maxTokens: 16000,
  };
}

// ─────────────────────────── Interpretação de mensagem livre (fallback) ───────────────────────────

export const VERSAO_INTERPRETACAO = "interpretacao-v1";

export const esquemaInterpretacao = z.object({
  classificacao: z.enum(["medida", "ocorrencia", "pergunta", "outro"]),
  medidas: z.array(
    z.object({
      ponto: z
        .number()
        .int()
        .nullable()
        .describe("índice do ponto provável na lista; null se não der para saber"),
      valor: z.string().describe("número com ponto decimal, como o encarregado informou"),
      unidade: z.enum(["m", "cm", "mm"]),
      valor_referencia: z.string().nullable().describe("interface: valor do lado já executado, se informado"),
      mesma_rn: z.boolean().nullable(),
    }),
  ),
  resumo: z.string().describe("uma frase curta em português, para confirmar com o encarregado"),
});
export type SaidaInterpretacao = z.infer<typeof esquemaInterpretacao>;

const SISTEMA_INTERPRETACAO = `Você lê mensagens de encarregados de obra no WhatsApp (texto ou áudio transcrito) e extrai medidas informadas.

Classifique a mensagem (medida, ocorrencia, pergunta, outro). Para cada medida, indique o ponto de controle provável pelo índice da lista recebida, o valor com ponto decimal e a unidade. Não calcule se está dentro da tolerância: isso é feito por outro sistema. Se não tiver certeza do ponto, use null. O resumo é o que será mostrado ao encarregado para ele confirmar, ex.: "Fundo da laje L4, eixo B = 6,04 m".`;

export function tarefaInterpretacao(
  mensagem: string,
  pontos: { descricao: string; local: string; esperado: string }[],
): TarefaEstruturada<SaidaInterpretacao> {
  return {
    nome: VERSAO_INTERPRETACAO,
    modelo: modelos().classificacao,
    esforco: "low",
    sistema: SISTEMA_INTERPRETACAO,
    usuario: `Pontos em conferência:\n${pontos.map((p, i) => `[${i}] ${p.descricao} — ${p.local} — esperado ${p.esperado}`).join("\n") || "(nenhum)"}\n\nMensagem:\n${mensagem}`,
    esquema: esquemaInterpretacao,
    maxTokens: 2000,
  };
}

// ─────────────────────────── Cruzamento do cronograma com os projetos ───────────────────────────

export const VERSAO_CRUZAMENTO = "cruzamento-v1";

export const esquemaCruzamento = z.object({
  riscos: z.array(
    z.object({
      fase_uid: z.number().int().describe("uid da fase da lista recebida"),
      nivel: z.enum(["alto", "medio", "baixo"]),
      titulo: z.string().describe("frase de conflito curta: o projeto pede X; o cronograma dá Y"),
      projeto: z.string().describe("código do projeto citado, exatamente como na lista"),
      projeto_trecho: z.string().describe("cópia EXATA de um texto recebido daquele projeto"),
      cronograma_linha: z.number().int().nullable().describe("linha do cronograma citada"),
      cronograma_trecho: z.string().describe("o que a linha citada mostra: nome, datas, %"),
      consequencia: z.string().describe("o que acontece na obra se nada mudar"),
      perguntas: z.array(
        z.object({
          momento: z.enum(["antes", "durante", "depois"]),
          texto: z.string().describe("pergunta curta, que o encarregado responde em campo pelo celular"),
          tipo: z.enum(["sim_nao", "opcao", "data", "medida", "texto"]),
          opcoes: z
            .array(z.string())
            .describe(
              'opcao: as opções, até 30 caracteres cada; medida: só a unidade, ["m"], ["cm"] ou ["mm"]; outros: []',
            ),
          esperada: z
            .string()
            .nullable()
            .describe(
              'resposta certa, quando houver: "Sim"/"Não"; uma das opções; "<=AAAA-MM-DD" ou ">=AAAA-MM-DD"; "min..max" com ponto decimal',
            ),
          pede_foto: z.boolean(),
        }),
      ),
    }),
  ),
});
export type SaidaCruzamento = z.infer<typeof esquemaCruzamento>;

const SISTEMA_CRUZAMENTO = `Você ajuda engenheiros civis no Brasil a antecipar problemas da obra cruzando o CRONOGRAMA (MS Project) com os PROJETOS (textos e notas lidos dos DWG).

Aponte RISCOS POR FASE que nascem do ENCONTRO das duas fontes, nunca de uma só:
- o projeto pede X e o cronograma dá Y (ex.: o projeto pede 21 dias de escoramento e o cronograma carrega a laje de cima em 10);
- uma nota "a definir", "a confirmar" ou "aguardando" com a fase que depende dela às portas;
- um prazo entre tarefas menor do que o projeto exige (cura, escoramento, encunhamento, teste de estanqueidade).

Para cada risco:
1. fase_uid: o uid de uma fase da lista. cronograma_linha: a linha citada (a fase ou uma tarefa dela).
2. titulo: frase de conflito curta, ex.: "O projeto pede 21 dias de escoramento; o cronograma carrega a laje do térreo em 10".
3. projeto: o código do projeto citado. projeto_trecho: cópia EXATA de um texto recebido daquele projeto, sem mudar letra, acento nem pontuação. Sem trecho para citar, não há risco.
4. cronograma_trecho: o que a linha citada mostra (nome, datas, %). consequencia: o que acontece na obra se nada mudar.
5. nivel: alto = retrabalho caro, estrutural ou de segurança; medio = retrabalho de sistemas ou acabamento; baixo = ajuste simples.
6. perguntas: curtas, para o encarregado responder em campo pelo celular; pelo menos uma por risco, distribuídas nos três momentos (antes de a fase começar, durante, depois de terminar). Use "esperada" quando houver resposta certa: "Sim" ou "Não" (sim_nao); uma das opções (opcao, com até 30 caracteres por opção); "<=AAAA-MM-DD" ou ">=AAAA-MM-DD" (data); "min..max" com ponto decimal (medida, na unidade que vai em opcoes: ["m"], ["cm"] ou ["mm"]). Peça foto quando a evidência ajudar.

Não invente: nada de valor, prazo ou exigência que não esteja nos textos recebidos ou nas linhas do cronograma. Prefira poucos riscos certeiros a muitos genéricos. Se o material não sustenta nenhum risco, devolva a lista vazia. Os riscos e as perguntas são SUGESTÕES: o engenheiro revisa e aprova antes de qualquer envio.`;

/**
 * O texto como a conferência do trecho citado o vê: quebra de linha e espaços repetidos viram um
 * espaço. Mostrar o texto assim ao modelo é o que deixa a cópia exata passar na conferência.
 */
export const espacosNormalizados = (t: string) => t.replace(/\s+/g, " ").trim();

export interface MaterialCruzamento {
  /** AAAA-MM-DD */
  hoje: string;
  projetos: { codigo: string; revisao: string; titulo: string; disciplina: string; textos: string[] }[];
  fases: {
    uid: number;
    nome: string;
    etapa: string | null;
    linha: number;
    inicio: string | null;
    termino: string | null;
    percentual: number;
    tarefas: {
      linha: number;
      nome: string;
      inicio: string | null;
      termino: string | null;
      percentual: number;
    }[];
  }[];
}

export function tarefaCruzamento(m: MaterialCruzamento): TarefaEstruturada<SaidaCruzamento> {
  const datas = (inicio: string | null, termino: string | null) =>
    `${inicio ?? "sem início"} a ${termino ?? "sem término"}`;
  return {
    nome: VERSAO_CRUZAMENTO,
    modelo: process.env.IA_MODELO_CRUZAMENTO || modelos().pontos,
    esforco: "high",
    sistema: SISTEMA_CRUZAMENTO,
    usuario: [
      `Hoje: ${m.hoje}.`,
      `## Projetos\n${
        m.projetos
          .map(
            (p) =>
              `### ${p.codigo} rev. ${p.revisao}: ${p.titulo} (disciplina: ${p.disciplina})\n${
                p.textos.length
                  ? p.textos.map((t) => `- ${espacosNormalizados(t)}`).join("\n")
                  : "(sem textos)"
              }`,
          )
          .join("\n\n") || "(nenhum)"
      }`,
      `## Cronograma (fases e as tarefas de cada uma)\n${
        m.fases
          .map((f) =>
            [
              `- fase uid ${f.uid} · linha ${f.linha} · ${f.nome}${f.etapa ? ` (etapa: ${f.etapa})` : ""} · ${datas(f.inicio, f.termino)} · ${f.percentual}%`,
              ...f.tarefas.map(
                (t) => `  - linha ${t.linha} · ${t.nome} · ${datas(t.inicio, t.termino)} · ${t.percentual}%`,
              ),
            ].join("\n"),
          )
          .join("\n") || "(nenhuma)"
      }`,
    ].join("\n\n"),
    esquema: esquemaCruzamento,
    maxTokens: 16000,
  };
}
