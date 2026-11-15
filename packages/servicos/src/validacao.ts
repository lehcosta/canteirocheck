import { z } from "zod";

/**
 * Normaliza telefone para E.164. Aceita formatos brasileiros comuns:
 * "(11) 99999-8888" → "+5511999998888"; "+55 11 99999-8888" → "+5511999998888".
 */
export function normalizarWhatsapp(entrada: string): string | null {
  const temMais = entrada.trim().startsWith("+");
  const digitos = entrada.replace(/\D/g, "");
  let e164: string;
  if (temMais) e164 = `+${digitos}`;
  else if (digitos.length === 10 || digitos.length === 11) e164 = `+55${digitos}`;
  else if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) e164 = `+${digitos}`;
  else return null;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

export const campoWhatsapp = z.string().transform((valor, ctx) => {
  const e164 = normalizarWhatsapp(valor);
  if (!e164) {
    ctx.addIssue({ code: "custom", message: "WhatsApp inválido. Use DDD + número, ex.: (11) 99999-8888." });
    return z.NEVER;
  }
  return e164;
});

export const campoEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "E-mail inválido." }));

export const textoObrigatorio = (rotulo: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, { message: `${rotulo} é obrigatório.` })
    .max(max, { message: `${rotulo}: no máximo ${max} caracteres.` });

export const textoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const uuid = z.uuid({ message: "Identificador inválido." });

/** Converte o erro do zod na primeira mensagem legível. */
export function primeiraMensagem(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}
