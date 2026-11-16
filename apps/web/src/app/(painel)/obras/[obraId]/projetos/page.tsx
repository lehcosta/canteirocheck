import { listarProjetos } from "@canteirocheck/servicos";
import { Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { rotuloDisciplina } from "./disciplinas";
import { EnvioProjeto } from "./envio";
import { SeloExtracao } from "./selo-extracao";

export const metadata: Metadata = { title: "Projetos" };

const FUSO = "America/Sao_Paulo";
const SUBLINHA = "block text-[13px] leading-[18px] text-muted-foreground";

export default async function Projetos({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await listarProjetos(s.contexto, obraId);
  return (
    <>
      <section aria-labelledby="titulo-projetos" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <TituloSecao id="titulo-projetos">Projetos</TituloSecao>
            <p className="max-w-3xl text-[15px] text-muted-foreground">
              O DWG é lido automaticamente: textos, camadas, ambientes, níveis, carimbo e notas. O PDF fica
              como referência. Uma revisão nova do mesmo código substitui a anterior.
            </p>
          </div>
          <a href="#enviar-projeto" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>
            <Upload aria-hidden strokeWidth={2} strokeLinecap="square" />
            Enviar projeto
          </a>
        </div>

        <div className="rounded-md border bg-card">
          {lista.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted-foreground">
              Nenhum projeto enviado. Envie o DWG para a leitura sugerir os pontos de controle.
            </p>
          ) : (
            <Table aria-label="Projetos da obra" className="min-w-[760px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="px-4">
                    Código · revisão
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Título
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Disciplina
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Leitura
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Enviado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow
                    key={p.id}
                    className={cn("hover:bg-transparent", p.substituido && "text-muted-foreground")}
                  >
                    <TableCell className="px-4 py-3.5">
                      <Link
                        href={`/obras/${obraId}/projetos/${p.id}`}
                        className="font-mono font-medium text-prumo-text underline-offset-4 hover:underline"
                      >
                        {p.codigo} · {p.revisao}
                      </Link>
                      <span className={SUBLINHA}>
                        {p.tipoArquivo.toUpperCase()}
                        {p.substituido && " · substituído"}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[220px] px-4 py-3.5 whitespace-normal">{p.titulo}</TableCell>
                    <TableCell className="px-4 py-3.5">{rotuloDisciplina(p.disciplina)}</TableCell>
                    <TableCell className="px-4 py-3.5">
                      <SeloExtracao status={p.statusExtracao} />
                    </TableCell>
                    <TableCell className="px-4 py-3.5">
                      {p.enviadoPor}
                      <span className={SUBLINHA}>
                        {p.criadoEm.toLocaleDateString("pt-BR", { timeZone: FUSO })}{" "}
                        {p.criadoEm.toLocaleTimeString("pt-BR", {
                          timeZone: FUSO,
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section
        id="enviar-projeto"
        aria-labelledby="titulo-enviar"
        className="scroll-mt-6 space-y-5 rounded-md border bg-card p-5 sm:p-6"
      >
        <div className="space-y-1">
          <TituloSecao id="titulo-enviar">Enviar projeto</TituloSecao>
          <p className="text-[15px] text-muted-foreground">
            DWG ou PDF, até 60 MB. A leitura do DWG roda em segundo plano.
          </p>
        </div>
        <EnvioProjeto obraId={obraId} />
      </section>
    </>
  );
}
