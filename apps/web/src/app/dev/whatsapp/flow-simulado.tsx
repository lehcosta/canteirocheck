"use client";

import type { NomeFlow } from "@canteirocheck/whatsapp/flows";
import { useEffect, useState, useTransition } from "react";
import { chamarFlow, concluirFlow, subirFotoDoFlow } from "./acoes";

/**
 * Renderiza o Flow JSON (só os componentes que os nossos Flows usam) como o app do WhatsApp:
 * abre com INIT, manda `data_exchange` no Footer e, no SUCCESS, posta o nfm_reply no webhook.
 */

type Componente = Record<string, unknown> & { type: string; name?: string };
type Tela = { id: string; title?: string; layout: { children: Componente[] } };
type Opcao = { id: string; title: string };
type Valor = string | string[] | Record<string, unknown>[];

interface Props {
  tel: string;
  nome: NomeFlow;
  token: string;
  wamid: string;
  telas: Tela[];
  aoFechar: () => void;
}

function resolver(expr: unknown, data: Record<string, unknown>, form: Record<string, Valor>): unknown {
  if (typeof expr !== "string") return expr;
  const m = /^\$\{(data|form)\.([A-Za-z0-9_]+)\}$/.exec(expr);
  if (!m) return expr;
  return m[1] === "data" ? data[m[2] ?? ""] : form[m[2] ?? ""];
}

function montarPayload(
  p: Record<string, unknown>,
  data: Record<string, unknown>,
  form: Record<string, Valor>,
) {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, resolver(v, data, form) ?? ""]));
}

