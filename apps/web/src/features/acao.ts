import { ErroDeCampo, ErroDominio } from "@canteirocheck/servicos";

/** `campo`: o campo que o erro marca ("perguntas.3.texto"), quando ele vem de um `ErroDeCampo`. */
export type EstadoAcao = { erro?: string; ok?: string; campo?: string } | undefined;
export type Acao = (estado: EstadoAcao, form: FormData) => Promise<EstadoAcao>;

/** Erro de domínio vira mensagem para o usuário; o resto é logado e vira mensagem genérica. */
export function tratarErro(e: unknown): EstadoAcao {
  if (e instanceof ErroDeCampo) return { erro: e.message, campo: e.campo };
  if (e instanceof ErroDominio) return { erro: e.message };
  console.error("[acao] erro inesperado", e);
  return { erro: "Não foi possível concluir. Tente de novo em instantes." };
}

/** FormData → objeto simples (só campos de texto). */
export function campos(form: FormData): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") r[k] = v;
  return r;
}
