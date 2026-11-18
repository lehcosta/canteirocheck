"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { RotateCcw, X } from "lucide-react";
import { useState, useTransition } from "react";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { restaurarCronogramaAction } from "@/features/cronogramas/actions";
import { cn } from "@/lib/utils";

const ICONE = { "aria-hidden": true, strokeWidth: 2, strokeLinecap: "square" } as const;
const SUBLINHA = "block text-[13px] leading-[18px]";

export interface LinhaHistorico {
  id: string;
  numero: number | null;
  vigente: boolean;
  arquivoNome: string;
  statusLeitura: "pendente" | "processando" | "concluida" | "falhou";
  erroLeitura: string | null;
  totalTarefas: number | null;
  /** já formatados no fuso da obra */
  termino: string | null;
  enviadoPor: string;
  importadoEm: string;
}

/** Histórico de importações, com a volta de versão confirmada num diálogo. */
export function HistoricoCronograma({ obraId, linhas }: { obraId: string; linhas: LinhaHistorico[] }) {
  const [alvo, setAlvo] = useState<LinhaHistorico | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const vigente = linhas.find((l) => l.vigente);

  function restaurar(linha: LinhaHistorico) {
    setErro(null);
    iniciar(async () => {
      const r = await restaurarCronogramaAction(obraId, linha.id);
      if (r?.erro) return setErro(r.erro);
      setRecado(r?.ok ?? null);
      setAlvo(null);
    });
  }

  return (
    <section aria-labelledby="titulo-historico" className="space-y-3">
      <div className="space-y-1">
        <TituloSecao id="titulo-historico">Histórico de importações</TituloSecao>
        <p className="text-[15px] text-muted-foreground">
          Restaurar uma versão a torna vigente de novo. Nada é apagado: a versão atual continua no histórico.
        </p>
        {recado && (
          <p role="status" className="text-sm font-semibold text-nivel">
            {recado}
          </p>
        )}
      </div>

      <div className="rounded-md border bg-card">
        <Table aria-label="Importações do cronograma" className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-24 px-4">
                Versão
              </TableHead>
              <TableHead scope="col" className="px-4">
                Arquivo
              </TableHead>
              <TableHead scope="col" className="px-4">
                Tarefas
              </TableHead>
              <TableHead scope="col" className="px-4">
                Término previsto
              </TableHead>
              <TableHead scope="col" className="px-4">
                Importado
              </TableHead>
              <TableHead scope="col" className="px-4 text-right">
                <span className="sr-only">Situação</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => {
              const lida = l.statusLeitura === "concluida";
              return (
                <TableRow
                  key={l.id}
                  className={cn("h-16 hover:bg-transparent", !l.vigente && "text-muted-foreground")}
                >
                  <TableCell className={cn("px-4 py-0 font-mono font-medium", lida && "text-foreground")}>
                    {l.numero === null ? "—" : `v${l.numero}`}
                  </TableCell>
                  <TableCell className="py-0 max-w-[330px] px-4">
                    <span className="block truncate" title={l.arquivoNome}>
                      {l.arquivoNome}
                    </span>
                    {l.statusLeitura === "falhou" && (
                      <span className={cn(SUBLINHA, "text-destructive")}>
                        {l.erroLeitura ?? "Não consegui ler o arquivo."}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-0 px-4 font-mono font-medium">{l.totalTarefas ?? "—"}</TableCell>
                  <TableCell className="py-0 px-4 font-mono font-medium">{l.termino ?? "—"}</TableCell>
                  <TableCell className="py-0 px-4">
                    {l.enviadoPor}
                    <span className={cn(SUBLINHA, "text-muted-foreground")}>{l.importadoEm}</span>
                  </TableCell>
                  <TableCell className="py-0 px-4 text-right">
                    {l.vigente ? (
                      <Badge variant="outline">Vigente</Badge>
                    ) : l.statusLeitura === "falhou" ? (
                      <Badge variant="destructive">
                        <X {...ICONE} strokeWidth={3} />
                        Falhou
                      </Badge>
                    ) : !lida ? (
                      <Badge variant="secondary">Lendo…</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          setErro(null);
                          setAlvo(l);
                        }}
                      >
                        <RotateCcw {...ICONE} />
                        Restaurar v{l.numero}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog.Root open={alvo !== null} onOpenChange={(aberto) => !aberto && !pendente && setAlvo(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-ink/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[480px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-md border border-foreground bg-card p-6 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <div className="space-y-2">
              <AlertDialog.Title className="text-lg leading-6 font-semibold">
                Restaurar a v{alvo?.numero}?
              </AlertDialog.Title>
              <AlertDialog.Description
                render={<div />}
                className="space-y-2 text-[15px] text-muted-foreground"
              >
                <p>Ela volta a ser a versão vigente da obra.</p>
                {vigente && <p>A v{vigente.numero} continua no histórico e pode ser restaurada depois.</p>}
              </AlertDialog.Description>
            </div>
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="outline" className="h-11" />} disabled={pendente}>
                Cancelar
              </AlertDialog.Close>
              <Button className="h-11" disabled={pendente} onClick={() => alvo && restaurar(alvo)}>
                <RotateCcw {...ICONE} />
                {pendente ? "Restaurando…" : `Restaurar v${alvo?.numero}`}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
