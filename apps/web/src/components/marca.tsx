import { cn } from "@/lib/utils";

/**
 * Logotipo e marca da EngCheck (estudo C do paper-explorer `logo-engcheck`, aprovado 2026-11-19).
 * A régua de nível vira a marca à esquerda — contorno da cor do texto, líquido `liquido`, bolha branca no centro —
 * e "EngCheck" vem ao lado em Archivo 800 (a mesma família dos títulos, via `--font-archivo`).
 * A régua é desenhada como linha de projeto (estudo B do `logo-regua`, aprovado 2026-11-19): contorno de 2 em 26 de altura
 * e riscos curtos, que não tocam o contorno.
 * Em repouso a bolha fica no centro; só o `LogotipoVivo` (logotipo-vivo.tsx) a move, seguindo o mouse ou a inclinação do celular.
 * "Check" vai no verde do nível, o conferido (estudo A do `logo-fonte`, aprovado 2026-11-21): `--nivel` é verde escuro no
 * tema claro e o verde do líquido no escuro. Sobre um fundo escuro fora do tema escuro, envolva o logotipo em `.dark`.
 * Cor de "Eng" e da régua = `currentColor`. A palavra depende da fonte Archivo (é o partido tipográfico do estudo C).
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
    <svg viewBox="0 7.5 176 29" role="img" aria-label={titulo} className={cn("h-7 w-auto", className)}>
      <Regua
        x={1}
        y={10}
        largura={44}
        altura={24}
        traco={2}
        risco={1.4}
        alturaRisco={11}
        riscos={[12.8, 31.8]}
        bolha={[16, 17.5, 14, 9]}
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
        Eng<tspan fill="var(--nivel)">Check</tspan>
      </text>
    </svg>
  );
}

/** Só a régua: favicon, selos, canto do PDF. Mínimo de 20px. */
export function MarcaRegua({ className, titulo = "EngCheck" }: { className?: string; titulo?: string }) {
  return (
    <svg viewBox="0 14 64 36" role="img" aria-label={titulo} className={cn("h-5 w-auto", className)}>
      <Regua
        x={4.25}
        y={18.25}
        largura={55.5}
        altura={27.5}
        traco={2.5}
        risco={1.8}
        alturaRisco={13.5}
        riscos={[19.2, 43]}
        bolha={[23.2, 26.5, 17.6, 11]}
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
  risco,
  alturaRisco,
  riscos,
  bolha,
  refBolha,
}: {
  x: number;
  y: number;
  largura: number;
  altura: number;
  traco: number;
  /** Largura de cada risco. */
  risco: number;
  /** Altura de cada risco, centrado na régua. Sem ela, o risco vai de borda a borda do líquido. */
  alturaRisco?: number;
  riscos: [number, number];
  bolha: [number, number, number, number];
  refBolha?: React.Ref<SVGGElement>;
}) {
  const r = altura / 2;
  const hi = alturaRisco ?? altura - traco;
  const yi = y + (altura - hi) / 2;
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
        <rect key={rx} x={rx} y={yi} width={risco} height={hi} fill="currentColor" />
      ))}
    </>
  );
}
