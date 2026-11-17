"use client";

import { useRef } from "react";
import { useBolhaViva } from "./bolha-viva";
import { Logotipo } from "./marca";

/** Quanto a bolha anda para cada lado, em unidades do SVG: sem encostar nas pontas arredondadas da régua. */
const CURSO = 8;
/** Centro da régua no logotipo (x = 156 de 181). */
const CENTRO_DA_REGUA = 156 / 181;

/** Logotipo com a bolha da régua viva, como num nível de verdade (ver `useBolhaViva`). */
export function LogotipoVivo({ className, titulo }: { className?: string; titulo?: string }) {
  const bolha = useRef<SVGGElement>(null);
  useBolhaViva(bolha, { curso: CURSO, centro: CENTRO_DA_REGUA });
  return <Logotipo className={className} titulo={titulo} refBolha={bolha} />;
}
