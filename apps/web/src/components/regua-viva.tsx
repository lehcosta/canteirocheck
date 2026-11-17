"use client";

import { useRef } from "react";
import { useBolhaViva } from "@/components/bolha-viva";

/**
 * Bolha pode andar 72 para cada lado: 25% do líquido (288), a mesma proporção do logotipo (8 de 32).
 * Nas pontas ela fica a 30 da borda interna, sem encostar no arredondado.
 */
const CURSO = 72;

/**
 * A régua de nível grande, sobre fundo escuro (painel do login, seção Demonstração da landing), com a bolha viva
 * como a do logotipo (`useBolhaViva`).
 * Em repouso, a bolha fica no centro, entre os riscos: obra no prumo. Em tamanho grande os riscos são finos e
 * curtos e a bolha tem a cor do fundo; riscos de ponta a ponta, como os da MarcaRegua, partiriam o líquido em três.
 */
export function ReguaViva({ className }: { className?: string }) {
  const bolha = useRef<SVGGElement>(null);
  useBolhaViva(bolha, { curso: CURSO, centro: 0.5 });
  return (
    <svg viewBox="0 0 320 112" aria-hidden className={className}>
      <rect
        x="8"
        y="8"
        width="304"
        height="96"
        rx="48"
        fill="var(--liquido)"
        stroke="currentColor"
        strokeWidth="16"
      />
      <g ref={bolha}>
        <rect x="118" y="38" width="84" height="36" rx="18" fill="#191816" />
      </g>
      <rect x="104" y="30" width="6" height="52" fill="#191816" />
      <rect x="210" y="30" width="6" height="52" fill="#191816" />
    </svg>
  );
}
