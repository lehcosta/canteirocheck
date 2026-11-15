import {
  type EntradaMedida,
  formatarComprimento,
  formatarDiferenca,
  formatarEsperado,
  formatarTolerancia,
  lerNumero,
  MENSAGEM_ERRO_NUMERO,
  TEXTO_MOTIVO,
  type Unidade,
} from "@canteirocheck/core";
import { resolverSessaoFlow, type SessaoFlowResolvida, schema, type Tx } from "@canteirocheck/db";
import {
  type DadosAnuncio,
  type DadosCausa,
  type DadosInicio,
  type DadosJustificar,
  type DadosMedir,
  type DadosResumo,
  lerTelaDoChecklist,
  type Opcao,
  TELAS,
} from "@canteirocheck/whatsapp/flows";
import { and, desc, eq } from "drizzle-orm";
import { type Contexto, ErroDominio } from "../contexto";
import { anunciarExecucoes, decidirExecucao, opcoesDeAnuncio } from "../execucoes/anuncio-e-decisao";
import {
  carregarSessaoChecklist,
  concluirLote,
  estadoDaSessao,
  type FotoRecebida,
  registrarCausa,
  registrarMedida,
  type SessaoChecklist,
} from "../execucoes/conferencia";
import type { PontoDaExecucao } from "../execucoes/pontos";
import { comSavepoint, type Efeitos, emTransacao } from "../transacao";
import { prepararMensagem } from "./saida";
import { descreverExecucao, type EstadoJustificativa, enviarFlowChecklist, rotuloExecucao } from "./sessoes";

const { verificacao, usuario, obra, flowSessao } = schema;

/**
 * Endpoint de Flows, já decifrado. Lê o banco e roda o core — nada de IA nem download aqui
 * (limite de 10 s da Meta; alvo < 1 s). Fotos viram `midia` pendente e o worker baixa.
 */

export interface PedidoFlow {
  version?: string;
  action: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

export type RespostaFlow = { status: 200; corpo: unknown } | { status: 427; corpo: { error_msg: string } };

const ok = (corpo: unknown): RespostaFlow => ({ status: 200, corpo });
const tela = (screen: string, data: object, erro?: string): RespostaFlow =>
  ok({ screen, data: erro ? { ...data, error_message: erro.slice(0, 120) } : data });
const sucesso = (flowToken: string, params: Record<string, string> = {}): RespostaFlow =>
  ok({
    screen: "SUCCESS",
    data: { extension_message_response: { params: { flow_token: flowToken, ...params } } },
  });
const tokenInvalido = (mensagem: string): RespostaFlow => ({ status: 427, corpo: { error_msg: mensagem } });

export async function tratarPedidoFlow(pedido: PedidoFlow): Promise<RespostaFlow> {
  if (pedido.action === "ping") return ok({ data: { status: "active" } });
  if (pedido.data && "error" in pedido.data) {
    // Notificação de erro do cliente (resposta nossa que ele não aceitou).
    console.error("[flow] notificação de erro do WhatsApp", {
      token: pedido.flow_token?.slice(0, 8),
      data: pedido.data,
    });
    return ok({ data: { acknowledged: true } });
  }
  const token = pedido.flow_token ?? "";
  const sessao = await resolverSessaoFlow(token);
  if (!sessao) return tokenInvalido("Conferência não encontrada. Peça uma nova.");
  if (sessao.expirada) return tokenInvalido("Esta mensagem expirou. Peça uma nova.");

  switch (sessao.tipo) {
    case "checklist":
      return tratarChecklist(token, sessao, pedido);
    case "anuncio":
      return tratarAnuncio(token, sessao, pedido);
    case "recusa":
      return tratarJustificativa(token, sessao, pedido);
  }
}

async function contextoDaSessao(tx: Tx, s: SessaoFlowResolvida): Promise<Contexto | null> {
  const [u] = await tx
    .select({ papel: usuario.papel, ativo: usuario.ativo })
    .from(usuario)
    .where(eq(usuario.id, s.usuarioId));
  if (!u?.ativo) return null;
  return { tenantId: s.tenantId, usuarioId: s.usuarioId, papel: u.papel };
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroDominio) return e.message;
  console.error("[flow] erro inesperado", e);
  return "Não foi possível registrar. Tente de novo.";
}

