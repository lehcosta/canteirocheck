import { z } from "zod";
import type { ResultadoExtracao } from "../src/contrato.ts";

const numeroOuNulo = z.number().nullable();
const textoOuNulo = z.string().nullable();
const contagem = z.number().int().nonnegative();

/** Valida em runtime o formato da resposta 200 de POST /extrair (objetos estritos: sem campos extras). */
export const esquemaResultado = z.strictObject({
  versao: z.strictObject({ extrator: z.string().min(1), libredwgWeb: z.string().min(1) }),
  dwg: z.strictObject({ versao: textoOuNulo, unidades: textoOuNulo }),
  camadas: z.array(
    z.strictObject({ nome: z.string(), desligada: z.boolean(), congelada: z.boolean(), entidades: contagem }),
  ),
  textos: z.array(
    z.strictObject({
      tipo: z.enum(["TEXT", "MTEXT", "ATTRIB", "ATTDEF"]),
      conteudo: z.string(),
      camada: z.string(),
      x: numeroOuNulo,
      y: numeroOuNulo,
      altura: numeroOuNulo,
      bloco: textoOuNulo,
      tag: textoOuNulo,
    }),
  ),
  insercoes: z.array(
    z.strictObject({
      bloco: z.string(),
      camada: z.string(),
      x: z.number(),
      y: z.number(),
      atributos: z.array(z.strictObject({ tag: z.string(), valor: z.string() })),
    }),
  ),
  polilinhas: z.array(
    z.strictObject({
      camada: z.string(),
      fechada: z.boolean(),
      vertices: z.array(z.tuple([z.number(), z.number()])),
      arcos: contagem,
    }),
  ),
  cotas: z.array(
    z.strictObject({
      camada: z.string(),
      texto: textoOuNulo,
      medida: numeroOuNulo,
      x: numeroOuNulo,
      y: numeroOuNulo,
    }),
  ),
});

type Inferido = z.infer<typeof esquemaResultado>;

/** Falha a compilação (typecheck) se o esquema e o tipo do contrato divergirem. */
export const esquemaEmDiaComContrato: [Inferido, ResultadoExtracao] extends [ResultadoExtracao, Inferido]
  ? true
  : false = true;
