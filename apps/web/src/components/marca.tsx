import { cn } from "@/lib/utils";

/**
 * Logotipo e marca da EngCheck (estudo C do paper-explorer `logo-engcheck`, aprovado 2026-11-19).
 * A régua de nível vira a marca à esquerda — contorno da cor do texto, líquido `liquido`, bolha branca no centro —
 * e "EngCheck" vem ao lado em Archivo 800 (a mesma família dos títulos, via `--font-archivo`).
 * Em repouso a bolha fica no centro; só o `LogotipoVivo` (logotipo-vivo.tsx) a move, seguindo o mouse ou a inclinação do celular.
 * Cor das letras e da régua = `currentColor`. A palavra depende da fonte Archivo (é o partido tipográfico do estudo C).
 */
export function Logotipo({
  className,
  titulo = "EngCheck",
  refBolha,
}: {
  className?: string;
  titulo?: string;
  /** Grupo da bolha, para o LogotipoVivo deslocar (translate) sem re-renderizar. */
  refBolha?: React.Ref<SVGGElement>;
}) {
  return (
    <svg viewBox="0 9 178 29" role="img" aria-label={titulo} className={cn("h-7 w-auto", className)}>
      <Regua
        x={3.5}
        y={11.5}
        largura={39}
        altura={21}
        traco={7}
        riscos={[14.24, 28.96]}
        bolha={[17.56, 17.74, 10.88, 7.41]}
        refBolha={refBolha}
      />
      <text
        x={49.5}
        y={30.7}
        fill="currentColor"
        fontSize={25.3}
        fontWeight={800}
        letterSpacing={-0.76}
        style={{ fontFamily: "var(--font-archivo), system-ui, sans-serif" }}
      >
        EngCheck
      </text>
    </svg>
  );
}

/** Só a régua: favicon, selos, canto do PDF. Mínimo de 20px. */
export function MarcaRegua({ className, titulo = "EngCheck" }: { className?: string; titulo?: string }) {
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
