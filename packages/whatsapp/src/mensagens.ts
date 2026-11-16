/**
 * Mensagens de saída no NOSSO formato, convertidas para o payload da Cloud API num lugar só.
 * Limites conferidos na doc (docs/referencia-meta-whatsapp.md §4).
 */

export interface Botao {
  id: string; // até 256
  titulo: string; // até 20
}

export type MensagemSaida =
  | { tipo: "texto"; texto: string }
  | { tipo: "botoes"; texto: string; rodape?: string; botoes: Botao[] }
  | {
      tipo: "flow";
      texto: string;
      cabecalho?: string;
      rodape?: string;
      flowNome: string;
      /** Se informado, vai `flow_id` no lugar de `flow_name` (mapa WHATSAPP_FLOW_IDS). */
      flowId?: string;
      flowToken: string;
      cta: string; // até 30, sem emoji
      /** Rascunho: só para testes com Flow em DRAFT. */
      rascunho?: boolean;
    }
  | {
      tipo: "template";
      nome: string;
      idioma: string;
      parametros: string[];
      /** Payload de cada botão quick reply, na ordem do template. */
      respostasRapidas?: string[];
    };

export const LIMITES = {
  botoes: 3,
  tituloBotao: 20,
  idBotao: 256,
  corpoInterativo: 1024,
  rodape: 60,
  texto: 4096,
  cta: 30,
} as const;

function cortar(texto: string, max: number) {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

export class MensagemInvalida extends Error {}

export function validarMensagem(m: MensagemSaida): void {
  if (m.tipo === "botoes") {
    if (m.botoes.length === 0 || m.botoes.length > LIMITES.botoes) throw new MensagemInvalida("1 a 3 botões");
    const titulos = new Set<string>();
    for (const b of m.botoes) {
      if (b.titulo.length > LIMITES.tituloBotao)
        throw new MensagemInvalida(`título de botão longo: ${b.titulo}`);
      if (b.id.length > LIMITES.idBotao) throw new MensagemInvalida("id de botão longo");
      if (titulos.has(b.titulo)) throw new MensagemInvalida("títulos de botão repetidos");
      titulos.add(b.titulo);
    }
  }
  if (m.tipo === "flow" && m.cta.length > LIMITES.cta) throw new MensagemInvalida("CTA do Flow longo");
}

/** Payload do POST /{phone-number-id}/messages. */
export function paraGraph(destino: string, m: MensagemSaida): Record<string, unknown> {
  validarMensagem(m);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: destino };
  switch (m.tipo) {
    case "texto":
      return { ...base, type: "text", text: { preview_url: false, body: cortar(m.texto, LIMITES.texto) } };
    case "botoes":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: cortar(m.texto, LIMITES.corpoInterativo) },
          ...(m.rodape ? { footer: { text: cortar(m.rodape, LIMITES.rodape) } } : {}),
          action: { buttons: m.botoes.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo } })) },
        },
      };
    case "flow":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "flow",
          ...(m.cabecalho ? { header: { type: "text", text: cortar(m.cabecalho, 60) } } : {}),
          body: { text: cortar(m.texto, LIMITES.corpoInterativo) },
          ...(m.rodape ? { footer: { text: cortar(m.rodape, LIMITES.rodape) } } : {}),
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: m.flowToken,
              ...(m.flowId ? { flow_id: m.flowId } : { flow_name: m.flowNome }),
              flow_cta: m.cta,
              // INIT vai para o endpoint, que escolhe a primeira tela (flow_action_payload omitido)
              flow_action: "data_exchange",
              ...(m.rascunho ? { mode: "draft" } : {}),
            },
          },
        },
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: {
          name: m.nome,
          language: { code: m.idioma },
          components: [
            ...(m.parametros.length
              ? [{ type: "body", parameters: m.parametros.map((text) => ({ type: "text", text })) }]
              : []),
            ...(m.respostasRapidas ?? []).map((payload, i) => ({
              type: "button",
              sub_type: "quick_reply",
              index: String(i),
              parameters: [{ type: "payload", payload }],
            })),
          ],
        },
      };
  }
}

/** Texto curto para logs, painel e simulador. */
export function descreverMensagem(m: MensagemSaida): string {
  switch (m.tipo) {
    case "texto":
      return m.texto;
    case "botoes":
      return `${m.texto} [${m.botoes.map((b) => b.titulo).join(" | ")}]`;
    case "flow":
      return `${m.texto} [${m.cta}]`;
    case "template":
      return `template ${m.nome}(${m.parametros.join(", ")})`;
  }
}
