"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ABAS = [
  { caminho: "", rotulo: "Visão geral" },
  { caminho: "/linha-do-tempo", rotulo: "Linha do tempo" },
  { caminho: "/cronograma", rotulo: "Cronograma" },
  { caminho: "/projetos", rotulo: "Projetos" },
  { caminho: "/pontos", rotulo: "Pontos de controle" },
  { caminho: "/indicadores", rotulo: "Indicadores" },
  { caminho: "/relatorios", rotulo: "Relatórios" },
];

export function AbasObra({ obraId }: { obraId: string }) {
  const atual = usePathname();
  const base = `/obras/${obraId}`;
  return (
    <nav aria-label="Seções da obra" className="-mt-2 flex flex-wrap gap-1 border-b">
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
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 text-[15px]",
              ativa
                ? "border-prumo font-semibold text-foreground"
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