// ─────────────────────────── Checklist ───────────────────────────

const UNIDADE_EXTENSO: Record<Unidade, string> = {
  m: "em metros",
  cm: "em centímetros",
  mm: "em milímetros",
  booleano: "",
};
const EXEMPLO: Record<Unidade, string> = { m: "6,005", cm: "12,5", mm: "3", booleano: "" };

const CAUSAS: Opcao[] = [
  { id: "forma_fora_do_nivel", title: "Forma montada fora do nível" },
  { id: "escoramento", title: "Escoramento cedeu" },
  { id: "referencia_errada", title: "Referência de nível errada" },
  { id: "projeto", title: "Projeto diverge do executado" },
  { id: "medicao", title: "Erro de medição" },
  { id: "outro", title: "Outro (descreva)" },
];

type Estado = Awaited<ReturnType<typeof estadoDaSessao>>;

function dadosMedir(e: Estado, sessao: SessaoChecklist, indice: number, aviso = ""): DadosMedir {
  const p = e.pontos[indice];
  if (!p) throw new ErroDominio("invalido", "Ponto fora da conferência.");
  const existencia = p.grandeza === "existencia";
  const unidade = UNIDADE_EXTENSO[p.unidade];
  return {
    progresso: `Ponto ${indice + 1} de ${e.pontos.length} · ${sessao.estado.titulo}`,
    descricao: p.descricao,
    esperado: p.ehInterface
      ? `Esperado: ${formatarEsperado(p)} nos dois lados, com a mesma RN`
      : `Esperado: ${formatarEsperado(p)}`,
    referencia_nivel: p.referenciaNivel
      ? `Referência de nível: ${p.referenciaNivel}`
      : "Use a referência de nível da obra",
    aviso,
    tem_aviso: aviso !== "",
    simples: !p.ehInterface && !existencia,
    interface: p.ehInterface,
    existencia,
    ajuda_medida: `Medida ${unidade}. Ex.: ${EXEMPLO[p.unidade]}`,
    ajuda_referencia: `${p.localReferenciaNome ?? "Lado já executado"}, ${unidade}`,
    ajuda_novo: `${p.localNome}, ${unidade}`,
    foto_descricao: p.exigeFoto ? "Obrigatória neste ponto" : "Opcional",
  };
}

async function textoFalha(tx: Tx, sessao: SessaoChecklist, p: PontoDaExecucao): Promise<string> {
  const [v] = await tx
    .select()
    .from(verificacao)
    .where(
      and(
        eq(verificacao.execucaoId, sessao.execucaoId),
        eq(verificacao.rodada, sessao.estado.rodada),
        eq(verificacao.pontoId, p.id),
      ),
    )
    .orderBy(desc(verificacao.tentativa))
    .limit(1);
  if (!v) return "❌ Fora da tolerância";
  return `❌ Confirmado na ${v.tentativa}ª medida: ${descreverMedida(p, v)}`;
}

function descreverMedida(
  p: PontoDaExecucao,
  v: {
    valorMedido: string | null;
    valorReferencia: string | null;
    diferenca: string | null;
    mesmaReferenciaNivel: boolean | null;
    dentroTolerancia: boolean;
  },
): string {
  if (p.grandeza === "existencia") return v.dentroTolerancia ? "executado" : "não executado";
  if (!v.valorMedido) return "";
  const medido = formatarComprimento(v.valorMedido, p.unidade);
  if (p.ehInterface && v.valorReferencia) {
    const ref = formatarComprimento(v.valorReferencia, p.unidade);
    const rn = v.mesmaReferenciaNivel === false ? "; RN diferente" : "";
    const dif = v.diferenca ? `dif. ${formatarDiferenca(v.diferenca, p.unidade)}` : "";
    return `${p.localNome} ${medido} × ${p.localReferenciaNome ?? "lado executado"} ${ref} (${dif}; tolerância ${formatarTolerancia(p)}${rn})`;
  }
  const dif = v.diferenca ? ` (dif. ${formatarDiferenca(v.diferenca, p.unidade)})` : "";
  return `${medido}${dif}; esperado ${formatarEsperado(p)}`;
}

