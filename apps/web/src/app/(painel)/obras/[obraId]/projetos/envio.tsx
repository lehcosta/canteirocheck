"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Campo, CampoSelect } from "@/components/campos";
import { Button } from "@/components/ui/button";

const DISCIPLINAS = [
  { valor: "arquitetura", rotulo: "Arquitetura" },
  { valor: "estrutura", rotulo: "Estrutura" },
  { valor: "instalacoes", rotulo: "Instalações" },
  { valor: "interiores", rotulo: "Interiores" },
];

/** Upload de DWG/PDF para a rota do servidor (confere papel, tamanho e conteúdo). */
export function EnvioProjeto({ obraId }: { obraId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
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
            setErro(corpo.erro ?? "Falha no envio.");
            return;
          }
          form.reset();
          setOk(
            corpo.tipo === "dwg"
              ? "Enviado. A extração roda em segundo plano."
              : "PDF anexado como referência.",
          );
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pendente} className="contents">
        <CampoSelect rotulo="Disciplina" nome="disciplina" required opcoes={DISCIPLINAS} />
        <Campo
          rotulo="Título"
          nome="titulo"
          required
          placeholder="Planta de layout"
          className="sm:col-span-3"
        />
        <Campo rotulo="Código" nome="codigo" required placeholder="ARQ-01" />
        <Campo rotulo="Revisão" nome="revisao" required placeholder="R00" />
        <div className="grid gap-1.5 sm:col-span-2">
          <label htmlFor="arquivo" className="text-sm font-medium">
            Arquivo (DWG ou PDF, até 60 MB)
          </label>
          <input id="arquivo" name="arquivo" type="file" accept=".dwg,.pdf" required className="text-sm" />
        </div>
        <div className="sm:col-span-4">
          <Button type="submit" size="sm">
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
        <p role="status" className="text-sm text-emerald-700 sm:col-span-4">
          {ok}
        </p>
      )}
    </form>
  );
}
