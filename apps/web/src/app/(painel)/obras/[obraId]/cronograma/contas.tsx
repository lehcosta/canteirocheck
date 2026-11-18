import type { EstadoCheck } from "@canteirocheck/core";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ESTADO_CHECK } from "@/features/checks/textos";
import { cn } from "@/lib/utils";

type Nivel = "alto" | "medio" | "baixo";
const ICONE = { "aria-hidden": true, strokeWidth: 3, strokeLinecap: "square" } as const;
const TRACO = {
  fill: "none",
  strokeWidth: 1.6,
  strokeLinecap: "square",
  strokeLinejoin: "round",
  className: "stroke-card",
} as const;

/**
 * A conta de um check (16 px, anel da cor do fundo para pousar sobre a barra): cada estado tem uma
 * forma, não só uma cor (o alerta é losango com ✕; o respondido, círculo com ✓).
 */
export function Conta({ estado, className }: { estado: EstadoCheck; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)}>
      {estado === "alerta" ? (
        <path d="M8 0 16 8 8 16 0 8Z" className="fill-card" />
      ) : (
        <circle cx="8" cy="8" r="8" className="fill-card" />
      )}
      {estado === "ok" && (
        <>
          <circle cx="8" cy="8" r="6" className="fill-nivel" />
          <path d="M5.3 8.2 7.1 10 10.7 6.2" {...TRACO} />
        </>
      )}
      {estado === "alerta" && (
        <>
          <path d="M8 1.4 14.6 8 8 14.6 1.4 8Z" className="fill-divergencia" />
          <path d="M6.5 6.5 9.5 9.5" {...TRACO} />
          <path d="M9.5 6.5 6.5 9.5" {...TRACO} />
        </>
      )}
      {estado === "naobra" && <circle cx="8" cy="8" r="6" className="fill-foreground" />}
      {estado === "agendado" && (
        <circle cx="8" cy="8" r="5" strokeWidth="2" className="fill-card stroke-foreground" />
      )}
      {estado === "aprovar" && (
        <>
          <circle cx="8" cy="8" r="6" className="fill-primary" />
          <circle cx="8" cy="8" r="2" className="fill-primary-foreground" />
        </>
      )}
      {estado === "sugerido" && (
        <circle cx="8" cy="8" r="5" strokeWidth="2" className="fill-card stroke-concreto" />
      )}
    </svg>
  );
}

/** Selo do estado de um check: laranja só no que pede aprovação; verde e vermelho com ✓ e ✕. */
export function SeloDoCheck({ estado, className }: { estado: EstadoCheck; className?: string }) {
  if (estado === "ok")
    return (
      <Badge variant="nivel" className={className}>
        <Check {...ICONE} />
        {ESTADO_CHECK.ok}
      </Badge>
    );
  if (estado === "alerta")
    return (
      <Badge variant="destructive" className={className}>
        <X {...ICONE} />
        {ESTADO_CHECK.alerta}
      </Badge>
    );
  if (estado === "naobra")
    return <Badge className={cn("bg-foreground text-card", className)}>{ESTADO_CHECK.naobra}</Badge>;
  const variante = { agendado: "outline", aprovar: "default", sugerido: "secondary" } as const;
  return (
    <Badge variant={variante[estado]} className={className}>
      {ESTADO_CHECK[estado]}
    </Badge>
  );
}

const NIVEL: Record<Nivel, string> = { alto: "Alto", medio: "Médio", baixo: "Baixo" };
const VARIANTE_NIVEL = { alto: "destructive", medio: "atencao", baixo: "outline" } as const;

/**
 * Selo do nível de risco, com os nomes e as cores das pendências de projeto. `sobreFundo`: o selo
 * pousa no fundo da página (não num cartão), e o cinza dele sumiria ali.
 */
export function SeloRisco({
  nivel,
  curto = false,
  sobreFundo = false,
}: {
  nivel: Nivel;
  curto?: boolean;
  sobreFundo?: boolean;
}) {
  return (
    <Badge variant={VARIANTE_NIVEL[nivel]} className={cn(sobreFundo && nivel !== "baixo" && "bg-card")}>
      {curto ? NIVEL[nivel] : `Risco ${NIVEL[nivel].toLowerCase()}`}
    </Badge>
  );
}

/** "R1": etiqueta preta dos riscos (no cartão do risco e nas perguntas ligadas a ele). */
export function EtiquetaRisco({ codigo, pequena = false }: { codigo: string; pequena?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm bg-foreground font-mono text-xs leading-4 font-medium text-card",
        pequena ? "h-5 w-7" : "h-6 w-8",
      )}
    >
      {codigo}
    </span>
  );
}