async function dadosCausa(tx: Tx, e: Estado, sessao: SessaoChecklist, indice: number): Promise<DadosCausa> {
  const p = e.pontos[indice];
  if (!p) throw new ErroDominio("invalido", "Ponto fora da conferência.");
  return {
    progresso: `Ponto ${indice + 1} de ${e.pontos.length} · ${sessao.estado.titulo}`,
    descricao: p.descricao,
    falha: await textoFalha(tx, sessao, p),
    causas: CAUSAS,
  };
}

async function dadosResumo(tx: Tx, e: Estado, sessao: SessaoChecklist): Promise<DadosResumo> {
  const linhas: string[] = [];
  for (const p of e.pontos) {
    const [v] = await tx
      .select()
      .from(verificacao)
      .where(
        and(
          eq(verificacao.execucaoId, sessao.execucaoId),
          eq(verificacao.rodada, sessao.estado.rodada),
          eq(verificacao.pontoId, p.id),
        ),
      )
      .orderBy(desc(verificacao.tentativa))
      .limit(1);
    const situacao = e.resumo.ok.includes(p.id) ? "✅" : e.resumo.divergentes.includes(p.id) ? "❌" : "⏳";
    linhas.push(`${situacao} ${p.descricao}${v ? `: ${descreverMedida(p, v)}` : ""}`);
  }
  const d = await descreverExecucao(tx, sessao.execucaoId);
  const status =
    e.resumo.divergentes.length > 0 || e.exec.status === "bloqueada"
      ? `Execução BLOQUEADA. ${d.responsavelNome} será avisada para decidir.`
      : `Tudo dentro da tolerância. ${d.responsavelNome} será avisada para liberar.`;
  return { titulo: rotuloExecucao(d), texto: linhas.join("\n"), status };
}

async function respostaDoPasso(
  tx: Tx,
  e: Estado,
  sessao: SessaoChecklist,
  aviso = "",
): Promise<RespostaFlow> {
  const passo = e.passo;
  if (passo.tipo === "medir")
    return tela(TELAS.medir(passo.indice), dadosMedir(e, sessao, passo.indice, aviso));
  if (passo.tipo === "causa")
    return tela(TELAS.causa(passo.indice), await dadosCausa(tx, e, sessao, passo.indice));
  return tela(TELAS.resumo, await dadosResumo(tx, e, sessao));
}

function fotoDoPayload(valor: unknown): FotoRecebida | null {
  const lista = Array.isArray(valor) ? valor : [];
  const f = lista[0] as
    | { cdn_url?: string; encryption_metadata?: unknown; file_name?: string; media_id?: string }
    | undefined;
  if (!f?.cdn_url || !f.encryption_metadata) return null;
  const ext = f.file_name?.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return {
    origem: "flow_cdn",
    fonte: {
      cdn_url: f.cdn_url,
      encryption_metadata: f.encryption_metadata,
      file_name: f.file_name,
      media_id: f.media_id,
    },
    mimeType,
  };
}

const texto = (v: unknown) => (typeof v === "string" ? v : "");

