"use client";

import { File as IconeArquivo, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TAMANHO_MAXIMO = 60 * 1024 * 1024;
const ICONE = { "aria-hidden": true, strokeWidth: 2, strokeLinecap: "square" } as const;

export interface ImportacaoEmCurso {
  id: string;
  numero: number | null;
  statusLeitura: "pendente" | "processando" | "concluida" | "falhou";
}

/**
 * Envio do arquivo do MS Project para a rota do servidor. A leitura roda em segundo plano:
 * enquanto alguma importação está na fila ou sendo lida, a tela se atualiza sozinha.
 */
export function ImportarCronograma({
  obraId,
  versoes,
  numeroVigente,
}: {
  obraId: string;
  versoes: ImportacaoEmCurso[];
  numeroVigente: number | null;
}) {
  const router = useRouter();
  const idCampo = useId();
  const campo = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<{ id: string; vigenteAntes: number | null } | null>(null);
  // estado próprio, não useTransition: o "Enviando…" acaba junto com a resposta, não com o refresh
  const [pendente, setPendente] = useState(false);

  const lendo = versoes.some((v) => v.statusLeitura === "pendente" || v.statusLeitura === "processando");
  useEffect(() => {
    if (!lendo) return;
    const relogio = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(relogio);
  }, [lendo, router]);

  // o recado acompanha a importação que esta pessoa acabou de enviar
  const minha = enviada ? versoes.find((v) => v.id === enviada.id) : undefined;
  const ok = !enviada
    ? null
    : minha?.statusLeitura === "concluida"
      ? `Cronograma importado. A v${minha.numero} é a vigente.`
      : minha?.statusLeitura === "falhou"
        ? null
        : enviada.vigenteAntes === null
          ? "Arquivo enviado. A leitura roda em segundo plano."
          : `Arquivo enviado. A leitura roda em segundo plano; a v${enviada.vigenteAntes} continua vigente até ela terminar.`;

  function enviar() {
    setErro(null);
    setEnviada(null);
    if (!arquivo) return setErro("Escolha o arquivo.");
    if (!/\.(mpp|xml)$/i.test(arquivo.name)) return setErro("Envie um arquivo MPP ou XML do MS Project.");
    if (arquivo.size > TAMANHO_MAXIMO) return setErro("Arquivo acima de 60 MB.");
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    setPendente(true);
    void (async () => {
      const r = await fetch(`/api/obras/${obraId}/cronograma`, { method: "POST", body: dados }).catch(
        () => null,
      );
      const corpo = (await r?.json().catch(() => ({}))) as { erro?: string; id?: string } | undefined;
      setPendente(false);
      if (!r?.ok || !corpo?.id) {
        // o arquivo continua escolhido: a pessoa só tenta de novo
        setErro(corpo?.erro ?? "Não foi possível enviar. Tente de novo.");
        return;
      }
      setEnviada({ id: corpo.id, vigenteAntes: numeroVigente });
      setArquivo(null);
      if (campo.current) campo.current.value = "";
      router.refresh();
    })();
  }

  return (
    <section aria-labelledby="titulo-importar" className="space-y-3 rounded-md border bg-card py-4 pr-4 pl-5">
      <form
        className="flex flex-wrap items-center gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="min-w-0 flex-1 basis-80 space-y-0.5">
          <h2 id="titulo-importar" className="text-[15px] leading-[22px] font-semibold">
            Importar cronograma
          </h2>
          <p className="text-sm text-muted-foreground">
            MPP ou XML do MS Project, até 60 MB. As versões anteriores ficam no histórico.
          </p>
        </div>
        <label
          htmlFor={idCampo}
          className={cn(
            "flex h-11 w-[300px] max-w-full cursor-pointer items-center gap-2 rounded-sm border border-input bg-card px-3 text-[15px] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
            erro && "border-destructive",
            pendente && "cursor-default border-line bg-muted",
          )}
        >
          <IconeArquivo
            {...ICONE}
            className={cn("size-4 shrink-0", (!arquivo || pendente) && "text-muted-foreground")}
          />
          <span className={cn("truncate", (!arquivo || pendente) && "text-muted-foreground")}>
            {arquivo?.name ?? "Nenhum arquivo escolhido"}
          </span>
          <input
            ref={campo}
            id={idCampo}
            name="arquivo"
            type="file"
            accept=".mpp,.xml"
            disabled={pendente}
            aria-label="Arquivo do MS Project (MPP ou XML, até 60 MB)"
            aria-invalid={erro ? true : undefined}
            className="sr-only"
            onChange={(e) => {
              setArquivo(e.currentTarget.files?.[0] ?? null);
              setErro(null);
            }}
          />
        </label>
        {pendente ? (
          <Button
            type="submit"
            variant="secondary"
            disabled
            className="h-11 border-line disabled:opacity-100"
          >
            <span className="text-muted-foreground">Enviando…</span>
          </Button>
        ) : (
          <Button type="submit" className="h-11">
            <Upload {...ICONE} />
            Importar
          </Button>
        )}
      </form>
      {erro && (
        <p role="alert" className="text-right text-sm text-destructive">
          {erro}
        </p>
      )}
      {ok && !erro && (
        <p role="status" className="text-right text-sm font-semibold text-nivel">
          {ok}
        </p>
      )}
    </section>
  );
}
