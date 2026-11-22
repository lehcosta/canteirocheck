"use client";

import type { EstadoCheck, Momento, TipoResposta } from "@canteirocheck/core";
import type {
  CheckDaFase,
  EnvioDoCheck,
  FaseDoCronograma,
  PerguntaDoCheck,
  RespostaDoCheck,
} from "@canteirocheck/servicos";
import { Camera, Check, ChevronDown, ChevronUp, Pencil, RotateCw, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { aprovarCheckAction, desfazerAprovacaoAction } from "@/features/checks/actions";
import {
  ddmm,
  decorrido,
  diaCurto,
  diaDe,
  ENQUANTO_DURAR,
  ESTADO_CHECK,
  horaDe,
  MOMENTO,
  plural,
  quandoSai,
  regra,
  respostaLegivel,
  tipoDaResposta,
} from "@/features/checks/textos";
import { cn } from "@/lib/utils";
import { Conta, EtiquetaRisco, SeloDoCheck } from "../contas";
import { EditorDoCheck } from "./editor";

const ICONE = { "aria-hidden": true, strokeWidth: 2, strokeLinecap: "square" } as const;
const ROTULO = "text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const LINHA_CABECALHO = "text-[13px] leading-[18px]";
/** Travado sem transparência, como os botões sem o que fazer no Gantt. */
const TRAVADO = "disabled:border-line disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";
const SEM_ENVIO = "Depende do envio pelo WhatsApp, que ainda não existe";

export interface PropsDosChecks {
  fase: FaseDoCronograma;
  obraId: string;
  /** O momento aberto no editor (`?editar=antes`). */
  editando: Momento | null;
  hoje: string;
  /** O relógio da tela, em ISO. */
  agora: string;
  /** Os parâmetros do endereço (`editar`, `prova`, `agora`), que os links da página levam adiante. */
  busca: Record<string, string>;
}

const enviados = (k: CheckDaFase) => k.envios.filter((e) => e.enviadoEm !== null);
const fora = (e: EnvioDoCheck) => e.foraDoEsperado ?? 0;
/** O Durante ainda tem saída pela frente (depois do último envio e de hoje): dá para editar as próximas semanas. */
const temSaidaFutura = (k: CheckDaFase, hoje: string) => {
  const ultimo = enviados(k)[0]?.previstoPara ?? "";
  return k.momento === "durante" && k.datas.some((d) => d > ultimo && d >= hoje);
};
export const editavel = (k: CheckDaFase, hoje: string) =>
  ["sugerido", "aprovar", "agendado"].includes(k.estado) || temSaidaFutura(k, hoje);

/** O recado de quem aprovou: quando sai e para quem, ou que a data já passou. */
function recadoDaAprovacao(k: CheckDaFase, saiEm: string | null, hoje: string): string {
  const momento = `${MOMENTO[k.momento]} aprovado.`;
  if (!saiEm) return `${momento} Sai na data da regra.`;
  if (saiEm < hoje) return `${momento} A data de saída, ${diaCurto(saiEm)}, já passou.`;
  return `${momento} Sai ${diaCurto(saiEm)} às ${k.hora}${k.responsavel ? ` para ${k.responsavel.nome}` : ""}.`;
}

/** Os três checks da fase (Antes, Durante, Depois), lado a lado, com o recado da última ação. */
export function ChecksDaFase({ fase, obraId, editando, hoje, agora, busca }: PropsDosChecks) {
  const [recado, setRecado] = useState<string | null>(null);
  const [recadoAoFechar, setRecadoAoFechar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [emCurso, setEmCurso] = useState<{ id: string; acao: "aprovar" | "desfazer" } | null>(null);
  // o pendente cobre a ação e a revalidação que vem com ela: o botão só destrava com a tela nova
  const [pendente, iniciar] = useTransition();
  const [devolverFoco, setDevolverFoco] = useState<Momento | null>(null);
  // o recado e o erro valem até a próxima ação: abrir ou fechar o editor os tira da tela (o recado
  // de quem salvou aparece quando o editor fecha), e o foco volta para o Editar daquele cartão
  const [editandoAntes, setEditandoAntes] = useState(editando);
  if (editandoAntes !== editando) {
    if (editandoAntes && !editando) setDevolverFoco(editandoAntes);
    setEditandoAntes(editando);
    setRecado(recadoAoFechar);
    setRecadoAoFechar(null);
    setErro(null);
  }

  const endereco = (troca: Record<string, string | null>) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(troca)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const texto = p.toString();
    return `/obras/${obraId}/cronograma/${fase.uid}${texto ? `?${texto}` : ""}`;
  };
  const aberto = fase.checks.find((k) => k.momento === editando && editavel(k, hoje)) ?? null;
  // uma ação laranja por tela: o primeiro check para aprovar, e nenhum enquanto o editor está aberto
  const primeiroParaAprovar = aberto ? null : (fase.checks.find((k) => k.estado === "aprovar")?.id ?? null);

  function aprovar(k: CheckDaFase) {
    setErro(null);
    setRecado(null);
    setEmCurso({ id: k.id, acao: "aprovar" });
    iniciar(async () => {
      const r = await aprovarCheckAction(obraId, fase.uid, k.id);
      if (r.erro) return setErro(r.erro);
      setRecado(recadoDaAprovacao(k, r.saiEm ?? null, hoje));
    });
  }

  function desfazer(k: CheckDaFase) {
    setErro(null);
    setRecado(null);
    setEmCurso({ id: k.id, acao: "desfazer" });
    iniciar(async () => {
      const r = await desfazerAprovacaoAction(obraId, fase.uid, k.id);
      if (r?.erro) setErro(r.erro);
    });
  }

  return (
    <>
      {recado && (
        <p role="status" className="flex items-center gap-2 text-sm leading-5 font-semibold text-nivel">
          <Check {...ICONE} strokeWidth={3} className="size-4 shrink-0" />
          {recado}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="grid items-stretch gap-5 xl:grid-cols-3">
        {fase.checks.map((k) =>
          aberto?.id === k.id ? (
            <EditorDoCheck
              key={k.id}
              check={k}
              fase={fase}
              obraId={obraId}
              hoje={hoje}
              sair={endereco({ editar: null })}
              onSalvo={setRecadoAoFechar}
            />
          ) : (
            <CartaoDoCheck
              key={k.id}
              check={k}
              hoje={hoje}
              agora={new Date(agora)}
              editar={endereco({ editar: k.momento })}
              emCurso={pendente && emCurso?.id === k.id ? emCurso.acao : null}
              travado={pendente || aberto !== null}
              principal={k.id === primeiroParaAprovar}
              focar={devolverFoco === k.momento}
              onFocado={() => setDevolverFoco(null)}
              onAprovar={() => aprovar(k)}
              onDesfazer={() => desfazer(k)}
            />
          ),
        )}
      </div>
    </>
  );
}

/** A regra e o tamanho do check: "3 dias antes do início da fase · 5 perguntas". */
function linhaDaRegra(k: CheckDaFase): string {
  const perguntas = plural(k.perguntas.length, "pergunta", "perguntas");
  if (k.momento !== "durante") return `${regra(k.momento, k.dias, k.datas)} · ${perguntas}`;
  const saidas = enviados(k).length;
  if (saidas === 0) return `${regra("durante", k.dias, k.datas)}, ${ENQUANTO_DURAR} · ${perguntas}`;
  return `${regra("durante", k.dias, k.datas)} · ${perguntas} · ${saidas} de ${plural(k.datas.length, "envio", "envios")}`;
}

/** O que aconteceu com o check, sob a regra: quem aprovou, a entrega no WhatsApp, quem respondeu. */
function Situacao({ k, hoje, agora }: { k: CheckDaFase; hoje: string; agora: Date }) {
  const e = enviados(k)[0];
  if (k.estado === "agendado" && k.aprovadoEm)
    return (
      <p className={cn(LINHA_CABECALHO, "text-muted-foreground")}>
        Aprovado por {k.aprovadoPor ?? "—"} em {ddmm(diaDe(k.aprovadoEm))} às {horaDe(k.aprovadoEm)}
      </p>
    );
  if (k.estado === "naobra" && e?.enviadoEm) {
    const dia = diaDe(e.enviadoEm);
    const entrega =
      e.entrega === "falhou"
        ? " · não entregue"
        : e.entrega === "entregue" || e.entrega === "lido"
          ? " · entregue"
          : "";
    return (
      <>
        <p className={cn(LINHA_CABECALHO, "text-muted-foreground")}>
          Enviado {dia === hoje ? "hoje" : diaCurto(dia)} às {horaDe(e.enviadoEm)}
          {entrega}
          {e.lidoEm && ` · lido às ${horaDe(e.lidoEm)}`}
        </p>
        <p className={cn(LINHA_CABECALHO, "font-semibold")}>
          Sem resposta há {decorrido(e.enviadoEm, agora)}
        </p>
      </>
    );
  }
  if ((k.estado === "ok" || k.estado === "alerta") && e?.respondidoEm) {
    const total = e.total;
    return (
      <>
        <p className={cn(LINHA_CABECALHO, "text-muted-foreground")}>
          {e.respondidoPor ?? "A obra"} respondeu {diaCurto(diaDe(e.respondidoEm))} às{" "}
          {horaDe(e.respondidoEm)}
        </p>
        {fora(e) > 0 ? (
          <p className={cn(LINHA_CABECALHO, "font-semibold text-divergencia")}>
            {fora(e)} de {total} fora do esperado
          </p>
        ) : (
          <p className={cn(LINHA_CABECALHO, "font-semibold")}>
            {total} de {total} dentro do esperado
          </p>
        )}
      </>
    );
  }
  return null;
}

function CartaoDoCheck({
  check: k,
  hoje,
  agora,
  editar,
  emCurso,
  travado,
  principal,
  focar,
  onFocado,
  onAprovar,
  onDesfazer,
}: {
  check: CheckDaFase;
  hoje: string;
  agora: Date;
  editar: string;
  emCurso: "aprovar" | "desfazer" | null;
  /** Uma coisa de cada vez: com uma ação em curso ou um editor aberto, o cartão não age. */
  travado: boolean;
  /** O "Aprovar e agendar" deste cartão é a ação principal (laranja) da tela. */
  principal: boolean;
  /** Devolver o foco ao Editar (o editor deste cartão acabou de fechar). */
  focar: boolean;
  onFocado: () => void;
  onAprovar: () => void;
  onDesfazer: () => void;
}) {
  const id = useId();
  const linkEditar = useRef<HTMLAnchorElement>(null);
  const comHistorico = k.momento === "durante" && enviados(k).length > 0;
  const ultimo = enviados(k)[0];
  const respondido = (k.estado === "ok" || k.estado === "alerta") && ultimo?.respondidoEm;
  const alertaNaHistoria = enviados(k).some((e) => e.respondidoEm && fora(e) > 0);
  const semEnvioId = `${id}-sem-envio`;

  useEffect(() => {
    if (!focar) return;
    linkEditar.current?.focus();
    onFocado();
  }, [focar, onFocado]);

  const botaoEditar = travado ? (
    <Button key="editar" variant="outline" size="sm" disabled className={cn("h-11", TRAVADO)}>
      <Pencil {...ICONE} />
      Editar
    </Button>
  ) : (
    <Link
      key="editar"
      ref={linkEditar}
      href={editar}
      scroll={false}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11")}
    >
      <Pencil {...ICONE} />
      Editar
    </Link>
  );
  // o rodapé fica todo em 44 px: a ação principal não tem tamanho pequeno (button.tsx)
  // o botão travado não recebe o mouse: o motivo fica no title da caixa em volta e, para o leitor
  // de tela, no texto ligado ao botão
  const semEnvio = (
    rotulo: string,
    Icone: typeof Send | null,
    o: { laranja?: boolean; cheio?: boolean } = {},
  ) => (
    <span key={rotulo} title={SEM_ENVIO} className={cn("flex", o.cheio && "flex-1")}>
      <Button
        variant={o.laranja ? "default" : "outline"}
        size="sm"
        disabled
        aria-describedby={semEnvioId}
        className={cn("h-11 w-full", TRAVADO)}
      >
        {Icone && <Icone {...ICONE} />}
        {rotulo}
      </Button>
    </span>
  );
  const tratativa = semEnvio("Registrar tratativa", null, { laranja: true, cheio: true });
  const pe = (() => {
    if (k.estado === "sugerido" || k.estado === "aprovar")
      return [
        botaoEditar,
        <Button
          key="aprovar"
          variant={principal ? "default" : "outline"}
          size="sm"
          className={cn("h-11 flex-1", TRAVADO)}
          disabled={travado}
          onClick={onAprovar}
        >
          {emCurso === "aprovar" ? "Aprovando…" : k.estado === "aprovar" ? "Aprovar e agendar" : "Aprovar"}
        </Button>,
      ];
    if (k.estado === "agendado")
      return [
        botaoEditar,
        <Button
          key="desfazer"
          variant="outline"
          size="sm"
          className={cn("h-11 flex-1", TRAVADO)}
          disabled={travado}
          onClick={onDesfazer}
        >
          {emCurso === "desfazer" ? "Desfazendo…" : "Desfazer aprovação"}
        </Button>,
      ];
    // o Durante com saídas pela frente continua editável em qualquer estado
    if (temSaidaFutura(k, hoje))
      return [
        botaoEditar,
        alertaNaHistoria
          ? tratativa
          : k.estado === "naobra"
            ? semEnvio("Reenviar", Send, { cheio: true })
            : semEnvio("Perguntar de novo", RotateCw, { cheio: true }),
      ];
    if (k.estado === "naobra")
      return [alertaNaHistoria ? tratativa : semEnvio("Reenviar", Send, { cheio: true })];
    if (k.estado === "ok") return [semEnvio("Perguntar de novo", RotateCw, { cheio: true })];
    return [semEnvio("Perguntar de novo", RotateCw), tratativa];
  })();

  return (
    <section aria-labelledby={id} className="flex flex-col rounded-md border bg-card">
      <header className="space-y-3 border-b px-4 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3
            id={id}
            className="flex items-center gap-2 text-[13px] leading-[18px] font-semibold tracking-[0.06em] uppercase"
          >
            <Conta estado={k.estado} />
            {MOMENTO[k.momento]}
          </h3>
          <SeloDoCheck estado={k.estado} />
        </div>
        <div className="space-y-0.5">
          <p className="font-mono text-[15px] leading-[22px] font-medium">
            {quandoSai(k.momento, k.dias, k.hora, k.proxima)}
          </p>
          <p className={cn(LINHA_CABECALHO, "text-muted-foreground")}>{linhaDaRegra(k)}</p>
          {!comHistorico && <Situacao k={k} hoje={hoje} agora={agora} />}
        </div>
      </header>
      {comHistorico ? (
        <HistoricoDeEnvios check={k} agora={agora} />
      ) : respondido && ultimo ? (
        <ul className="divide-y">
          {ultimo.respostas.map((r) => (
            <ItemResposta key={r.perguntaId} resposta={r} perguntas={k.perguntas} />
          ))}
        </ul>
      ) : (
        <ul className="divide-y">
          {k.perguntas.map((p) => (
            <ItemPergunta key={p.id} pergunta={p} />
          ))}
        </ul>
      )}
      <div className="flex-1" />
      <footer className="flex gap-2 border-t px-4 pt-3.5 pb-4">
        <span id={semEnvioId} className="sr-only">
          {SEM_ENVIO}
        </span>
        {pe}
      </footer>
    </section>
  );
}

function ItemPergunta({ pergunta: p }: { pergunta: PerguntaDoCheck }) {
  return (
    <li className="space-y-2 px-4 py-3.5">
      <p className="text-sm leading-5">{p.texto}</p>
      <p className="flex items-center gap-2">
        <span className="text-xs leading-4 text-muted-foreground">{tipoDaResposta(p)}</span>
        {p.riscos.map((c) => (
          <EtiquetaRisco key={c} codigo={c} pequena />
        ))}
      </p>
      {/* pergunta de passagem entre tarefas: tem a data da tarefa dela, não a da fase */}
      {p.saiEm && (
        <p className="text-xs leading-4 text-muted-foreground">
          Sai {diaCurto(p.saiEm.data)}, antes de {p.saiEm.tarefa}
        </p>
      )}
    </li>
  );
}

/** Sem a pergunta na lista (saiu depois de respondida), a resposta é lida pelo próprio valor. */
function tipoPeloValor(valor: string): TipoResposta {
  if (valor === "sim" || valor === "nao") return "sim_nao";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return "data";
  return "texto";
}

/** A resposta manda: com ✓ ou ✕ e a palavra; fora do esperado ganha o filete vermelho e a observação. */
function ItemResposta({
  resposta: r,
  perguntas,
}: {
  resposta: RespostaDoCheck;
  perguntas: PerguntaDoCheck[];
}) {
  const p = perguntas.find((x) => x.id === r.perguntaId);
  const foraDoEsperado = r.dentro === false;
  const valor = respostaLegivel(p?.tipo ?? tipoPeloValor(r.valor), r.valor, p?.opcoes ?? []);
  const Icone = foraDoEsperado ? X : Check;
  return (
    <li
      className={cn(
        "space-y-2 py-3.5 pr-4",
        foraDoEsperado ? "border-l-[3px] border-divergencia pl-[13px]" : "pl-4",
      )}
    >
      <p className="text-[13px] leading-[18px] text-muted-foreground">{r.texto}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2">
          <Icone
            {...ICONE}
            strokeWidth={3}
            className={cn("size-3.5 shrink-0", foraDoEsperado ? "text-divergencia" : "text-nivel")}
          />
          <span
            className={cn("text-[15px] leading-[22px] font-semibold", foraDoEsperado && "text-divergencia")}
          >
            <span className="sr-only">{foraDoEsperado ? "Fora do esperado: " : "Resposta: "}</span>
            {valor}
          </span>
          {r.riscos.map((c) => (
            <EtiquetaRisco key={c} codigo={c} pequena />
          ))}
        </p>
        {r.temFoto && (
          <span
            role="img"
            aria-label="Com foto"
            className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.08]"
          >
            <Camera {...ICONE} className="size-[18px] text-muted-foreground" />
          </span>
        )}
      </div>
      {r.observacao && <p className="text-[13px] leading-[18px]">“{r.observacao}”</p>}
    </li>
  );
}

type LinhaDoEnvio = {
  id: string;
  dia: string;
  estado: EstadoCheck;
  resumo: string;
  envio: EnvioDoCheck | null;
};

/**
 * Os envios do Durante, do próximo agendado ao mais antigo; o envio aberto mostra as respostas dele
 * (ou as perguntas, enquanto ninguém respondeu). Abre no mais recente com alerta, senão no último respondido.
 */
function HistoricoDeEnvios({ check: k, agora }: { check: CheckDaFase; agora: Date }) {
  const base = useId();
  const saidas = enviados(k);
  const ultimo = saidas[0]?.previstoPara ?? "";
  const proximo = k.aprovadoEm ? k.datas.find((d) => d > ultimo) : undefined;
  const linhas: LinhaDoEnvio[] = [
    ...(proximo
      ? [{ id: "proximo", dia: proximo, estado: "agendado" as const, resumo: "o próximo", envio: null }]
      : []),
    ...saidas.map((e): LinhaDoEnvio => {
      const estado: EstadoCheck = !e.respondidoEm ? "naobra" : fora(e) > 0 ? "alerta" : "ok";
      const resumo =
        estado === "naobra" && e.enviadoEm
          ? `sem resposta há ${decorrido(e.enviadoEm, agora, true)}`
          : estado === "alerta"
            ? `${fora(e)} de ${e.total} fora`
            : `${e.total - fora(e)} de ${e.total}`;
      return { id: e.id, dia: e.previstoPara, estado, resumo, envio: e };
    }),
  ];
  const padrao =
    saidas.find((e) => e.respondidoEm && fora(e) > 0) ?? saidas.find((e) => e.respondidoEm) ?? null;
  const [aberto, setAberto] = useState<string | null>(padrao?.id ?? null);
  const linhaAberta = linhas.find((l) => l.id === aberto) ?? null;
  const detalhe = `${base}-detalhe`;

  return (
    <div className="divide-y">
      <div>
        <h4 className={cn(ROTULO, "flex h-10 items-center px-4")}>Envios</h4>
        <ul>
          {linhas.map((l) => {
            const estaAberto = l.id === aberto;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-expanded={estaAberto}
                  aria-controls={estaAberto ? detalhe : undefined}
                  onClick={() => setAberto(estaAberto ? null : l.id)}
                  className={cn(
                    "flex h-11 w-full items-center gap-2.5 border-t pr-3 pl-4 text-left hover:bg-foreground/[0.04]",
                    estaAberto && "bg-foreground/[0.07] hover:bg-foreground/[0.1]",
                  )}
                >
                  <span className="w-[76px] shrink-0 font-mono text-[13px] leading-5 font-medium">
                    {diaCurto(l.dia)}
                  </span>
                  <Conta estado={l.estado} />
                  <span className="flex min-w-0 flex-1 gap-1.5 text-[13px] leading-5">
                    <span className="font-semibold">{ESTADO_CHECK[l.estado]}</span>
                    <span className="truncate text-muted-foreground">· {l.resumo}</span>
                  </span>
                  {estaAberto ? (
                    <ChevronUp {...ICONE} className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown {...ICONE} className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {linhaAberta?.envio?.respondidoEm ? (
        <>
          <h4 id={detalhe} className={cn(ROTULO, "flex h-10 items-center px-4")}>
            Respostas de {diaCurto(linhaAberta.dia)} · {linhaAberta.envio.respondidoPor ?? "a obra"},{" "}
            {horaDe(linhaAberta.envio.respondidoEm)}
          </h4>
          <ul className="divide-y">
            {linhaAberta.envio.respostas.map((r) => (
              <ItemResposta key={r.perguntaId} resposta={r} perguntas={k.perguntas} />
            ))}
          </ul>
        </>
      ) : (
        linhaAberta && (
          <>
            <h4 id={detalhe} className={cn(ROTULO, "flex h-10 items-center px-4")}>
              Perguntas de {diaCurto(linhaAberta.dia)}
            </h4>
            <ul className="divide-y">
              {k.perguntas.map((p) => (
                <ItemPergunta key={p.id} pergunta={p} />
              ))}
            </ul>
          </>
        )
      )}
    </div>
  );
}
