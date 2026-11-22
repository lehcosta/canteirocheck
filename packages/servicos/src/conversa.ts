import {
  comNovaTentativa,
  custoTranscricao,
  type Llm,
  llmPadrao,
  type SaidaInterpretacao,
  type Transcritor,
  tarefaInterpretacao,
  transcritorPadrao,
  VERSAO_INTERPRETACAO,
} from "@canteirocheck/ai";
import {
  converter,
  formatarComprimento,
  formatarEsperado,
  lerNumero,
  situacaoDoPonto,
  type Unidade,
} from "@canteirocheck/core";
import { schema, type Tx, withTenant } from "@canteirocheck/db";
import { type ClienteWhatsapp, type ConteudoEntrada, clienteWhatsapp } from "@canteirocheck/whatsapp";
import { and, eq, inArray } from "drizzle-orm";
import { responderCheckPorTexto } from "./checks-envio";
import { type Contexto, ErroDominio } from "./contexto";
import { aplicarEvento, registrarMedida, type SessaoChecklist } from "./execucoes/conferencia";
import { carregarPontos, registrosDaRodada, travarExecucao } from "./execucoes/pontos";
import { type Efeitos, emTransacao } from "./transacao";
import { prepararMensagem } from "./whatsapp/saida";

const { mensagemWhatsapp, execucaoEtapa, obraMembro, eventoCusto, usuario } = schema;

/**
 * Fallback conversacional (prompt §6.5): sem sinal para o formulário, o encarregado manda texto ou
 * áudio. A IA SÓ extrai o número e o ponto provável; a comparação continua no core, e a verificação
 * (não estruturada) só é gravada depois que ele confirma.
 */

interface PontoCandidato {
  execucaoId: string;
  pontoId: string;
  descricao: string;
  local: string;
  esperado: string;
  unidade: Unidade;
  ehInterface: boolean;
}

interface Interpretacao {
  transcricao?: string;
  saida?: SaidaInterpretacao;
  candidatos?: PontoCandidato[];
  modelo?: string;
}

async function pontosEmConferencia(tx: Tx, usuarioId: string): Promise<PontoCandidato[]> {
  const execs = await tx
    .select({ e: execucaoEtapa })
    .from(execucaoEtapa)
    .innerJoin(
      obraMembro,
      and(eq(obraMembro.obraId, execucaoEtapa.obraId), eq(obraMembro.usuarioId, usuarioId)),
    )
    .where(inArray(execucaoEtapa.status, ["anunciada", "em_conferencia", "bloqueada", "recusada"]))
    .limit(10);
  const saida: PontoCandidato[] = [];
  for (const { e } of execs) {
    const rodada = e.status === "recusada" ? e.rodadaAtual + 1 : e.rodadaAtual;
    const registros = await registrosDaRodada(tx, e.id, rodada);
    for (const p of await carregarPontos(tx, e)) {
      if (situacaoDoPonto(p.id, registros).tipo !== "medir") continue;
      saida.push({
        execucaoId: e.id,
        pontoId: p.id,
        descricao: p.descricao,
        local: p.localNome,
        esperado: formatarEsperado(p),
        unidade: p.unidade,
        ehInterface: p.ehInterface,
      });
    }
  }
  return saida.slice(0, 30);
}

async function custo(
  tx: Tx,
  tenantId: string,
  tipo: "llm_tokens" | "transcricao_audio",
  quantidade: string,
  valor: string,
  ref: string,
) {
  await tx
    .insert(eventoCusto)
    .values({ tenantId, tipo, quantidade, custoEstimado: valor, moeda: "USD", referencia: ref });
}

