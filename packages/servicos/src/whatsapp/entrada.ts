import { aguardaDecisao, liberacaoExigeJustificativa } from "@canteirocheck/core";
import { schema, type Tx } from "@canteirocheck/db";
import type { ConteudoEntrada } from "@canteirocheck/whatsapp";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Contexto, ErroDominio } from "../contexto";
import { decidirExecucao } from "../execucoes/anuncio-e-decisao";
import { comSavepoint, type Efeitos, emTransacao } from "../transacao";
import { liberarMensagensEsperando, prepararMensagem } from "./saida";
import {
  descreverExecucao,
  enviarFlowAnuncio,
  enviarFlowChecklist,
  enviarFlowJustificativa,
  rotuloExecucao,
} from "./sessoes";

const { mensagemWhatsapp, usuario, execucaoEtapa, obraMembro, obra, etapa, local } = schema;

/**
 * Job `processar_mensagem`: a mensagem já está gravada (webhook). Aqui: abre a janela (libera o que
 * esperava), e roteia — botões, respostas de template, texto livre. Nenhuma regra de tolerância aqui.
 */
export async function processarMensagemRecebida(
  tenantId: string | null,
  mensagemId: string,
): Promise<{ acao: string }> {
  if (!tenantId) return { acao: "ignorada:numero_desconhecido" };
  return emTransacao(tenantId, async (tx, efeitos) => {
    const [m] = await tx.select().from(mensagemWhatsapp).where(eq(mensagemWhatsapp.id, mensagemId));
    if (!m?.usuarioId || m.direcao !== "entrada") return { acao: "ignorada" };
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, m.usuarioId));
    if (!u?.ativo) return { acao: "ignorada:inativo" };
    const ctx: Contexto = { tenantId, usuarioId: u.id, papel: u.papel };

    await liberarMensagensEsperando(tx, efeitos, tenantId, u.id);
    const conteudo = (m.payload as { conteudo?: ConteudoEntrada }).conteudo;
    if (!conteudo) return { acao: "ignorada:sem_conteudo" };

    const responder = (texto: string) =>
      prepararMensagem(tx, efeitos, {
        tenantId,
        usuarioId: u.id,
        payload: { assunto: "resposta", mensagem: { tipo: "texto", texto } },
      });

    try {
      switch (conteudo.tipo) {
        case "botao":
          return await comSavepoint(tx, efeitos, (sp, ef) => tratarBotao(sp, ef, ctx, conteudo.id));
        case "resposta_template":
          return await comSavepoint(tx, efeitos, (sp, ef) =>
            tratarRespostaTemplate(sp, ef, ctx, conteudo.payload),
          );
        case "flow":
          return { acao: "flow:resposta_recebida" }; // já tratado de forma síncrona no endpoint
        case "texto":
        case "imagem":
        case "audio":
          await mandarMenu(tx, efeitos, ctx, u.nome);
          return { acao: `menu:${conteudo.tipo}` };
        default:
          await mandarMenu(tx, efeitos, ctx, u.nome);
          return { acao: "menu:outro" };
      }
    } catch (e) {
      if (e instanceof ErroDominio) {
        await responder(e.message);
        return { acao: `erro:${e.codigo}` };
      }
      throw e;
    }
  });
}

async function tratarBotao(tx: Tx, efeitos: Efeitos, ctx: Contexto, id: string): Promise<{ acao: string }> {
  const [tipo, alvo, rodadaTexto] = id.split(":");
  switch (tipo) {
    case "menu":
      if (alvo === "anunciar") {
        await enviarFlowAnuncio(tx, efeitos, { tenantId: ctx.tenantId, usuarioId: ctx.usuarioId });
        return { acao: "flow:anuncio" };
      }
      if (alvo === "conferir") return oferecerConferencias(tx, efeitos, ctx);
      if (alvo === "pendentes") return oferecerDecisoes(tx, efeitos, ctx);
      break;
    case "conferir": {
      if (!alvo) break;
      const r = await enviarFlowChecklist(tx, efeitos, { usuarioId: ctx.usuarioId, execucaoId: alvo });
      if (!r.enviado) throw new ErroDominio("conflito", r.motivo ?? "Nada para conferir.");
      return { acao: "flow:checklist" };
    }
    case "lib":
    case "rec": {
      if (!alvo) break;
      const rodada = Number(rodadaTexto);
      const d = await descreverExecucao(tx, alvo);
      if (d.responsavelId !== ctx.usuarioId) {
        throw new ErroDominio("permissao", "Só o engenheiro responsável pela obra decide.");
      }
      if (d.rodadaAtual !== rodada || !aguardaDecisao(d.status)) {
        throw new ErroDominio(
          "conflito",
          `${rotuloExecucao(d)} não aguarda mais esta decisão (status: ${d.status}).`,
        );
      }
      if (tipo === "lib" && !liberacaoExigeJustificativa(d.status)) {
        await decidirExecucao(tx, efeitos, ctx, {
          execucaoId: alvo,
          rodada,
          decisao: "liberada",
          canal: "conversa",
        });
        await prepararMensagem(tx, efeitos, {
          tenantId: ctx.tenantId,
          usuarioId: ctx.usuarioId,
          obraId: d.obraId,
          execucaoId: d.id,
          payload: {
            assunto: "liberação registrada",
            mensagem: {
              tipo: "texto",
              texto: `✅ ${rotuloExecucao(d)} liberada. ${d.anunciadaPorNome} foi avisado.`,
            },
          },
        });
        return { acao: "decisao:liberada" };
      }
      await enviarFlowJustificativa(tx, efeitos, {
        usuarioId: ctx.usuarioId,
        execucaoId: alvo,
        rodada,
        decisao: tipo === "lib" ? "liberada" : "recusada",
      });
      return { acao: "flow:justificativa" };
    }
  }
  throw new ErroDominio("invalido", "Não reconheci esta opção. Mande uma mensagem para ver o menu.");
}