export function FlowSimulado({ tel, nome, token, wamid, telas, aoFechar }: Props) {
  const [tela, setTela] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<Record<string, Valor>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const aplicar = (r: Awaited<ReturnType<typeof chamarFlow>>) => {
    if (r.status !== 200 || !r.corpo) {
      setErro(`Endpoint respondeu ${r.status}${r.erroBruto ? `: ${r.erroBruto}` : ""}`);
      return;
    }
    if (r.corpo.screen === "SUCCESS") {
      const params =
        (r.corpo.data?.extension_message_response as { params?: Record<string, unknown> })?.params ?? {};
      void concluirFlow(tel, nome, params, wamid).then(aoFechar);
      return;
    }
    const { error_message, ...resto } = r.corpo.data ?? {};
    setErro(typeof error_message === "string" ? error_message : null);
    if (r.corpo.screen !== tela) {
      const nova = telas.find((t) => t.id === r.corpo?.screen);
      const iniciais: Record<string, Valor> = {};
      for (const c of nova?.layout.children ?? []) {
        if (c.name && typeof c["init-value"] === "string") iniciais[c.name] = c["init-value"];
      }
      setForm(iniciais);
    }
    setTela(r.corpo.screen ?? null);
    setData(resto);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: o Flow abre (INIT) uma vez por token
  useEffect(() => {
    iniciar(async () => aplicar(await chamarFlow(token, "INIT")));
  }, [token]);

  const atual = telas.find((t) => t.id === tela);
  const visivel = (c: Componente) => c.visible === undefined || resolver(c.visible, data, form) === true;

  function campo(c: Componente) {
    const nomeCampo = c.name ?? "";
    const rotulo = resolver(c.label, data, form) as string;
    const ajuda = resolver(c["helper-text"], data, form) as string | undefined;
    const opcoes = (resolver(c["data-source"], data, form) as Opcao[] | undefined) ?? [];
    const valor = form[nomeCampo];
    const definir = (v: Valor) => setForm((f) => ({ ...f, [nomeCampo]: v }));
    switch (c.type) {
      case "TextHeading":
        return <h3 className="text-base font-semibold">{String(resolver(c.text, data, form) ?? "")}</h3>;
      case "TextSubheading":
        return (
          <p className="text-sm font-medium text-muted-foreground">
            {String(resolver(c.text, data, form) ?? "")}
          </p>
        );
      case "TextCaption":
        return <p className="text-xs text-muted-foreground">{String(resolver(c.text, data, form) ?? "")}</p>;
      case "TextBody":
        return (
          <p className={`whitespace-pre-line text-sm ${c["font-weight"] === "bold" ? "font-semibold" : ""}`}>
            {String(resolver(c.text, data, form) ?? "")}
          </p>
        );
      case "TextInput":
      case "TextArea":
        return (
          <div className="grid gap-1 text-sm">
            <label htmlFor={`campo-${nomeCampo}`}>{rotulo}</label>
            {c.type === "TextArea" ? (
              <textarea
                id={`campo-${nomeCampo}`}
                className="rounded border px-2 py-1"
                value={(valor as string) ?? ""}
                onChange={(e) => definir(e.target.value)}
              />
            ) : (
              <input
                id={`campo-${nomeCampo}`}
                className="rounded border px-2 py-1"
                inputMode={c["input-type"] === "number" ? "decimal" : "text"}
                value={(valor as string) ?? ""}
                onChange={(e) => definir(e.target.value)}
              />
            )}
            {ajuda ? <span className="text-xs text-muted-foreground">{ajuda}</span> : null}
          </div>
        );
      case "RadioButtonsGroup":
      case "Dropdown":
        return (
          <fieldset className="grid gap-1 text-sm">
            <legend className="mb-1">{rotulo}</legend>
            {opcoes.map((o) => (
              <label key={o.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={nomeCampo}
                  checked={(valor ?? (resolver(c["init-value"], data, form) as string)) === o.id}
                  onChange={() => definir(o.id)}
                />
                {o.title}
              </label>
            ))}
          </fieldset>
        );
      case "CheckboxGroup": {
        const marcados = Array.isArray(valor) ? (valor as string[]) : [];
        return (
          <fieldset className="grid gap-1 text-sm">
            <legend className="mb-1">{rotulo}</legend>
            {opcoes.map((o) => (
              <label key={o.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={marcados.includes(o.id)}
                  onChange={(e) =>
                    definir(e.target.checked ? [...marcados, o.id] : marcados.filter((x) => x !== o.id))
                  }
                />
                {o.title}
              </label>
            ))}
          </fieldset>
        );
      }
      case "PhotoPicker":
        return (
          <label className="grid gap-1 text-sm">
            <span>
              {rotulo}{" "}
              <span className="text-xs text-muted-foreground">
                {String(resolver(c.description, data, form) ?? "")}
              </span>
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return definir([]);
                const fd = new FormData();
                fd.set("foto", f);
                iniciar(async () => {
                  const foto = await subirFotoDoFlow(fd);
                  definir(foto ? [foto] : []);
                });
              }}
            />
            {Array.isArray(valor) && valor.length ? (
              <span className="text-xs text-green-700">1 foto anexada (cifrada)</span>
            ) : null}
          </label>
        );
      default:
        return null;
    }
  }

  const footer = atual?.layout.children.find((c) => c.type === "Footer");
  return (
    <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground">Flow · {atual?.title ?? "carregando"}</span>
        <button type="button" className="text-xs underline" onClick={aoFechar}>
          fechar
        </button>
      </div>
      {erro ? <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{erro}</p> : null}
      {atual?.layout.children
        .filter((c) => c.type !== "Footer" && visivel(c))
        .map((c, i) => (
          <div key={`${atual.id}-${c.name ?? i}`}>{campo(c)}</div>
        ))}
      {footer ? (
        <button
          type="button"
          disabled={pendente}
          className="rounded bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => {
            const acao = footer["on-click-action"] as { name: string; payload?: Record<string, unknown> };
            iniciar(async () =>
              aplicar(
                await chamarFlow(
                  token,
                  "data_exchange",
                  atual?.id,
                  montarPayload(acao.payload ?? {}, data, form),
                ),
              ),
            );
          }}
        >
          {pendente ? "…" : String(footer.label)}
        </button>
      ) : null}
    </div>
  );
}
