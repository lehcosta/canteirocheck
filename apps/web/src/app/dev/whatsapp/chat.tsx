"use client";

import type { ItemCaixaSimulada } from "@canteirocheck/whatsapp";
import type { NomeFlow } from "@canteirocheck/whatsapp/flows";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  confirmarEntregas,
  enviarFoto,
  enviarTexto,
  limparConversa,
  tocarBotao,
  tocarRespostaTemplate,
} from "./acoes";
import { FlowSimulado } from "./flow-simulado";

interface Props {
  tel: string;
  itens: ItemCaixaSimulada[];
  flows: Record<
    string,
    {
      screens: {
        id: string;
        title?: string;
        layout: { children: (Record<string, unknown> & { type: string })[] };
      }[];
    }
  >;
  templates: Record<string, string>;
}

/** Conversa simulada: bolhas, botões tocáveis, Flow embutido e caixa de texto/foto. */
export function Chat({ tel, itens, flows, templates }: Props) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [flowAberto, setFlowAberto] = useState<{ nome: NomeFlow; token: string; wamid: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const fim = useRef<HTMLDivElement>(null);

  // A Meta confirma a entrega; o worker responde em segundo plano → atualiza a cada 2 s.
  useEffect(() => {
    const t = setInterval(() => {
      void confirmarEntregas(tel).then(() => router.refresh());
    }, 2000);
    return () => clearInterval(t);
  }, [tel, router]);

  // rola para a última mensagem quando chega uma nova
  const quantidade = itens.length;
  useEffect(() => {
    if (quantidade > 0) fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [quantidade]);

  const agir = (fn: () => Promise<unknown>) =>
    iniciar(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="grid gap-3">
      <div className="grid max-h-[65vh] gap-2 overflow-y-auto rounded-lg bg-[#efeae2] p-3">
        {itens.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Sem mensagens. Mande um “oi”.</p>
        ) : null}
        {itens.map((i) => {
          if (i.direcao === "entrada") {
            return (
              <div
                key={i.id}
                className="ml-auto max-w-[80%] rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm shadow-sm"
              >
                {i.entrada?.texto}
              </div>
            );
          }
          const m = i.mensagem;
          if (!m) return null;
          return (
            <div key={i.id} className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
              {m.tipo === "texto" ? <p className="whitespace-pre-line">{m.texto}</p> : null}
              {m.tipo === "botoes" ? (
                <>
                  <p className="whitespace-pre-line">{m.texto}</p>
                  <div className="mt-2 grid gap-1 border-t pt-2">
                    {m.botoes.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        disabled={pendente}
                        className="rounded py-1 text-center text-sky-700 hover:bg-sky-50"
                        onClick={() => agir(() => tocarBotao(tel, b.id, b.titulo, i.id))}
                      >
                        {b.titulo}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {m.tipo === "flow" ? (
                <>
                  {m.cabecalho ? <p className="font-semibold">{m.cabecalho}</p> : null}
                  <p className="whitespace-pre-line">{m.texto}</p>
                  {m.rodape ? <p className="text-xs text-muted-foreground">{m.rodape}</p> : null}
                  <button
                    type="button"
                    className="mt-2 w-full border-t pt-2 text-center text-sky-700"
                    onClick={() =>
                      setFlowAberto({ nome: m.flowNome as NomeFlow, token: m.flowToken, wamid: i.id })
                    }
                  >
                    ▤ {m.cta}
                  </button>
                </>
              ) : null}
              {m.tipo === "template" ? (
                <>
                  <p className="text-xs uppercase text-muted-foreground">template {m.nome}</p>
                  <p className="whitespace-pre-line">
                    {(templates[m.nome] ?? "").replace(
                      /\{\{(\d+)\}\}/g,
                      (_, n) => m.parametros[Number(n) - 1] ?? "",
                    )}
                  </p>
                  <div className="mt-2 grid gap-1 border-t pt-2">
                    {(m.respostasRapidas ?? []).map((payload) => (
                      <button
                        key={payload}
                        type="button"
                        disabled={pendente}
                        className="rounded py-1 text-center text-sky-700 hover:bg-sky-50"
                        onClick={() =>
                          agir(() =>
                            tocarRespostaTemplate(
                              tel,
                              payload,
                              payload.startsWith("anunciar") ? "Anunciar" : "Ver",
                              i.id,
                            ),
                          )
                        }
                      >
                        {payload.startsWith("anunciar") ? "Anunciar" : "Ver"}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="mt-1 text-right text-[10px] text-muted-foreground">
                {new Date(i.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      {flowAberto ? (
        <FlowSimulado
          key={flowAberto.token}
          tel={tel}
          nome={flowAberto.nome}
          token={flowAberto.token}
          wamid={flowAberto.wamid}
          telas={flows[flowAberto.nome]?.screens ?? []}
          aoFechar={() => {
            setFlowAberto(null);
            router.refresh();
          }}
        />
      ) : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = texto;
          setTexto("");
          agir(() => enviarTexto(tel, t));
        }}
      >
        <input
          className="flex-1 rounded-full border px-4 py-2 text-sm"
          placeholder="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button
          type="submit"
          disabled={pendente}
          className="rounded-full bg-green-600 px-4 text-sm text-white"
        >
          Enviar
        </button>
      </form>
      <div className="flex items-center justify-between text-xs">
        <label className="cursor-pointer underline">
          Mandar foto
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("foto", f);
              agir(() => enviarFoto(tel, fd));
            }}
          />
        </label>
        <button type="button" className="underline" onClick={() => agir(() => limparConversa(tel))}>
          Limpar conversa
        </button>
      </div>
    </div>
  );
}