async function tratarRespostaTemplate(tx: Tx, efeitos: Efeitos, ctx: Contexto, payload: string) {
  const [tipo, alvo] = payload.split(":");
  if (tipo === "anunciar") {
    await enviarFlowAnuncio(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      obraId: alvo ?? null,
    });
    return { acao: "flow:anuncio" };
  }
  return { acao: "janela_aberta" }; // "ver": o que esperava já foi liberado
}

async function mandarMenu(tx: Tx, efeitos: Efeitos, ctx: Contexto, nome: string) {
  const primeiro = nome.split(" ")[0] ?? nome;
  const botoes =
    ctx.papel === "encarregado"
      ? [
          { id: "menu:anunciar", titulo: "Anunciar execução" },
          { id: "menu:conferir", titulo: "Fazer conferência" },
        ]
      : [
          { id: "menu:pendentes", titulo: "Decisões pendentes" },
          { id: "menu:anunciar", titulo: "Anunciar execução" },
        ];
  await prepararMensagem(tx, efeitos, {
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    payload: {
      assunto: "menu",
      mensagem: {
        tipo: "botoes",
        texto: `Olá, ${primeiro}. Medidas e fotos são registradas pela conferência (formulário). O que você quer fazer?`,
        botoes,
      },
    },
  });
}

/** Execuções da equipe do usuário que podem ser conferidas agora. */
async function oferecerConferencias(tx: Tx, efeitos: Efeitos, ctx: Contexto) {
  const abertas = await tx
    .select({ id: execucaoEtapa.id, etapa: etapa.nome, local: local.nome, data: execucaoEtapa.dataPrevista })
    .from(execucaoEtapa)
    .innerJoin(
      obraMembro,
      and(eq(obraMembro.obraId, execucaoEtapa.obraId), eq(obraMembro.usuarioId, ctx.usuarioId)),
    )
    .innerJoin(etapa, eq(etapa.id, execucaoEtapa.etapaId))
    .innerJoin(local, eq(local.id, execucaoEtapa.localId))
    .where(inArray(execucaoEtapa.status, ["anunciada", "em_conferencia", "recusada"]))
    .orderBy(asc(execucaoEtapa.dataPrevista))
    .limit(3);
  if (abertas.length === 0) {
    await prepararMensagem(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      payload: {
        assunto: "conferências",
        mensagem: {
          tipo: "botoes",
          texto: "Não há execução anunciada esperando conferência. Anuncie primeiro o que vai ser executado.",
          botoes: [{ id: "menu:anunciar", titulo: "Anunciar execução" }],
        },
      },
    });
    return { acao: "conferir:nenhuma" };
  }
  if (abertas.length === 1 && abertas[0]) {
    const r = await enviarFlowChecklist(tx, efeitos, { usuarioId: ctx.usuarioId, execucaoId: abertas[0].id });
    if (!r.enviado) throw new ErroDominio("conflito", r.motivo ?? "Nada para conferir.");
    return { acao: "flow:checklist" };
  }
  await prepararMensagem(tx, efeitos, {
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    payload: {
      assunto: "conferências",
      mensagem: {
        tipo: "botoes",
        texto: `Qual conferência?\n${abertas.map((a) => `• ${a.etapa} · ${a.local}`).join("\n")}`,
        botoes: abertas.map((a) => ({
          id: `conferir:${a.id}`,
          titulo: `${a.etapa.slice(0, 10)} ${a.local}`.slice(0, 20),
        })),
      },
    },
  });
  return { acao: "conferir:escolha" };
}

/** Engenheiro: reenvia o resumo das execuções que esperam a decisão dele. */
async function oferecerDecisoes(tx: Tx, efeitos: Efeitos, ctx: Contexto) {
  const pendentes = await tx
    .select({ id: execucaoEtapa.id, rodada: execucaoEtapa.rodadaAtual })
    .from(execucaoEtapa)
    .innerJoin(obra, eq(obra.id, execucaoEtapa.obraId))
    .where(
      and(
        eq(obra.engenheiroResponsavelId, ctx.usuarioId),
        inArray(execucaoEtapa.status, ["bloqueada", "aguardando_liberacao"]),
      ),
    )
    .limit(5);
  for (const p of pendentes) {
    efeitos.enfileirar("notificar_engenheiro", {
      tenantId: ctx.tenantId,
      execucaoId: p.id,
      rodada: p.rodada,
    });
  }
  if (pendentes.length === 0) {
    await prepararMensagem(tx, efeitos, {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      payload: {
        assunto: "decisões",
        mensagem: { tipo: "texto", texto: "Nenhuma conferência aguardando sua decisão." },
      },
    });
  }
  return { acao: `decisoes:${pendentes.length}` };
}
