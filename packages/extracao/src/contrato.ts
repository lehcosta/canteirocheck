/**
 * Cópia dos tipos do contrato HTTP do dwg-extractor (services/dwg-extractor/src/contrato.ts).
 * COPIADOS de propósito: o extrator é GPL-3.0 e o código proprietário não importa nada dele.
 * Mudou lá → atualize aqui (o teste de contrato no worker valida a resposta com zod).
 */

export type TipoTexto = "TEXT" | "MTEXT" | "ATTRIB" | "ATTDEF";

export interface Camada {
  nome: string;
  desligada: boolean;
  congelada: boolean;
  entidades: number;
}

export interface Texto {
  tipo: TipoTexto;
  conteudo: string;
  camada: string;
  x: number | null;
  y: number | null;
  altura: number | null;
  bloco: string | null;
  tag: string | null;
}

export interface Insercao {
  bloco: string;
  camada: string;
  x: number;
  y: number;
  atributos: { tag: string; valor: string }[];
}

export interface Polilinha {
  camada: string;
  fechada: boolean;
  vertices: [number, number][];
  arcos: number;
}

export interface Cota {
  camada: string;
  texto: string | null;
  medida: number | null;
  x: number | null;
  y: number | null;
}

export interface ResultadoExtracao {
  versao: { extrator: string; libredwgWeb: string };
  dwg: { versao: string | null; unidades: string | null };
  camadas: Camada[];
  textos: Texto[];
  insercoes: Insercao[];
  polilinhas: Polilinha[];
  cotas: Cota[];
}
