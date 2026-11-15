import Link from "next/link";
import { BotaoSair } from "@/components/botao-sair";
import { PAPEL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const s = await exigirSessao();
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/obras" className="font-semibold">
            CanteiroCheck
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/obras" className="hover:text-foreground">
              Obras
            </Link>
            <Link href="/configuracoes/usuarios" className="hover:text-foreground">
              Usuários
            </Link>
            <Link href="/configuracoes/tolerancias" className="hover:text-foreground">
              Tolerâncias
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {s.nome} · {PAPEL[s.papel]}
            </span>
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
