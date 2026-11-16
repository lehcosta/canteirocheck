/**
 * Contrato HTTP do dwg-extractor. Os consumidores (código proprietário) devem
 * copiar estes tipos — nunca importar este pacote (GPL-3.0).
 *
 * Tudo aqui é primitivo e bruto: nenhum texto é limpo, nenhuma camada é interpretada.
 */

export type TipoTexto = "TEXT" | "MTEXT" | "ATTRIB" | "ATTDEF";

export interface Camada {
  nome: string;
  desligada: boolean;
  congelada: boolean;
  /** Entidades de nível superior do espaço do modelo nesta camada (INSERT conta 1; ATTRIBs e conteúdo de blocos não contam). */
  entidades: number;
}

export interface Texto {
  tipo: TipoTexto;
  /** Texto exatamente como armazenado (códigos MTEXT como `\P`, `{\f...;}` e `%%c` preservados). */
  conteudo: string;
  camada: string;
  x: number | null;
  y: number | null;
  altura: number | null;
  /** ATTRIB: bloco inserido; TEXT/MTEXT/ATTDEF vindos de uma definição de bloco: nome desse bloco; senão null. */
  bloco: string | null;
  /** Tag de ATTRIB/ATTDEF; senão null. */
  tag: string | null;
}

export interface Atributo {
  tag: string;
  valor: string;
}

export interface Insercao {
  bloco: string;
  camada: string;
  x: number;
  y: number;
  atributos: Atributo[];
}

export interface Polilinha {
  camada: string;
  fechada: boolean;
  vertices: [number, number][];
  /** Quantidade de vértices com bulge ≠ 0 (segmentos em arco, ignorados nos vértices). */
  arcos: number;
}

export interface Cota {
  camada: string;
  /** Texto de substituição da cota (null quando vazio — a cota exibe a medida). */
  texto: string | null;
  medida: number | null;
  x: number | null;
  y: number | null;
}

export interface ResultadoExtracao {
  versao: { extrator: string; libredwgWeb: string };
  /** `versao`: código do cabeçalho, ex. "AC1015"; `unidades`: código bruto de $INSUNITS como string, ex. "6" (metros). */
  dwg: { versao: string | null; unidades: string | null };
  camadas: Camada[];
  textos: Texto[];
  insercoes: Insercao[];
  polilinhas: Polilinha[];
  cotas: Cota[];
}

export type CodigoErro =
  | "arquivo_invalido"
  | "arquivo_muito_grande"
  | "timeout"
  | "falha_interna"
  | "nao_encontrado";

export interface RespostaErro {
  erro: string;
  codigo: CodigoErro;
}
