"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ABAS = [
  { caminho: "", rotulo: "Visão geral" },
  { caminho: "/linha-do-tempo", rotulo: "Linha do tempo" },
  { caminho: "/projetos", rotulo: "Projetos" },
  { caminho: "/pontos", rotulo: "Pontos de controle" },
  { caminho: "/relatorios", rotulo: "Relatórios" },
];

export function AbasObra({ obraId }: { obraId: string }) {
  const atual = usePathname();
  const base = `/obras/${obraId}`;
  return (
    <nav className="flex gap-1 border-b text-sm">
      {ABAS.map((a) => {
        const href = `${base}${a.caminho}`;
        const ativa =
          a.caminho === ""
            ? atual === base
            : atual.startsWith(href) || (a.caminho === "/linha-do-tempo" && atual.includes("/execucoes/"));
        return (
          <Link
            key={a.caminho}
            href={href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2",
              ativa
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {a.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
