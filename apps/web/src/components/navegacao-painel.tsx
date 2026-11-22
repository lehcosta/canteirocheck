"use client";

import { Building2, CreditCard, Plus, Ruler, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A obra como a barra precisa dela: o atalho e o alerta. */
export interface ObraNav {
  id: string;
  nome: string;
  execucoesBloqueadas: number;
  pendenciasAbertas: number;
}

const CONFIG = [
  { href: "/configuracoes/usuarios", rotulo: "Usuários", Icone: Users },
  { href: "/configuracoes/tolerancias", rotulo: "Tolerâncias", Icone: Ruler },
  { href: "/configuracoes/assinatura", rotulo: "Assinatura", Icone: CreditCard },
];
// no celular a barra vira uma faixa no topo com os quatro destinos, como hoje
const CHIPS = [{ href: "/obras", rotulo: "Obras", Icone: Building2 }, ...CONFIG];

/** Ponto verde (em dia), anel (pendência sem bloqueio) ou ✕ (execução bloqueada). */
function Marcador({ obra }: { obra: ObraNav }) {
  const bloqueada = obra.execucoesBloqueadas > 0;
  const atencao = !bloqueada && obra.pendenciasAbertas > 0;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {bloqueada ? (
        <X aria-hidden className="size-4 text-divergencia" strokeWidth={2.5} />
      ) : atencao ? (
        <span aria-hidden className="size-2 rounded-full border-2 border-muted-foreground" />
      ) : (
        <span aria-hidden className="size-2 rounded-full bg-liquido" />
      )}
    </span>
  );
}

export function NavegacaoPainel({
  ativas,
  total,
  papel,
}: {
  ativas: ObraNav[];
  total: number;
  papel: "admin" | "engenheiro" | "encarregado";
}) {
  const atual = usePathname();
  const seg = atual.startsWith("/obras/") ? atual.split("/")[2] : undefined;
  const algumaLinha = ativas.some((o) => o.id === seg);
  // "Todas as obras" marca em /obras e quando se está numa obra fora da lista de ativas (pausada, nova)
  const todasAtiva = atual === "/obras" || (atual.startsWith("/obras/") && !algumaLinha);
  const ehAdmin = papel === "admin";

  return (
    <>
      {/* Celular: faixa no topo com os quatro links, sem a lista de obras */}
      <ul className="flex flex-wrap gap-1 md:hidden">
        {CHIPS.map(({ href, rotulo, Icone }) => {
          const ativo = atual === href || atual.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm",
                  ativo
                    ? "border-transparent bg-muted font-semibold text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                <Icone
                  aria-hidden
                  className={cn("size-[18px]", ativo && "text-prumo-text")}
                  strokeWidth={2}
                />
                {rotulo}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Desktop: a barra com as obras ativas e a configuração no pé */}
      <div className="hidden min-h-0 flex-1 flex-col gap-5 md:flex">
        <Link
          href="/obras"
          aria-current={todasAtiva ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-[15px]",
            todasAtiva
              ? "bg-muted font-semibold text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Building2 aria-hidden className={cn("size-5", todasAtiva && "text-prumo-text")} strokeWidth={2} />
          Todas as obras
        </Link>

        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex shrink-0 items-center justify-between pr-1 pl-3">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Obras ativas · {ativas.length}
            </span>
            {ehAdmin && (
              <Link
                href="/obras/nova"
                aria-label="Nova obra"
                className="flex size-7 items-center justify-center rounded-md text-foreground hover:bg-muted"
              >
                <Plus aria-hidden className="size-[18px]" strokeWidth={2.25} strokeLinecap="square" />
              </Link>
            )}
          </div>

          {ativas.length === 0 ? (
            <div className="flex flex-col gap-2 px-3 pt-1">
              <p className="text-sm text-muted-foreground">
                {total === 0 ? "Nenhuma obra ainda." : "Nenhuma obra ativa."}
              </p>
              {total === 0 && ehAdmin && (
                <Link
                  href="/obras/nova"
                  className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-prumo px-3 text-sm font-semibold text-on-prumo hover:bg-prumo/90"
                >
                  <Plus aria-hidden className="size-[18px]" strokeWidth={2.25} strokeLinecap="square" />
                  Cadastrar a primeira obra
                </Link>
              )}
            </div>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {ativas.map((o) => {
                const ativo = o.id === seg;
                const n = o.execucoesBloqueadas;
                return (
                  <li key={o.id}>
                    <Link
                      href={`/obras/${o.id}`}
                      title={o.nome}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 items-center gap-2.5 rounded-md px-3 text-sm",
                        ativo
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Marcador obra={o} />
                      <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                      {n > 0 && <Badge className="min-w-5 px-1 tracking-normal">{n > 9 ? "9+" : n}</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ul className="flex shrink-0 flex-col gap-1 border-t pt-2">
          {CONFIG.map(({ href, rotulo, Icone }) => {
            const ativo = atual === href || atual.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-3 rounded-md px-3 text-sm",
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
      </div>
    </>
  );
}