function lerMedida(p: PontoDaExecucao, dados: Record<string, unknown>): EntradaMedida {
  const numero = (campo: string, rotulo: string) => {
    const r = lerNumero(texto(dados[campo]));
    if (!r.ok) throw new ErroDominio("invalido", `${rotulo}: ${MENSAGEM_ERRO_NUMERO[r.erro]}`);
    return r.valor;
  };
  if (p.grandeza === "existencia") {
    const v = texto(dados.existe);
    if (v !== "sim" && v !== "nao") throw new ErroDominio("invalido", "Responda se está executado.");
    return { tipo: "existencia", existe: v === "sim" };
  }
  if (p.ehInterface) {
    const rn = texto(dados.mesma_rn);
    if (rn !== "sim" && rn !== "nao") throw new ErroDominio("invalido", "Responda se é a mesma RN.");
    return {
      tipo: "interface",
      referencia: numero("referencia", "Lado executado"),
      novo: numero("novo", "Lado novo"),
      mesmaReferenciaNivel: rn === "sim",
    };
  }
  return { tipo: "valor", valor: numero("medida", "Medida") };
}

async function tratarChecklist(
  token: string,
  s: SessaoFlowResolvida,
  pedido: PedidoFlow,
): Promise<RespostaFlow> {
  const dados = pedido.data ?? {};
  const acao = pedido.action === "data_exchange" ? texto(dados.acao) : "abrir";

  return emTransacao(s.tenantId, async (txExterna, efeitosExternos) => {
    const sessao = await carregarSessaoChecklist(txExterna, token);
    let e = await estadoDaSessao(txExterna, sessao);
    if (e.rodadaVencida)
      return tokenInvalido("Esta conferência é de uma rodada anterior. Use a mais recente.");

    if (acao === "abrir") {
      const restantes = e.resumo.pendentes.length;
      const dadosInicio: DadosInicio = {
        titulo: (await descreverExecucao(txExterna, sessao.execucaoId).then(rotuloExecucao)).slice(0, 80),
        texto:
          restantes > 0
            ? `${restantes} ${restantes === 1 ? "ponto" : "pontos"} para medir${e.pontos.some((p) => p.ehInterface) ? ", interfaces primeiro" : ""}. Tenha a trena ou o nível laser à mão.`
            : "Todos os pontos desta parte já foram respondidos.",
        aviso: sessao.concluida ? "Esta parte da conferência já foi enviada." : "",
        tem_aviso: sessao.concluida,
      };
      return tela(TELAS.inicio, dadosInicio);
    }

    const telaAtual = pedido.screen ?? "";
    const lida = lerTelaDoChecklist(telaAtual);
    const antes = e;
    try {
      return await comSavepoint(txExterna, efeitosExternos, async (tx, efeitos) => {
        if (acao === "comecar") return await respostaDoPasso(tx, e, sessao);

        if (acao === "medir" && lida?.tipo === "medir") {
          const ponto = e.pontos[lida.indice];
          if (!ponto) throw new ErroDominio("invalido", "Ponto fora da conferência.");
          if (e.passo.tipo !== "medir" || e.passo.pontoId !== ponto.id) {
            return await respostaDoPasso(tx, e, sessao); // reenvio/voltar: segue do ponto pendente
          }
          const r = await registrarMedida(tx, efeitos, {
            sessao,
            pontoId: ponto.id,
            medida: lerMedida(ponto, dados),
            observacao: texto(dados.obs),
            foto: fotoDoPayload(dados.foto),
            canal: "flow",
          });
          e = await estadoDaSessao(tx, sessao);
          if (r.avaliacao.dentro) {
            return await respostaDoPasso(tx, e, sessao, `✅ Ponto ${lida.indice + 1} dentro da tolerância.`);
          }
          if (e.passo.tipo === "medir" && e.passo.pontoId === ponto.id) {
            const dif = r.avaliacao.diferenca
              ? ` (dif. ${formatarDiferenca(r.avaliacao.diferenca, ponto.unidade)})`
              : "";
            const motivo = r.avaliacao.motivo ? TEXTO_MOTIVO[r.avaliacao.motivo] : "fora da tolerância";
            return tela(
              TELAS.medir(lida.indice),
              dadosMedir(
                e,
                sessao,
                lida.indice,
                `❌ ${motivo}${dif}. Confira o instrumento e a referência e meça de novo.`,
              ),
            );
          }
          return await respostaDoPasso(tx, e, sessao);
        }

        if (acao === "causa" && lida?.tipo === "causa") {
          const ponto = e.pontos[lida.indice];
          if (!ponto) throw new ErroDominio("invalido", "Ponto fora da conferência.");
          if (e.passo.tipo !== "causa" || e.passo.pontoId !== ponto.id)
            return await respostaDoPasso(tx, e, sessao);
          const causaId = texto(dados.causa);
          const opcao = CAUSAS.find((c) => c.id === causaId);
          if (!opcao) throw new ErroDominio("invalido", "Escolha a causa provável.");
          const detalhe = texto(dados.detalhe).trim();
          if (causaId === "outro" && !detalhe)
            throw new ErroDominio("invalido", "Descreva a causa no detalhe.");
          await registrarCausa(tx, efeitos, {
            sessao,
            pontoId: ponto.id,
            causa: causaId === "outro" ? detalhe : opcao.title,
            descricao: causaId === "outro" ? null : detalhe || null,
            foto: fotoDoPayload(dados.foto),
          });
          e = await estadoDaSessao(tx, sessao);
          return await respostaDoPasso(
            tx,
            e,
            sessao,
            "Divergência registrada: a execução está bloqueada. Siga com os outros pontos.",
          );
        }

        if (acao === "concluir" && telaAtual === TELAS.resumo) {
          const r = await concluirLote(tx, efeitos, sessao);
          await avisarFimDoLote(tx, efeitos, sessao, r);
          return sucesso(token, { status: r.statusExecucao });
        }
        throw new ErroDominio("invalido", "Ação inesperada nesta tela.");
      });
    } catch (erro) {
      return await refrescar(txExterna, antes, sessao, telaAtual, mensagemDeErro(erro));
    }
  });
}

