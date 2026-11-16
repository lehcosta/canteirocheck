import { z } from "zod";
import type { ResultadoExtracao } from "./contrato";

/** Validação da resposta do dwg-extractor: resposta fora do contrato vira erro, não dado errado. */
const numero = z.number().nullable();
export const esquemaResultado = z.object({
  versao: z.object({ extrator: z.string(), libredwgWeb: z.string() }),
  dwg: z.object({ versao: z.string().nullable(), unidades: z.string().nullable() }),
  camadas: z.array(
    z.object({ nome: z.string(), desligada: z.boolean(), congelada: z.boolean(), entidades: z.number() }),
  ),
  textos: z.array(
    z.object({
      tipo: z.enum(["TEXT", "MTEXT", "ATTRIB", "ATTDEF"]),
      conteudo: z.string(),
      camada: z.string(),
      x: numero,
      y: numero,
      altura: numero,
      bloco: z.string().nullable(),
      tag: z.string().nullable(),
    }),
  ),
  insercoes: z.array(
    z.object({
      bloco: z.string(),
      camada: z.string(),
      x: z.number(),
      y: z.number(),
      atributos: z.array(z.object({ tag: z.string(), valor: z.string() })),
    }),
  ),
  polilinhas: z.array(
    z.object({
      camada: z.string(),
      fechada: z.boolean(),
      vertices: z.array(z.tuple([z.number(), z.number()])),
      arcos: z.number(),
    }),
  ),
  cotas: z.array(
    z.object({ camada: z.string(), texto: z.string().nullable(), medida: numero, x: numero, y: numero }),
  ),
}) satisfies z.ZodType<ResultadoExtracao>;
