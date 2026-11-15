import path from "node:path";
import { type Dwg_Color, type DwgDatabase, LibreDwg, type LibreDwgEx } from "@mlightcad/libredwg-web";
import { ErroExtracao, mensagemDe } from "./erros.ts";
import { RAIZ_LIBREDWG_WEB } from "./versao.ts";

/** Bits de erro >= DWG_ERR_CRITICAL indicam leitura falha; os menores são avisos comuns em arquivos reais. */
const DWG_ERR_CRITICAL = 128;

export type Formato = "dwg" | "dxf";

export interface DesenhoLido {
  db: DwgDatabase;
  /** Código de versão do cabeçalho, ex. "AC1015". */
  versao: string | null;
}

interface ResultadoLeitura {
  error: number;
  data: number;
}

let instancia: Promise<LibreDwgEx> | undefined;
let sequencia = 0;

export function carregarLibreDwg(): Promise<LibreDwgEx> {
  instancia ??= LibreDwg.create(path.join(RAIZ_LIBREDWG_WEB, "wasm"));
  return instancia;
}

/**
 * Lê o arquivo com libredwg e converte para o DwgDatabase tipado do libredwg-web.
 * O Dwg_Data nativo é sempre liberado antes de retornar.
 */
export function lerDesenho(lib: LibreDwgEx, bytes: Uint8Array, formato: Formato): DesenhoLido {
  const ptr = abrir(lib, bytes, formato);
  try {
    const db = lib.convert(ptr);
    marcarCamadasDesligadas(lib, ptr, db);
    return { db, versao: versaoDoCabecalho(lib, ptr) };
  } finally {
    lib.dwg_free(ptr);
  }
}

/**
 * Usa dwg_read_file/dxf_read_file direto (e não LibreDwg.dwg_read_data) porque o wrapper
 * descarta o código de erro e devolve um ponteiro mesmo para arquivos ilegíveis.
 */
function abrir(lib: LibreDwgEx, bytes: Uint8Array, formato: Formato): number {
  const arquivo = `/entrada-${++sequencia}.${formato}`;
  lib.FS.writeFile(arquivo, bytes);
  let resultado: ResultadoLeitura;
  try {
    resultado = comoResultadoLeitura(
      formato === "dwg" ? lib.dwg_read_file(arquivo) : lib.dxf_read_file(arquivo),
    );
  } catch (erro) {
    throw new ErroExtracao("arquivo_invalido", `libredwg não conseguiu ler o arquivo: ${mensagemDe(erro)}`);
  } finally {
    lib.FS.unlink(arquivo);
  }
  if (resultado.error >= DWG_ERR_CRITICAL || !resultado.data) {
    if (resultado.data) lib.dwg_free(resultado.data);
    const codigo = `0x${resultado.error.toString(16)}`;
    throw new ErroExtracao(
      "arquivo_invalido",
      `Arquivo não é um ${formato.toUpperCase()} legível (libredwg ${codigo}).`,
    );
  }
  return resultado.data;
}

function comoResultadoLeitura(valor: unknown): ResultadoLeitura {
  if (typeof valor === "object" && valor !== null && "error" in valor && "data" in valor) {
    const { error, data } = valor;
    if (typeof error === "number" && typeof data === "number") return { error, data };
  }
  throw new Error("Retorno inesperado de dwg_read_file.");
}

function versaoDoCabecalho(lib: LibreDwgEx, ptr: number): string | null {
  const versao = lib.dwg_get_version_type(ptr);
  return versao && versao.type !== "invalid" && versao.hdr ? versao.hdr : null;
}

/**
 * O conversor do libredwg-web só lê o campo `off`; no DWG a camada desligada é gravada
 * como índice de cor negativo, que ele descarta. Corrige o DwgDatabase com o valor bruto.
 */
function marcarCamadasDesligadas(lib: LibreDwgEx, ptr: number, db: DwgDatabase): void {
  const desligadas = new Set<string>();
  for (const camada of lib.dwg_getall_LAYER(ptr)) {
    const cor = lib.dwg_dynapi_entity_data<Dwg_Color | undefined>(camada, "color");
    if (cor && cor.index < 0) desligadas.add(lib.dwg_dynapi_entity_data<string>(camada, "name"));
  }
  for (const entrada of db.tables.LAYER.entries) {
    if (desligadas.has(entrada.name)) entrada.off = true;
  }
}
