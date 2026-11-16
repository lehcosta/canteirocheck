import { cn } from "@/lib/utils";

/**
 * Logotipo e marca da Prumo (DS: https://claude.ai/artifact/CzNJEY7N18zLcxur1Ys5G9).
 * O "o" é uma régua de nível: contorno da cor do texto, líquido `liquido`, bolha branca no centro.
 * Em repouso a bolha fica no centro; só o `LogotipoVivo` (logotipo-vivo.tsx) a move, seguindo o mouse ou a inclinação do celular.
 * Desenhados em curvas (não dependem de fonte). Cor das letras = `currentColor`.
 */
export function Logotipo({
  className,
  titulo = "Prumo",
  refBolha,
}: {
  className?: string;
  titulo?: string;
  /** Grupo da bolha, para o LogotipoVivo deslocar (translate) sem re-renderizar. */
  refBolha?: React.Ref<SVGGElement>;
}) {
  return (
    <svg viewBox="0 0 181 56" role="img" aria-label={titulo} className={cn("h-7 w-auto", className)}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={7}
        d="M3.5 8V51.4M3.5 11.5H17.5A10.5 10.5 0 0 1 17.5 32.5H3.5M36.5 8V36M36.5 22A10.5 10.5 0 0 1 47 11.5H52M56 8V22A10.5 10.5 0 0 0 77 22M77 8V36M86 8V36M86 22A10.5 10.5 0 0 1 107 22V36M107 22A10.5 10.5 0 0 1 128 22V36"
      />
      <Regua
        x={136.5}
        y={11.5}
        largura={39}
        altura={21}
        traco={7}
        riscos={[147.24, 161.96]}
        bolha={[150.56, 17.74, 10.88, 7.41]}
        refBolha={refBolha}
      />
    </svg>
  );
}

/** Só a régua: favicon, selos, canto do PDF. Mínimo de 20px. */
export function MarcaRegua({ className, titulo = "Prumo" }: { className?: string; titulo?: string }) {
  return (
    <svg viewBox="0 14 64 36" role="img" aria-label={titulo} className={cn("h-5 w-auto", className)}>
      <Regua
        x={7}
        y={21}
        largura={50}
        altura={22}
        traco={8}
        riscos={[20.74, 40.06]}
        bolha={[24.86, 27.74, 14.28, 7.41]}
      />
    </svg>
  );
}

function Regua({
  x,
  y,
  largura,
  altura,
  traco,
  riscos,
  bolha,
  refBolha,
}: {
  x: number;
  y: number;
  largura: number;
  altura: number;
  traco: number;
  riscos: [number, number];
  bolha: [number, number, number, number];
  refBolha?: React.Ref<SVGGElement>;
}) {
  const r = altura / 2;
  const t = traco * 0.4;
  const yi = y + traco / 2;
  const hi = altura - traco;
  return (
    <>
      <rect x={x} y={y} width={largura} height={altura} rx={r} fill="var(--liquido)" />
      <rect
        x={x}
        y={y}
        width={largura}
        height={altura}
        rx={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={traco}
      />
      <g ref={refBolha}>
        <rect x={bolha[0]} y={bolha[1]} width={bolha[2]} height={bolha[3]} rx={bolha[3] / 2} fill="#ffffff" />
      </g>
      {riscos.map((rx) => (
        <rect key={rx} x={rx} y={yi} width={t} height={hi} fill="currentColor" />
      ))}
    </>
  );
}