/** Erro → a MESMA tela, com os mesmos dados e o snackbar de erro (refresh permitido pela Meta). */
async function refrescar(tx: Tx, e: Estado, sessao: SessaoChecklist, telaAtual: string, erro: string) {
  const lida = lerTelaDoChecklist(telaAtual);
  if (lida?.tipo === "medir") return tela(telaAtual, dadosMedir(e, sessao, lida.indice), erro);
  if (lida?.tipo === "causa") return tela(telaAtual, await dadosCausa(tx, e, sessao, lida.indice), erro);
  if (telaAtual === TELAS.resumo) return tela(telaAtual, await dadosResumo(tx, e, sessao), erro);
  return tela(
    TELAS.inicio,
    { titulo: sessao.estado.titulo, texto: "", aviso: erro, tem_aviso: true } satisfies DadosInicio,
    erro,
  );
}

async function avisarFimDoLote(
  tx: Tx,
  efeitos: Efeitos,
  sessao: SessaoChecklist,
  r: Awaited<ReturnType<typeof concluirLote>>,
) {
  const d = await descreverExecucao(tx, sessao.execucaoId);
  const contagem = `${r.okDoLote.length} ✅${r.divergentesDoLote.length ? `, ${r.divergentesDoLote.length} ❌` : ""}`;
  let textoFim: string;
  if (!r.execucaoCompleta)
    textoFim = `Parte enviada (${contagem}). Faltam ${r.pontosRestantes} pontos; a próxima parte chega em seguida.`;
  else if (r.statusExecucao === "bloqueada")
    textoFim = `Conferência de ${rotuloExecucao(d)} enviada (${contagem}). Execução BLOQUEADA: não execute até a decisão de ${d.responsavelNome}, que já foi avisada.`;
  else
    textoFim = `Conferência de ${rotuloExecucao(d)} enviada (${contagem}). Aguarde a liberação de ${d.responsavelNome}, que já foi avisada.`;

  await prepararMensagem(tx, efeitos, {
    tenantId: d.tenantId,
    usuarioId: sessao.usuarioId,
    obraId: d.obraId,
    execucaoId: d.id,
    payload: { assunto: `conferência de ${rotuloExecucao(d)}`, mensagem: { tipo: "texto", texto: textoFim } },
  });
  if (!r.execucaoCompleta)
    await enviarFlowChecklist(tx, efeitos, { usuarioId: sessao.usuarioId, execucaoId: d.id });
}

