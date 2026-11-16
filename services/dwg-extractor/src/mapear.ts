import type {
  DwgAttdefEntity,
  DwgAttribEntity,
  DwgBlockRecordTableEntry,
  DwgDimensionEntity,
  DwgEntity,
  DwgInsertEntity,
  DwgLayerTableEntry,
  DwgLWPolylineEntity,
  DwgMTextEntity,
  DwgPolyline2dEntity,
  DwgTextEntity,
} from "@mlightcad/libredwg-web";
import type { Camada, Cota, Insercao, Polilinha, ResultadoExtracao, Texto, TipoTexto } from "./contrato.ts";
import {
  aplicar,
  compor,
  escalaVertical,
  IDENTIDADE,
  type Transformacao,
  transformacaoDaInsercao,
} from "./geometria.ts";
import type { DesenhoLido } from "./leitura.ts";

/** Limite de aninhamento ao expandir blocos (protege contra referências circulares). */
const PROFUNDIDADE_MAXIMA_BLOCOS = 8;
/** Bit "fechada" de Dwg_Entity_LWPOLYLINE.flag no DWG (não é o grupo 70 do DXF). */
const LWPOLYLINE_FECHADA = 512;
const POLYLINE_FECHADA = 1;
const ATTDEF_CONSTANTE = 2;

export interface Versoes {
  extrator: string;
  libredwgWeb: string;
}

interface Ponto {
  x: number;
  y: number;
}

interface VerticeBruto extends Ponto {
  bulge?: number;
}

interface DadosTexto {
  tipo: TipoTexto;
  conteudo: string | undefined;
  camada: string;
  ponto: Ponto | undefined;
  altura: number | undefined;
  tag: string | null;
}

interface Visita {
  blocos: Map<string, DwgBlockRecordTableEntry>;
  saida: Texto[];
}

/** Converte o DwgDatabase do libredwg-web no contrato bruto. Função pura. */
export function mapearDesenho(desenho: DesenhoLido, versoes: Versoes): ResultadoExtracao {
  const { db } = desenho;
  const registros = db.tables.BLOCK_RECORD.entries;
  const modelo = entidadesDosEspacos(registros, ehEspacoModelo);
  const todas = [...modelo, ...entidadesDosEspacos(registros, ehEspacoPapel)];
  return {
    versao: versoes,
    dwg: { versao: desenho.versao, unidades: unidades(db.header.INSUNITS) },
    camadas: mapearCamadas(db.tables.LAYER.entries, modelo),
    textos: coletarTextos(todas, indexarBlocos(registros)),
    insercoes: todas.filter(ehInsercao).map(mapearInsercao),
    polilinhas: todas.flatMap(mapearPolilinha),
    cotas: todas.filter(ehCota).map(mapearCota),
  };
}

function ehEspacoModelo(nome: string): boolean {
  return nome.toUpperCase() === "*MODEL_SPACE";
}

/** Inclui os layouts extras (*Paper_Space0, *Paper_Space1...). */
function ehEspacoPapel(nome: string): boolean {
  return nome.toUpperCase().startsWith("*PAPER_SPACE");
}

/** Entidades de nível superior. ATTRIBs só existem dentro de `insert.attribs`. */
function entidadesDosEspacos(registros: DwgBlockRecordTableEntry[], filtro: (nome: string) => boolean) {
  return registros
    .filter((registro) => filtro(registro.name))
    .flatMap((registro) => registro.entities)
    .filter((entidade) => entidade.type !== "ATTRIB");
}

function indexarBlocos(registros: DwgBlockRecordTableEntry[]): Map<string, DwgBlockRecordTableEntry> {
  return new Map(registros.map((registro) => [registro.name.toUpperCase(), registro]));
}

function unidades(insunits: number | undefined): string | null {
  return typeof insunits === "number" ? String(insunits) : null;
}

function mapearCamadas(entradas: DwgLayerTableEntry[], modelo: DwgEntity[]): Camada[] {
  const contagem = new Map<string, number>();
  for (const entidade of modelo) contagem.set(entidade.layer, (contagem.get(entidade.layer) ?? 0) + 1);
  return entradas.map((camada) => ({
    nome: camada.name,
    desligada: camada.off,
    congelada: camada.frozen,
    entidades: contagem.get(camada.name) ?? 0,
  }));
}

function coletarTextos(entidades: DwgEntity[], blocos: Map<string, DwgBlockRecordTableEntry>): Texto[] {
  const visita: Visita = { blocos, saida: [] };
  visitar(entidades, visita, IDENTIDADE, null, 0);
  return visita.saida;
}

function visitar(
  entidades: DwgEntity[],
  visita: Visita,
  t: Transformacao,
  bloco: string | null,
  nivel: number,
) {
  for (const entidade of entidades) {
    if (ehInsercao(entidade)) {
      visitarInsercao(entidade, visita, t, nivel);
    } else {
      const dados = dadosDeTexto(entidade, bloco !== null);
      if (dados) visita.saida.push(montarTexto(dados, t, bloco));
    }
  }
}

