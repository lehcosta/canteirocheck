"use server";

import { normalizarWhatsapp } from "@canteirocheck/servicos";
import { z } from "zod";
import { enviarEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { campos, type EstadoAcao } from "../acao";

const FAIXAS = ["1 a 3", "4 a 10", "Mais de 10"] as const;

const pedido = z.object({
  nome: z.string().trim().min(2, "Escreva seu nome.").max(120),
  construtora: z.string().trim().min(2, "Escreva o nome da construtora.").max(160),
  whatsapp: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const e164 = normalizarWhatsapp(v);
      if (!e164) ctx.addIssue({ code: "custom", message: "WhatsApp com DDD, por exemplo (11) 99999-8888." });
      return e164 ?? "";
    }),
  email: z.union([z.literal(""), z.email("E-mail inválido.")]).default(""),
  obras: z.enum(FAIXAS).default("1 a 3"),
  // armadilha para robôs: campo escondido que pessoas não preenchem
  site: z.string().max(0).default(""),
});

function escapar(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Pedido de demonstração da landing page: valida e manda para a caixa CONTATO_EMAIL. */
export async function pedirDemonstracaoAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const r = pedido.safeParse(campos(form));
  if (!r.success) return { erro: r.error.issues[0]?.message ?? "Confira os campos." };
  const p = r.data;
  if (p.site) return { ok: "Recebido." }; // robô: finge sucesso e descarta

  if (!env.CONTATO_EMAIL) {
    console.error("[demonstracao] CONTATO_EMAIL não configurado; pedido perdido de", p.construtora);
    return { erro: "Não foi possível enviar agora. Tente de novo mais tarde." };
  }
  const linhas = [
    ["Nome", p.nome],
    ["Construtora", p.construtora],
    ["WhatsApp", p.whatsapp],
    ["E-mail", p.email || "—"],
    ["Obras em andamento", p.obras],
  ];
  try {
    await enviarEmail({
      para: env.CONTATO_EMAIL,
      assunto: `Pedido de demonstração — ${p.construtora}`,
      texto: linhas.map(([k, v]) => `${k}: ${v}`).join("\n"),
      html: `<table>${linhas.map(([k, v]) => `<tr><th align="left">${k}</th><td>${escapar(v ?? "")}</td></tr>`).join("")}</table>`,
    });
  } catch (e) {
    console.error("[demonstracao] falha ao enviar e-mail", e);
    return { erro: "Não foi possível enviar agora. Tente de novo em instantes." };
  }
  return { ok: "Recebido." };
}