// ─────────────────────────── Anúncio ───────────────────────────

function dataNoFuso(fuso: string, diasAFrente: number): string {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diasAFrente);
  return d.toISOString().slice(0, 10);
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function dadosAnuncio(tx: Tx, s: SessaoFlowResolvida, obraId: string | undefined, aviso = "") {
  const op = await opcoesDeAnuncio(tx, s.usuarioId);
  const obras = obraId ? op.obras.filter((o) => o.id === obraId) : op.obras;
  const locais = op.locais.filter((l) => obras.some((o) => o.id === l.obraId)).slice(0, 20);
  const nomeObra = (id: string) => obras.find((o) => o.id === id)?.nome ?? "";
  const amanha = dataNoFuso("America/Sao_Paulo", 1);
  const hoje = dataNoFuso("America/Sao_Paulo", 0);
  const dados: DadosAnuncio = {
    saudacao: obras.length === 1 ? `Obra ${obras[0]?.nome}` : "Escolha a etapa e os locais.",
    etapas: op.etapas.map((e) => ({ id: String(e.id), title: e.nome.slice(0, 30) })),
    locais: locais.map((l) => ({
      id: l.id,
      title: (obras.length > 1 ? `${nomeObra(l.obraId)} · ${l.nome}` : l.nome).slice(0, 30),
    })),
    quando: [
      { id: "hoje", title: `Hoje (${ddmm(hoje)})` },
      { id: "amanha", title: `Amanhã (${ddmm(amanha)})` },
    ],
    aviso,
    tem_aviso: aviso !== "",
  };
  return { dados, op, locais };
}

async function tratarAnuncio(
  token: string,
  s: SessaoFlowResolvida,
  pedido: PedidoFlow,
): Promise<RespostaFlow> {
  return emTransacao(s.tenantId, async (txAnuncio, efeitosAnuncio) => {
    const [linha] = await txAnuncio.select().from(flowSessao).where(eq(flowSessao.token, token));
    const obraId = (linha?.estado as { obraId?: string } | undefined)?.obraId;
    const ctx = await contextoDaSessao(txAnuncio, s);
    if (!ctx) return tokenInvalido("Seu acesso foi desativado.");
    const { dados: base, locais } = await dadosAnuncio(txAnuncio, s, obraId);
    if (pedido.action !== "data_exchange") {
      if (base.locais.length === 0)
        return tela(TELAS.anuncio, {
          ...base,
          aviso: "Você não está em nenhuma obra ativa.",
          tem_aviso: true,
        });
      return tela(TELAS.anuncio, base);
    }
    if (s.concluida) return tela(TELAS.anuncio, base, "Este anúncio já foi enviado.");

    const dados = pedido.data ?? {};
    try {
      return await comSavepoint(txAnuncio, efeitosAnuncio, async (tx, efeitos) => {
        const etapaId = Number(texto(dados.etapa));
        if (!Number.isInteger(etapaId) || etapaId <= 0) throw new ErroDominio("invalido", "Escolha a etapa.");
        const ids = Array.isArray(dados.locais) ? dados.locais.map(String) : [];
        const escolhidos = locais.filter((l) => ids.includes(l.id));
        if (escolhidos.length === 0 || escolhidos.length !== new Set(ids).size)
          throw new ErroDominio("invalido", "Escolha os locais.");
        const quando = texto(dados.quando) === "hoje" ? 0 : 1;

        const porObra = new Map<string, string[]>();
        for (const l of escolhidos) porObra.set(l.obraId, [...(porObra.get(l.obraId) ?? []), l.id]);
        const linhasResposta: string[] = [];
        const botoes: { id: string; titulo: string }[] = [];
        let ultimaObra: string | null = null;
        for (const [oid, localIds] of porObra) {
          const [o] = await tx.select({ fuso: obra.fusoHorario }).from(obra).where(eq(obra.id, oid));
          const dataPrevista = dataNoFuso(o?.fuso ?? "America/Sao_Paulo", quando);
          const r = await anunciarExecucoes(tx, efeitos, ctx, {
            obraId: oid,
            etapaId,
            localIds,
            dataPrevista,
          });
          ultimaObra = oid;
          for (const ex of r.execucoes) {
            linhasResposta.push(
              `• ${r.etapaNome} · ${ex.localNome} (${ddmm(dataPrevista)})${ex.semPontos ? " — ⚠️ sem pontos de controle aprovados; o engenheiro precisa aprovar antes da conferência" : ""}`,
            );
            if (!ex.semPontos && botoes.length < 3)
              botoes.push({ id: `conferir:${ex.id}`, titulo: `Conferir ${ex.localNome}`.slice(0, 20) });
          }
        }
        await tx.update(flowSessao).set({ concluidaEm: new Date() }).where(eq(flowSessao.token, token));
        const corpo = `Anotado:\n${linhasResposta.join("\n")}\n\nQuando estiver pronto para executar, faça a conferência.`;
        await prepararMensagem(tx, efeitos, {
          tenantId: s.tenantId,
          usuarioId: s.usuarioId,
          obraId: ultimaObra,
          payload: {
            assunto: "execução anotada",
            mensagem: botoes.length
              ? { tipo: "botoes", texto: corpo, botoes }
              : { tipo: "texto", texto: corpo },
          },
        });
        return sucesso(token, { anunciadas: String(linhasResposta.length) });
      });
    } catch (erro) {
      return tela(TELAS.anuncio, base, mensagemDeErro(erro));
    }
  });
}

