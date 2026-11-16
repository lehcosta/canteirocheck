import { z } from "zod";

/**
 * Corpo do webhook (docs/referencia-meta-whatsapp.md §5). Leitura tolerante: campos que não usamos
 * passam; o que usamos é validado. Cada mensagem vira uma `EntradaWebhook` normalizada.
 */

const midia = z
  .object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional() })
  .loose();

const mensagem = z
  .object({
    id: z.string(),
    from: z.string().optional(), // pode faltar para quem adotou username (BSUID)
    from_user_id: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string(),
    context: z.object({ id: z.string().optional(), from: z.string().optional() }).loose().optional(),
    text: z.object({ body: z.string() }).loose().optional(),
    image: midia.extend({ caption: z.string().optional() }).optional(),
    audio: midia.extend({ voice: z.boolean().optional() }).optional(),
    button: z.object({ payload: z.string().optional(), text: z.string().optional() }).loose().optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).loose().optional(),
        list_reply: z.object({ id: z.string(), title: z.string() }).loose().optional(),
        nfm_reply: z
          .object({ name: z.string().optional(), body: z.string().optional(), response_json: z.string() })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const status = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string().optional(),
    recipient_id: z.string().optional(),
    pricing: z
      .object({
        billable: z.boolean().optional(),
        pricing_model: z.string().optional(),
        type: z.string().optional(),
        category: z.string().optional(),
      })
      .loose()
      .optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .loose();

export const corpoWebhook = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          id: z.string().optional(),
          changes: z.array(
            z
              .object({
                field: z.string(),
                value: z
                  .object({
                    metadata: z.object({ phone_number_id: z.string().optional() }).loose().optional(),
                    contacts: z
                      .array(
                        z.object({ wa_id: z.string().optional(), user_id: z.string().optional() }).loose(),
                      )
                      .optional(),
                    messages: z.array(mensagem).optional(),
                    statuses: z.array(status).optional(),
                  })
                  .loose(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
  })
  .loose();

export type MensagemWebhook = z.infer<typeof mensagem>;
export type StatusWebhook = z.infer<typeof status>;

/** Conteúdo normalizado do que o usuário mandou. */
export type ConteudoEntrada =
  | { tipo: "texto"; texto: string }
  | { tipo: "botao"; id: string; titulo: string } // interactive.button_reply / list_reply
  | { tipo: "resposta_template"; payload: string; texto: string } // botão quick reply de template
  | { tipo: "flow"; resposta: Record<string, unknown> } // nfm_reply.response_json
  | { tipo: "imagem"; mediaId: string; mimeType: string | null; legenda: string | null }
  | { tipo: "audio"; mediaId: string; mimeType: string | null }
  | { tipo: "outro"; tipoOriginal: string };

export interface EntradaWebhook {
  waMessageId: string;
  waId: string | null;
  tipo: string;
  conteudo: ConteudoEntrada;
  bruto: MensagemWebhook;
}

export function conteudoDaMensagem(m: MensagemWebhook): ConteudoEntrada {
  switch (m.type) {
    case "text":
      return m.text ? { tipo: "texto", texto: m.text.body } : { tipo: "outro", tipoOriginal: m.type };
    case "image":
      return m.image
        ? {
            tipo: "imagem",
            mediaId: m.image.id,
            mimeType: m.image.mime_type ?? null,
            legenda: m.image.caption ?? null,
          }
        : { tipo: "outro", tipoOriginal: m.type };
    case "audio":
      return m.audio
        ? { tipo: "audio", mediaId: m.audio.id, mimeType: m.audio.mime_type ?? null }
        : { tipo: "outro", tipoOriginal: m.type };
    case "button":
      return { tipo: "resposta_template", payload: m.button?.payload ?? "", texto: m.button?.text ?? "" };
    case "interactive": {
      const i = m.interactive;
      const escolha = i?.button_reply ?? i?.list_reply;
      if (escolha) return { tipo: "botao", id: escolha.id, titulo: escolha.title };
      if (i?.nfm_reply) {
        try {
          return { tipo: "flow", resposta: JSON.parse(i.nfm_reply.response_json) as Record<string, unknown> };
        } catch {
          return { tipo: "outro", tipoOriginal: "nfm_reply_invalido" };
        }
      }
      return { tipo: "outro", tipoOriginal: `interactive:${i?.type ?? "?"}` };
    }
    default:
      return { tipo: "outro", tipoOriginal: m.type };
  }
}

/** Extrai mensagens e status de um corpo já validado. */
export function lerWebhook(corpo: unknown): { mensagens: EntradaWebhook[]; status: StatusWebhook[] } {
  const r = corpoWebhook.parse(corpo);
  const mensagens: EntradaWebhook[] = [];
  const statusLista: StatusWebhook[] = [];
  for (const entry of r.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const contato = change.value.contacts?.[0];
      for (const m of change.value.messages ?? []) {
        mensagens.push({
          waMessageId: m.id,
          waId: m.from ?? contato?.wa_id ?? null,
          tipo: m.type,
          conteudo: conteudoDaMensagem(m),
          bruto: m,
        });
      }
      statusLista.push(...(change.value.statuses ?? []));
    }
  }
  return { mensagens, status: statusLista };
}
