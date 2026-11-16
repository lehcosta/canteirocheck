"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Campo, CampoSelect } from "@/components/campos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISCIPLINAS } from "./disciplinas";

/** Upload de DWG/PDF para a rota do servidor (confere papel, tamanho e conteúdo). */
export function EnvioProjeto({ obraId }: { obraId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const dados = new FormData(form);
        setErro(null);
        setOk(null);
        iniciar(async () => {
          const r = await fetch(`/api/obras/${obraId}/projetos`, { method: "POST", body: dados });
          const corpo = (await r.json().catch(() => ({}))) as { erro?: string; tipo?: string };
          if (!r.ok) {
            setErro(corpo.erro ?? "Não consegui enviar o arquivo. Tente de novo.");
            return;
          }
          form.reset();
          setOk(
            corpo.tipo === "dwg"
              ? "Enviado. A leitura do projeto roda em segundo plano."
              : "PDF anexado como referência.",
          );
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pendente} className="contents">
        <CampoSelect
          rotulo="Disciplina"
          nome="disciplina"
          required
          opcoes={DISCIPLINAS.map((d) => ({ ...d }))}
        />
        <Campo
          rotulo="Título"
          nome="titulo"
          required
          placeholder="Planta de layout"
          className="sm:col-span-3"
        />
        <Campo rotulo="Código" nome="codigo" required placeholder="ARQ-01" className="[&_input]:font-mono" />
        <Campo rotulo="Revisão" nome="revisao" required placeholder="R00" className="[&_input]:font-mono" />
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="arquivo">Arquivo (DWG ou PDF, até 60 MB)</Label>
          <Input
            id="arquivo"
            name="arquivo"
            type="file"
            accept=".dwg,.pdf"
            required
            className="cursor-pointer py-0 pl-0 text-[15px] leading-[42px] file:mr-3 file:h-full file:border-r file:border-solid file:border-line file:bg-muted file:px-4 file:text-[15px]"
          />
        </div>
        <div className="sm:col-span-4">
          <Button type="submit" size="lg">
            {pendente ? "Enviando…" : "Enviar projeto"}
          </Button>
        </div>
      </fieldset>
      {erro && (
        <p role="alert" className="text-sm text-destructive sm:col-span-4">
          {erro}
        </p>
      )}
      {ok && (
        <p role="status" className="text-sm font-semibold text-nivel sm:col-span-4">
          {ok}
        </p>
      )}
    </form>
  );
}