// ─────────────────────────── Justificativa do engenheiro ───────────────────────────

async function tratarJustificativa(
  token: string,
  s: SessaoFlowResolvida,
  pedido: PedidoFlow,
): Promise<RespostaFlow> {
  return emTransacao(s.tenantId, async (txJ, efeitosJ) => {
    const [linha] = await txJ.select().from(flowSessao).where(eq(flowSessao.token, token));
    const estado = linha?.estado as EstadoJustificativa | undefined;
    const ctx = await contextoDaSessao(txJ, s);
    if (!estado || !ctx) return tokenInvalido("Esta mensagem não vale mais.");
    const d = await descreverExecucao(txJ, estado.execucaoId);
    const verbo = estado.decisao === "recusada" ? "Recusar" : "Liberar com divergência";
    const base: DadosJustificar = {
      titulo: `${verbo} · ${rotuloExecucao(d)}`.slice(0, 80),
      resumo: `${d.obraNome} — conferência de ${d.anunciadaPorNome}, rodada ${estado.rodada}.`,
    };
    if (pedido.action !== "data_exchange") return tela(TELAS.justificar, base);
    if (s.concluida) return tela(TELAS.justificar, base, "Esta decisão já foi registrada.");
    try {
      return await comSavepoint(txJ, efeitosJ, async (tx, efeitos) => {
        const justificativa = texto(pedido.data?.justificativa).trim();
        await decidirExecucao(tx, efeitos, ctx, {
          execucaoId: estado.execucaoId,
          rodada: estado.rodada,
          decisao: estado.decisao,
          justificativa,
          canal: "flow",
        });
        await tx.update(flowSessao).set({ concluidaEm: new Date() }).where(eq(flowSessao.token, token));
        await prepararMensagem(tx, efeitos, {
          tenantId: s.tenantId,
          usuarioId: s.usuarioId,
          obraId: d.obraId,
          execucaoId: d.id,
          payload: {
            assunto: "decisão registrada",
            mensagem: {
              tipo: "texto",
              texto: `${estado.decisao === "recusada" ? "Recusa" : "Liberação"} de ${rotuloExecucao(d)} registrada. ${d.anunciadaPorNome} foi avisado.`,
            },
          },
        });
        return sucesso(token, { decisao: estado.decisao });
      });
    } catch (erro) {
      return tela(TELAS.justificar, base, mensagemDeErro(erro));
    }
  });
}
