import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logotipo } from "@/components/marca";
import { obterSessao } from "@/lib/sessao";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar" };

const ERROS: Record<string, string> = {
  link: "Esse link expirou ou já foi usado. Peça um novo.",
};

/** Réguas do padrão gráfico: cápsula de `liquido` com a bolha no centro, fileiras desencontradas. */
const REGUAS: [number, number][] = [
  [344, 176],
  [408, 176],
  [472, 176],
  [376, 224],
  [440, 224],
  [504, 224],
  [344, 272],
  [408, 272],
  [472, 272],
  [376, 320],
  [440, 320],
  [504, 320],
];

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await obterSessao()) redirect("/obras");
  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-wrap bg-background">
      <section className="flex min-w-0 flex-[1_1_520px] flex-col justify-between gap-12 px-6 py-10 sm:px-16 sm:py-12">
        <Logotipo className="h-8 self-start text-foreground" />
        <div className="w-full max-w-[400px] space-y-6">
          <FormularioLogin erroInicial={erro ? (ERROS[erro] ?? ERROS.link) : undefined} />
        </div>
        <p className="max-w-[400px] text-[13px] leading-[18px] text-muted-foreground">
          Encarregado? Você não precisa entrar aqui: suas conferências acontecem no WhatsApp.
        </p>
      </section>

      <aside className="dark flex min-h-[560px] min-w-0 flex-[1_1_480px] flex-col justify-between gap-10 overflow-hidden bg-[#191816] px-6 pb-12 text-foreground sm:px-16 sm:pb-16">
        <svg viewBox="0 0 560 384" aria-hidden className="block h-auto w-full max-w-[560px] self-end">
          <rect x="64" y="-8" width="128" height="376" rx="4" fill="var(--liquido)" />
          <rect x="208" y="72" width="96" height="48" rx="4" fill="var(--prumo)" />
          <rect x="208" y="136" width="96" height="232" rx="4" fill="#8a867c" />
          {REGUAS.map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="48" height="16" rx="8" fill="var(--liquido)" />
              <rect x={x + 16} y={y + 4} width="16" height="8" rx="4" fill="#191816" />
            </g>
          ))}
        </svg>
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