/** Job `transcrever_audio`: áudio do chat → texto → interpretação. */
export async function transcreverAudio(
  tenantId: string,
  mensagemId: string,
  deps: { transcritor?: Transcritor | null; cliente?: ClienteWhatsapp } = {},
) {
  const transcritor = deps.transcritor === undefined ? transcritorPadrao() : deps.transcritor;
  const [m] = await withTenant(tenantId, (tx) =>
    tx.select().from(mensagemWhatsapp).where(eq(mensagemWhatsapp.id, mensagemId)),
  );
  const conteudo = (m?.payload as { conteudo?: ConteudoEntrada } | undefined)?.conteudo;
  if (!m || conteudo?.tipo !== "audio") return { status: "ignorada" };
  if (!transcritor) {
    await responder(
      tenantId,
      m.usuarioId,
      "Recebi o áudio, mas a transcrição não está ligada. Use a conferência pelo formulário.",
    );
    return { status: "sem_transcritor" };
  }
  const { dados, mimeType } = await (deps.cliente ?? clienteWhatsapp()).baixarMidia(conteudo.mediaId);
  const { texto, segundos } = await transcritor.transcrever(dados, mimeType);
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(mensagemWhatsapp)
      .set({ interpretacao: { transcricao: texto } satisfies Interpretacao })
      .where(eq(mensagemWhatsapp.id, mensagemId));
    await custo(
      tx,
      tenantId,
      "transcricao_audio",
      String(segundos ?? 0),
      custoTranscricao(segundos),
      transcritor.nome,
    );
  });
  // Áudio de quem tem um check esperando resposta em texto: a transcrição é a resposta.
  if (m.usuarioId) {
    const usuarioId = m.usuarioId;
    const doCheck = await emTransacao(tenantId, async (tx, ef) => {
      const [u] = await tx.select({ papel: usuario.papel }).from(usuario).where(eq(usuario.id, usuarioId));
      return u ? responderCheckPorTexto(tx, ef, { tenantId, usuarioId, papel: u.papel }, texto) : null;
    });
    if (doCheck) return { status: doCheck.acao };
  }
  return interpretarMensagem(tenantId, mensagemId);
}

async function responder(tenantId: string, usuarioId: string | null, texto: string) {
  if (!usuarioId) return;
  await emTransacao(tenantId, (tx, ef) =>
    prepararMensagem(tx, ef, {
      tenantId,
      usuarioId,
      payload: { assunto: "resposta", mensagem: { tipo: "texto", texto } },
    }),
  );
}

/** Job `interpretar_mensagem`: texto (ou transcrição) → medida + ponto provável → pedido de confirmação. */
export async function interpretarMensagem(
  tenantId: string,
  mensagemId: string,
  llm: Llm | null = llmPadrao(),
) {
  if (!llm) return { status: "sem_ia" };
  const [m] = await withTenant(tenantId, (tx) =>
    tx.select().from(mensagemWhatsapp).where(eq(mensagemWhatsapp.id, mensagemId)),
  );
  if (!m?.usuarioId) return { status: "ignorada" };
  const anterior = (m.interpretacao ?? {}) as Interpretacao;
  const conteudo = (m.payload as { conteudo?: ConteudoEntrada }).conteudo;
  const texto = anterior.transcricao ?? (conteudo?.tipo === "texto" ? conteudo.texto : null);
  if (!texto) return { status: "sem_texto" };
  const usuarioId = m.usuarioId;

  const candidatos = await withTenant(tenantId, (tx) => pontosEmConferencia(tx, usuarioId));
  const { resultado, usos } = await comNovaTentativa(
    llm,
    tarefaInterpretacao(
      texto,
      candidatos.map((c) => ({ descricao: c.descricao, local: c.local, esperado: c.esperado })),
    ),
  );

  return emTransacao(tenantId, async (tx, efeitos) => {
    for (const u of usos) {
      await custo(
        tx,
        tenantId,
        "llm_tokens",
        String(u.entrada + u.saida),
        u.custoUsd,
        `${u.modelo}@${VERSAO_INTERPRETACAO}`,
      );
    }
    const [u] = await tx
      .select({ papel: usuario.papel, nome: usuario.nome })
      .from(usuario)
      .where(eq(usuario.id, usuarioId));
    const menu = async (prefixo: string) =>
      prepararMensagem(tx, efeitos, {
        tenantId,
        usuarioId,
        payload: {
          assunto: "resposta",
          mensagem: {
            tipo: "botoes",
            texto: `${prefixo}O que você quer fazer?`,
            botoes:
              u?.papel === "encarregado"
                ? [
                    { id: "menu:anunciar", titulo: "Anunciar execução" },
                    { id: "menu:conferir", titulo: "Fazer conferência" },
                  ]
                : [{ id: "menu:pendentes", titulo: "Decisões pendentes" }],
          },
        },
      });

    if (!resultado.ok) {
      await menu("Não entendi a mensagem. ");
      return { status: "falhou" };
    }
    const saida = resultado.saida;
    await tx
      .update(mensagemWhatsapp)
      .set({
        classificacao: saida.classificacao,
        interpretacao: {
          ...anterior,
          saida,
          candidatos,
          modelo: usos.at(-1)?.modelo,
        } satisfies Interpretacao,
      })
      .where(eq(mensagemWhatsapp.id, mensagemId));

    const medidas = saida.medidas.filter((x) => x.ponto !== null && candidatos[x.ponto]);
    if (saida.classificacao !== "medida" || medidas.length === 0) {
      await menu(
        saida.classificacao === "medida" ? "Não consegui ligar a medida a um ponto em conferência. " : "",
      );
      return { status: saida.classificacao };
    }
    for (const [i, med] of saida.medidas.entries()) {
      const c = med.ponto !== null ? candidatos[med.ponto] : undefined;
      if (!c) continue;
      await prepararMensagem(tx, efeitos, {
        tenantId,
        usuarioId,
        execucaoId: c.execucaoId,
        payload: {
          assunto: "confirmação de medida",
          mensagem: {
            tipo: "botoes",
            texto: `Entendi: ${c.descricao} (${c.local}) = ${med.valor.replace(".", ",")} ${med.unidade}. Confirma?`,
            rodape: "Medida não estruturada: fica marcada para revisão.",
            botoes: [
              { id: `conf:${mensagemId}:${i}`, titulo: "Confirmar" },
              { id: "menu:conferir", titulo: "Usar formulário" },
            ],
          },
        },
      });
      if (i >= 2) break;
    }
    return { status: "confirmacao_pedida", medidas: medidas.length };
  });
}

