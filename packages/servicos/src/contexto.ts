import type { Ator } from "@canteirocheck/db";

export type PapelPainel = "admin" | "engenheiro";

/** Quem está agindo. Montado a partir da sessão do painel (ou, mais tarde, do número do WhatsApp). */
export interface Contexto {
  tenantId: string;
  usuarioId: string;
  papel: PapelPainel | "encarregado";
}

export class ErroDominio extends Error {
  constructor(
    readonly codigo: "permissao" | "nao_encontrado" | "conflito" | "invalido",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}

/** Erro de validação por campo, para a tela marcar o campo: `campo` no formato "perguntas.3.texto". */
export class ErroDeCampo extends ErroDominio {
  constructor(
    readonly campo: string,
    mensagem: string,
  ) {
    super("invalido", mensagem);
    this.name = "ErroDeCampo";
  }
}

export function exigirPapel(ctx: Contexto, papeis: readonly Contexto["papel"][]): void {
  if (!papeis.includes(ctx.papel)) {
    throw new ErroDominio("permissao", "Você não tem permissão para esta ação.");
  }
}

export const ator = (ctx: Contexto): Ator => ({ tipo: "usuario", id: ctx.usuarioId });

/** Traduz violações de constraint do Postgres em mensagens para o usuário. */
export function traduzirErroBanco(e: unknown, mensagens: Record<string, string>): never {
  const causa =
    (e as { cause?: { code?: string; constraint?: string } })?.cause ??
    (e as { code?: string; constraint?: string });
  if (causa?.code === "23505" || causa?.code === "23514") {
    const mensagem = (causa.constraint && mensagens[causa.constraint]) ?? mensagens._padrao;
    if (mensagem) throw new ErroDominio(causa.code === "23505" ? "conflito" : "invalido", mensagem);
  }
  throw e;
}
