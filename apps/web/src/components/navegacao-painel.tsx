"use client";

import { Building2, Ruler, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITENS = [
  { href: "/obras", rotulo: "Obras", Icone: Building2 },
  { href: "/configuracoes/usuarios", rotulo: "Usuários", Icone: Users },
  { href: "/configuracoes/tolerancias", rotulo: "Tolerâncias", Icone: Ruler },
];

export function NavegacaoPainel() {
  const atual = usePathname();
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = atual === href || atual.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px]",
                ativo
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icone aria-hidden className={cn("size-5", ativo && "text-prumo-text")} strokeWidth={2} />
              {rotulo}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
