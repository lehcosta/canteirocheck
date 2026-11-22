"use client";

import { useRef } from "react";
import { useBolhaViva } from "./bolha-viva";
import { Logotipo } from "./marca";

/** Quanto a bolha anda para cada lado, em unidades do SVG: sem encostar nas pontas arredondadas da régua. */
const CURSO = 10;
/** Centro da régua no logotipo (x = 23 de 176: a régua é a marca à esquerda, antes de "EngCheck"). */
const CENTRO_DA_REGUA = 23 / 176;

/** Logotipo com a bolha da régua viva, como num nível de verdade (ver `useBolhaViva`). */
export function LogotipoVivo({ className, titulo }: { className?: string; titulo?: string }) {
  const bolha = useRef<SVGGElement>(null);
  useBolhaViva(bolha, { curso: CURSO, centro: CENTRO_DA_REGUA });
  return <Logotipo className={className} titulo={titulo} refBolha={bolha} />;
}
