import Link from "next/link";
import { BotaoSair } from "@/components/botao-sair";
import { Logotipo } from "@/components/marca";
import { NavegacaoPainel } from "@/components/navegacao-painel";
import { PAPEL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

function iniciais(nome: string): string {
  const partes = nome
    .replace(/^Eng\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const s = await exigirSessao();
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <nav
        aria-label="Principal"
        className="flex flex-col gap-6 border-b bg-card px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:gap-8 md:border-r md:border-b-0 md:py-6"
      >
        <Link href="/obras" className="self-start px-3 text-foreground">
          <Logotipo className="h-7" />
        </Link>
        <NavegacaoPainel />
        <div className="flex items-center gap-3 border-t px-1 pt-4 md:mt-auto">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-foreground text-[13px] font-semibold text-background"
          >
            {iniciais(s.nome)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{s.nome}</p>
            <p className="text-[13px] text-muted-foreground">{PAPEL[s.papel]}</p>
          </div>
          <BotaoSair />
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-6xl space-y-8">{children}</div>
      </main>
    </div>
  );
}