/** Botão "Confirmar": grava a verificação (canal conversa, não estruturada) e devolve o resultado. */
export async function confirmarMedidaDaConversa(
  tx: Tx,
  efeitos: Efeitos,
  ctx: Contexto,
  mensagemId: string,
  indice: number,
): Promise<{ acao: string }> {
  const [m] = await tx.select().from(mensagemWhatsapp).where(eq(mensagemWhatsapp.id, mensagemId));
  const inter = (m?.interpretacao ?? {}) as Interpretacao;
  const med = inter.saida?.medidas[indice];
  const c = med?.ponto !== null && med?.ponto !== undefined ? inter.candidatos?.[med.ponto] : undefined;
  if (!m || m.usuarioId !== ctx.usuarioId || !med || !c)
    throw new ErroDominio("nao_encontrado", "Não achei essa medida.");
  if (c.ehInterface) {
    throw new ErroDominio(
      "invalido",
      "Ponto de interface precisa dos dois lados e da referência de nível: use o formulário.",
    );
  }
  const lido = lerNumero(med.valor);
  if (!lido.ok) throw new ErroDominio("invalido", "Valor ilegível; use o formulário.");

  let exec = await travarExecucao(tx, c.execucaoId);
  if (exec.status === "anunciada" || exec.status === "recusada")
    exec = await aplicarEvento(tx, exec, "iniciar_conferencia");
  const sessao: SessaoChecklist = {
    token: "",
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    execucaoId: exec.id,
    estado: { rodada: exec.rodadaAtual, titulo: "conversa", pontos: [c.pontoId], lote: 1, totalLotes: 1 },
    concluida: false,
  };
  const valor = med.unidade === c.unidade ? lido.valor : converter(lido.valor, med.unidade, c.unidade);
  const r = await registrarMedida(tx, efeitos, {
    sessao,
    pontoId: c.pontoId,
    medida: { tipo: "valor", valor },
    canal: "conversa",
    estruturada: false,
    observacao: `via conversa: ${inter.saida?.resumo ?? ""}`.slice(0, 300),
  });
  const texto = r.avaliacao.dentro
    ? `✅ ${c.descricao}: ${formatarComprimento(valor, c.unidade)} — dentro da tolerância. Registrado (não estruturado, para revisão).`
    : `❌ ${c.descricao}: ${formatarComprimento(valor, c.unidade)} — fora da tolerância (${c.esperado}). Meça de novo pela conferência.`;
  await prepararMensagem(tx, efeitos, {
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    execucaoId: exec.id,
    payload: {
      assunto: "medida registrada",
      mensagem: r.avaliacao.dentro
        ? { tipo: "texto", texto }
        : { tipo: "botoes", texto, botoes: [{ id: `conferir:${exec.id}`, titulo: "Abrir conferência" }] },
    },
  });
  return { acao: r.avaliacao.dentro ? "conversa:medida_ok" : "conversa:medida_fora" };
}
