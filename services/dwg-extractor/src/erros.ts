import type { CodigoErro } from "./contrato.ts";

export class ErroExtracao extends Error {
  readonly codigo: CodigoErro;

  constructor(codigo: CodigoErro, mensagem: string) {
    super(mensagem);
    this.name = "ErroExtracao";
    this.codigo = codigo;
  }
}

export function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
