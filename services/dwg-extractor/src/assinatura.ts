import { ErroExtracao } from "./erros.ts";

const ASSINATURA_DWG = /^AC\d{4}$/;

/** Todo DWG começa com o código de versão ASCII ("AC1015", "AC1032"...). Sem dependências: roda na thread principal. */
export function exigirAssinaturaDwg(bytes: Uint8Array): void {
  if (!ASSINATURA_DWG.test(new TextDecoder("latin1").decode(bytes.subarray(0, 6)))) {
    throw new ErroExtracao("arquivo_invalido", "Arquivo não é um DWG (assinatura ACxxxx ausente).");
  }
}
