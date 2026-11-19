import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogotipoVivo } from "@/components/logotipo-vivo";
import { ReguaViva } from "@/components/regua-viva";
import { obterSessao } from "@/lib/sessao";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar" };

const ERROS: Record<string, string> = {
  link: "Esse link expirou ou já foi usado. Peça um novo.",
};

/**
 * Grelha de 48 px (a do hero da landing) presa à régua: a origem é a borda esquerda e o centro dela, então uma
 * linha vertical passa na borda da régua e a linha de nível passa pelo meio, em qualquer largura e altura do
 * painel. O alcance (múltiplo de 48) cobre o painel mais largo e mais alto; o excedente é cortado pelo painel.
 * Fica atrás da régua e do texto pelo `-z-10` dentro do `isolate` do painel. SVG de linhas soltas, não
 * gradiente: o espelho no Paper não desenha gradiente.
 */
const ALCANCE = 1536;
const LINHAS = Array.from({ length: (2 * ALCANCE) / 48 + 1 }, (_, i) => i * 48);

function GrelhaDaRegua() {
  return (
    <svg
      aria-hidden
      width={2 * ALCANCE}
      height={2 * ALCANCE}
      fill="none"
      className="pointer-events-none absolute -z-10 max-w-none"
      style={{ left: -ALCANCE, top: `calc(50% - ${ALCANCE}px)` }}
    >
      <g stroke="var(--line)" strokeWidth={1}>
        {LINHAS.map((p) => (
          <line key={`v${p}`} x1={p} y1={0} x2={p} y2={2 * ALCANCE} />
        ))}
        {LINHAS.filter((p) => p !== ALCANCE).map((p) => (
          <line key={`h${p}`} x1={0} y1={p} x2={2 * ALCANCE} y2={p} />
        ))}
      </g>
      {/* a linha de nível no verde-escuro do tema claro (o --nivel do escuro é o próprio líquido e brilharia
          demais atrás da régua) */}
      <line
        className="claro"
        x1={0}
        y1={ALCANCE}
        x2={2 * ALCANCE}
        y2={ALCANCE}
        stroke="var(--nivel)"
        strokeWidth={2}
      />
    </svg>
  );
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await obterSessao()) redirect("/obras");
  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-wrap bg-background">
      <section className="flex min-w-0 flex-[1_1_520px] flex-col justify-between gap-12 px-6 py-10 sm:px-16 sm:py-12">
        <Link
          href="/"
          aria-label="EngCheck, início"
          className="self-start text-foreground transition-opacity duration-150 hover:opacity-75"
        >
          <LogotipoVivo className="h-8" />
        </Link>
        <div className="w-full max-w-[400px] space-y-6">
          <FormularioLogin erroInicial={erro ? (ERROS[erro] ?? ERROS.link) : undefined} />
        </div>
        <p className="max-w-[400px] text-[13px] leading-[18px] text-muted-foreground">
          Encarregado? Você não precisa entrar aqui: suas conferências acontecem no WhatsApp.
        </p>
      </section>

      <aside className="dark isolate flex min-h-[560px] min-w-0 flex-[1_1_480px] flex-col justify-end gap-14 overflow-hidden bg-[#191816] px-6 py-12 text-foreground sm:px-16 sm:py-16">
        <div className="relative w-full max-w-[320px]">
          <GrelhaDaRegua />
          <ReguaViva className="block h-auto w-full" />
        </div>
        <div className="max-w-[460px] space-y-4">
          <p className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Painel da construtora
          </p>
          <h2 className="font-heading text-5xl leading-none font-extrabold tracking-[-0.02em] sm:text-[56px]">
            Obra no prumo.
          </h2>
          <p className="text-lg leading-7 text-muted-foreground">
            Cada etapa conferida antes de seguir. O encarregado mede pelo WhatsApp; você libera aqui.
          </p>
        </div>
      </aside>
    </main>
  );
}