/** ATTRIBs da inserção + textos da definição do bloco (uma vez por INSERT, recursivo). */
function visitarInsercao(insercao: DwgInsertEntity, visita: Visita, t: Transformacao, nivel: number) {
  for (const atributo of insercao.attribs) {
    visita.saida.push(montarTexto(dadosDeAttrib(atributo), t, insercao.name));
  }
  const definicao = visita.blocos.get(insercao.name.toUpperCase());
  if (!definicao || nivel >= PROFUNDIDADE_MAXIMA_BLOCOS) return;
  const interna = compor(t, transformacaoDaInsercao(insercao, definicao.basePoint));
  visitar(definicao.entities, visita, interna, insercao.name, nivel + 1);
}

/**
 * Dentro de blocos, ATTDEF não constante é só o molde do ATTRIB (o valor real vem da inserção),
 * então só ATTDEFs constantes — que não geram ATTRIB — são reportados.
 */
function dadosDeTexto(entidade: DwgEntity, dentroDeBloco: boolean): DadosTexto | null {
  if (ehText(entidade)) return dadosDeText(entidade);
  if (ehMText(entidade)) return dadosDeMText(entidade);
  if (ehAttdef(entidade) && (!dentroDeBloco || (entidade.flags & ATTDEF_CONSTANTE) !== 0)) {
    return dadosDeAttdef(entidade);
  }
  return null;
}

function dadosDeText(e: DwgTextEntity): DadosTexto {
  return {
    tipo: "TEXT",
    conteudo: e.text,
    camada: e.layer,
    ponto: e.startPoint,
    altura: e.textHeight,
    tag: null,
  };
}

function dadosDeMText(e: DwgMTextEntity): DadosTexto {
  return {
    tipo: "MTEXT",
    conteudo: e.text,
    camada: e.layer,
    ponto: e.insertionPoint,
    altura: e.textHeight,
    tag: null,
  };
}

function dadosDeAttdef(e: DwgAttdefEntity): DadosTexto {
  const { text } = e;
  return {
    tipo: "ATTDEF",
    conteudo: text.text,
    camada: e.layer,
    ponto: text.startPoint,
    altura: text.textHeight,
    tag: e.tag,
  };
}

function dadosDeAttrib(e: DwgAttribEntity): DadosTexto {
  const { text } = e;
  return {
    tipo: "ATTRIB",
    conteudo: text.text,
    camada: e.layer,
    ponto: text.startPoint,
    altura: text.textHeight,
    tag: e.tag,
  };
}

function montarTexto(dados: DadosTexto, t: Transformacao, bloco: string | null): Texto {
  const ponto = dados.ponto ? aplicar(t, dados.ponto) : undefined;
  const altura = numero(dados.altura);
  return {
    tipo: dados.tipo,
    conteudo: dados.conteudo ?? "",
    camada: dados.camada,
    x: numero(ponto?.x),
    y: numero(ponto?.y),
    altura: altura === null ? null : altura * escalaVertical(t),
    bloco,
    tag: dados.tag,
  };
}

function mapearInsercao(e: DwgInsertEntity): Insercao {
  return {
    bloco: e.name,
    camada: e.layer,
    x: numero(e.insertionPoint?.x) ?? 0,
    y: numero(e.insertionPoint?.y) ?? 0,
    atributos: e.attribs.map((atributo) => ({ tag: atributo.tag, valor: atributo.text.text ?? "" })),
  };
}

function mapearPolilinha(e: DwgEntity): Polilinha[] {
  if (ehLwPolyline(e)) return [polilinha(e.layer, (e.flag & LWPOLYLINE_FECHADA) !== 0, e.vertices)];
  if (ehPolyline2d(e)) return [polilinha(e.layer, (e.flag & POLYLINE_FECHADA) !== 0, e.vertices)];
  return [];
}

function polilinha(camada: string, fechada: boolean, vertices: VerticeBruto[]): Polilinha {
  return {
    camada,
    fechada,
    vertices: vertices.map((v): [number, number] => [v.x, v.y]),
    arcos: vertices.filter((v) => (v.bulge ?? 0) !== 0).length,
  };
}

function mapearCota(e: DwgDimensionEntity): Cota {
  return {
    camada: e.layer,
    texto: e.text ? e.text : null,
    medida: numero(e.measurement),
    x: numero(e.textPoint?.x),
    y: numero(e.textPoint?.y),
  };
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function ehText(e: DwgEntity): e is DwgTextEntity {
  return e.type === "TEXT";
}

function ehMText(e: DwgEntity): e is DwgMTextEntity {
  return e.type === "MTEXT";
}

function ehAttdef(e: DwgEntity): e is DwgAttdefEntity {
  return e.type === "ATTDEF";
}

function ehInsercao(e: DwgEntity): e is DwgInsertEntity {
  return e.type === "INSERT";
}

function ehLwPolyline(e: DwgEntity): e is DwgLWPolylineEntity {
  return e.type === "LWPOLYLINE";
}

function ehPolyline2d(e: DwgEntity): e is DwgPolyline2dEntity {
  return e.type === "POLYLINE2D";
}

function ehCota(e: DwgEntity): e is DwgDimensionEntity {
  return e.type === "DIMENSION";
}
