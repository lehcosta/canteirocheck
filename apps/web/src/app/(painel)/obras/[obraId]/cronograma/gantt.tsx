"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { type EstadoCheck, resumoDaEtapa, type SituacaoPrazo, situacaoDoPrazo } from "@canteirocheck/core";
import type { CheckNoGantt, FaseNoGantt, TarefaCronograma } from "@canteirocheck/servicos";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  diaCurto,
  diasDaRegra,
  ESTADO_CHECK,
  ESTADOS_NA_LEGENDA,
  MOMENTO,
  MOMENTO_NA_DICA,
  plural,
  regra,
} from "@/features/checks/textos";
import { cn } from "@/lib/utils";
import { Conta, SeloDoCheck, SeloRisco } from "./contas";

const DIA = 86_400_000;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Colunas fixas à esquerda do tempo (px): nome, início, término e riscos. */
const FIXO = 264 + 84 + 84 + 112;
/** Botão travado sem transparência: cinza cheio, como o "Enviando…" da importação. */
const TRAVADO = "disabled:border-line disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";
const LINHA = "h-[34px] border-b last:border-b-0";
const CELULA_DATA = "w-[84px] font-mono text-[13px] font-medium text-muted-foreground";
const ROTULO = "text-xs leading-4 font-semibold tracking-[0.06em] uppercase";

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const curta = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—";

/** O que o cruzamento diz de cada fase, para a coluna Riscos e as contas sobre a barra. */
export interface RiscosNoGantt {
  /** Há um cruzamento concluído: vale a legenda dos checks. */
  analise: boolean;
  /** O primeiro cruzamento ainda roda: a coluna Riscos espera. */
  esperando: boolean;
  fases: FaseNoGantt[];
}

/** Do primeiro dia do mês da primeira tarefa ao fim do mês da última, com os meses da faixa. */
function escala(tarefas: TarefaCronograma[]) {
  const datas = tarefas.flatMap((t) => [t.inicio, t.termino]).filter((d): d is string => d !== null);
  if (datas.length === 0) return null;
  const min = new Date(Math.min(...datas.map(ms)));
  const max = new Date(Math.max(...datas.map(ms)));
  const inicio = Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1);
  const fim = Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 1, 1);
  const meses: { rotulo: string; largura: number }[] = [];
  for (let m = new Date(inicio); m.getTime() < fim; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const proximo = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1);
    const comAno = meses.length === 0 || m.getUTCMonth() === 0;
    meses.push({
      rotulo: `${MESES[m.getUTCMonth()]}${comAno ? ` ${String(m.getUTCFullYear()).slice(2)}` : ""}`,
      largura: ((proximo - m.getTime()) / (fim - inicio)) * 100,
    });
  }
  // cronograma longo: rotula um mês a cada N para o texto caber
  const passo = Math.ceil(meses.length / 14);
  return { inicio, total: fim - inicio, meses, passo };
}

/**
 * Gantt da versão vigente. Abre nas etapas e nas tarefas do nível 2; a seta de cada linha que
 * tem filhas abre e fecha o que está abaixo dela, e os dois botões ao lado do `cabecalho` abrem
 * ou fecham tudo de uma vez. Com o cruzamento, cada fase ganha o maior risco, o link para a
 * página dela e os três checks sobre a barra.
 */
export function Gantt({
  obraId,
  tarefas,
  hoje,
  cabecalho,
  faixa,
  riscos,
}: {
  obraId: string;
  tarefas: TarefaCronograma[];
  hoje: string;
  /** Título e resumo da seção: os botões de expandir e recolher ficam à direita dele. */
  cabecalho: React.ReactNode;
  /** Aviso entre o cabeçalho e o Gantt (sem projeto, cruzando, cruzamento que falhou). */
  faixa?: React.ReactNode;
  riscos: RiscosNoGantt;
}) {
  const temFilhas = useMemo(() => tarefas.map((t, i) => (tarefas[i + 1]?.nivel ?? 0) > t.nivel), [tarefas]);
  const padrao = useMemo(
    () => new Set(tarefas.filter((t, i) => temFilhas[i] && t.nivel >= 2).map((t) => t.ordem)),
    [tarefas, temFilhas],
  );
  const [fechadas, setFechadas] = useState(padrao);
  const e = useMemo(() => escala(tarefas), [tarefas]);
  // contra o prazo, em todas as linhas (não só nas abertas): o rodapé fala do cronograma inteiro
  const situacoes = useMemo(
    () => new Map(tarefas.map((t) => [t.ordem, situacaoDoPrazo(t, hoje)])),
    [tarefas, hoje],
  );
  const algumAtraso = [...situacoes.values()].some((s) => s?.estado === "atrasada");
  const fasePorUid = useMemo(() => new Map(riscos.fases.map((f) => [f.uid, f])), [riscos.fases]);
  // a etapa fechada resume as fases de dentro dela
  const fasesDaEtapa = useMemo(() => {
    const porEtapa = new Map<number, FaseNoGantt[]>();
    let etapa: number | null = null;
    for (const t of tarefas) {
      if (t.nivel === 1) etapa = t.ordem;
      const f = fasePorUid.get(t.uid);
      if (f && etapa !== null) porEtapa.set(etapa, [...(porEtapa.get(etapa) ?? []), f]);
    }
    return porEtapa;
  }, [tarefas, fasePorUid]);

  const visiveis: { t: TarefaCronograma; pai: boolean }[] = [];
  let escondeAbaixoDe: number | null = null;
  tarefas.forEach((t, i) => {
    if (escondeAbaixoDe !== null && t.nivel > escondeAbaixoDe) return;
    escondeAbaixoDe = temFilhas[i] && fechadas.has(t.ordem) ? t.nivel : null;
    visiveis.push({ t, pai: temFilhas[i] ?? false });
  });

  const noPadrao = fechadas.size === padrao.size && [...fechadas].every((o) => padrao.has(o));
  const algumPai = temFilhas.some(Boolean);
  // o botão que não tem o que fazer fica travado
  const tudoAberto = visiveis.length === tarefas.length;
  const tudoRecolhido = visiveis.every(({ t, pai }) => !pai || fechadas.has(t.ordem));
  // o botão clicado trava em seguida e perderia o foco: ele passa para o outro (quem usa o teclado continua ali)
  const botaoExpandir = useRef<HTMLButtonElement>(null);
  const botaoRecolher = useRef<HTMLButtonElement>(null);
  const expandirTudo = () => {
    setFechadas(new Set());
    botaoRecolher.current?.focus();
  };
  const recolherTudo = () => {
    setFechadas(new Set(tarefas.filter((_, i) => temFilhas[i]).map((t) => t.ordem)));
    botaoExpandir.current?.focus();
  };
  const legenda = !algumPai
    ? `${tarefas.length} linhas`
    : noPadrao
      ? `Etapas e tarefas até o nível 2 · ${visiveis.length} de ${tarefas.length} linhas`
      : `${visiveis.length} de ${tarefas.length} linhas`;

  const pct = (iso: string, fimDoDia = false) =>
    e ? ((ms(iso) + (fimDoDia ? DIA : 0) - e.inicio) / e.total) * 100 : 0;
  const posicaoHoje = e ? pct(hoje) : -1;
  const hojeNaEscala = posicaoHoje >= 0 && posicaoHoje <= 100;
  // meio do dia de hoje, dentro da faixa do tempo (que começa depois das colunas fixas)
  const esquerdaHoje = `calc(${FIXO}px + (100% - ${FIXO}px) * ${(e ? pct(hoje) + (DIA / 2 / e.total) * 100 : 0) / 100})`;
  const alternar = (ordem: number) =>
    setFechadas((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(ordem)) novo.add(ordem);
      return novo;
    });

  const nenhumAtraso = !algumAtraso && e && (
    <>
      <span className="flex items-center gap-1 font-semibold text-nivel">
        <Check aria-hidden className="size-3" strokeWidth={3} strokeLinecap="square" />
        Nenhuma tarefa atrás do previsto
      </span>
      <span aria-hidden>·</span>
    </>
  );
  const legendaBarras = (
    <ul aria-label="Legenda" className="flex items-center gap-5">
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-2.5 w-5 rounded-sm bg-nivel" />
        Executado
      </li>
      {algumAtraso && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-5 rounded-sm bg-divergencia" />
          Devia estar pronto
        </li>
      )}
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-2.5 w-5 rounded-sm bg-foreground/[0.22]" />
        Previsto
      </li>
    </ul>
  );

  return (
    <Tooltip.Provider delay={150} closeDelay={0}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          {/* o resumo quebra a linha antes de empurrar os botões para baixo */}
          <div className="min-w-0 flex-1 basis-96">{cabecalho}</div>
          {algumPai && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={TRAVADO}
                ref={botaoExpandir}
                disabled={tudoAberto}
                onClick={expandirTudo}
              >
                <ChevronsUpDown aria-hidden strokeWidth={2} strokeLinecap="square" />
                Expandir tudo
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={TRAVADO}
                ref={botaoRecolher}
                disabled={tudoRecolhido}
                onClick={recolherTudo}
              >
                <ChevronsDownUp aria-hidden strokeWidth={2} strokeLinecap="square" />
                Recolher tudo
              </Button>
            </div>
          )}
        </div>
        {faixa}
        <div className="max-h-[720px] overflow-auto rounded-md border bg-card">
          <div className="relative min-w-[900px]">
            {/* a linha do hoje vem antes da tabela: as barras e os rótulos de atraso ficam por cima dela */}
            {hojeNaEscala && (
              <div
                aria-hidden
                className="pointer-events-none absolute top-9 bottom-0 w-0.5 bg-foreground"
                style={{ left: esquerdaHoje }}
              />
            )}
            <table aria-label="Cronograma vigente" className="w-full table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="h-9 border-b bg-muted text-left text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  <th scope="col" className="w-[264px] pl-4 font-semibold">
                    Tarefa
                  </th>
                  <th scope="col" className="w-[84px] font-semibold">
                    Início
                  </th>
                  <th scope="col" className="w-[84px] font-semibold">
                    Término
                  </th>
                  <th scope="col" className="w-[112px] font-semibold">
                    Riscos
                  </th>
                  <th scope="col" className="p-0 font-normal tracking-normal normal-case">
                    <span className="sr-only">Barra no tempo</span>
                    <div aria-hidden className="flex h-9">
                      {e?.meses.map((m, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: os meses da escala não mudam de ordem
                          key={i}
                          style={{ width: `${m.largura}%` }}
                          className="flex items-center overflow-hidden border-l pl-1.5 font-mono text-xs font-medium"
                        >
                          {i % e.passo === 0 && m.rotulo}
                        </div>
                      ))}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(({ t, pai }) => {
                  const etapa = t.nivel === 1 && t.resumo;
                  const aberta = !fechadas.has(t.ordem);
                  const situacao = situacoes.get(t.ordem);
                  const fase = fasePorUid.get(t.uid);
                  const semData = Boolean(fase && fase.checks.length > 0 && (!t.inicio || !t.termino));
                  const resumo =
                    t.nivel === 1 && pai && !aberta
                      ? resumoDaEtapa(
                          (fasesDaEtapa.get(t.ordem) ?? []).map((f) => ({
                            nivel: f.nivel,
                            riscos: f.riscos,
                            checks: f.checks.map((c) => c.estado),
                          })),
                        )
                      : null;
                  return (
                    <tr
                      key={t.ordem}
                      className={cn(
                        LINHA,
                        fase &&
                          "group/linha hover:bg-foreground/[0.07] has-focus-visible:bg-foreground/[0.07]",
                      )}
                    >
                      <td className="relative p-0">
                        {fase && (
                          // o filete da linha sob o mouse ou com o foco do teclado
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-[3px] bg-foreground opacity-0 group-hover/linha:opacity-100 group-has-focus-visible/linha:opacity-100"
                          />
                        )}
                        <div
                          className={cn(
                            "flex h-[33px] items-center pr-2",
                            // num arquivo plano (sem filhas) nenhuma linha é etapa: sem negrito
                            ((algumPai && t.nivel === 1) || (pai && aberta)) && "font-semibold",
                          )}
                          style={{ paddingLeft: 16 * t.nivel + 16 * Math.max(0, t.nivel - 2) }}
                        >
                          {pai && (
                            <button
                              type="button"
                              aria-expanded={aberta}
                              aria-label={`${aberta ? "Fechar" : "Abrir"} ${t.nome}`}
                              onClick={() => alternar(t.ordem)}
                              className="-ml-1.5 flex size-[26px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              {aberta ? (
                                <ChevronDown
                                  aria-hidden
                                  className="size-3.5"
                                  strokeWidth={2}
                                  strokeLinecap="square"
                                />
                              ) : (
                                <ChevronRight
                                  aria-hidden
                                  className="size-3.5"
                                  strokeWidth={2}
                                  strokeLinecap="square"
                                />
                              )}
                            </button>
                          )}
                          {fase ? (
                            // o nome ocupa o resto da célula: o clique em qualquer ponto dela abre a fase
                            <Link
                              href={`/obras/${obraId}/cronograma/${t.uid}`}
                              title={t.nome}
                              aria-label={`${t.nome}: riscos e perguntas de check`}
                              className="flex h-[26px] min-w-0 flex-1 items-center rounded-sm group-hover/linha:font-semibold group-has-focus-visible/linha:font-semibold"
                            >
                              <span className="truncate">{t.nome}</span>
                            </Link>
                          ) : (
                            <span className="truncate" title={t.nome}>
                              {t.nome}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={CELULA_DATA}>{t.marco ? "" : curta(t.inicio)}</td>
                      <td className={CELULA_DATA}>{curta(t.termino)}</td>
                      <td className="p-0">
                        <CelulaRiscos
                          nivel={resumo ? resumo.nivel : (fase?.nivel ?? null)}
                          quantos={resumo ? resumo.riscos : (fase?.riscos ?? 0)}
                          fase={Boolean(fase)}
                          esperando={riscos.esperando}
                        />
                      </td>
                      <td className="relative p-0">
                        {semData ? (
                          <SemData posicaoHoje={Math.max(0, posicaoHoje)} />
                        ) : (
                          situacao &&
                          t.termino &&
                          e && (
                            <Marca
                              tarefa={t}
                              situacao={situacao}
                              etapa={etapa}
                              esquerda={pct(t.inicio ?? t.termino)}
                              direita={pct(t.termino, true)}
                              checks={fase?.checks ?? []}
                              resumo={resumo}
                            />
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hojeNaEscala && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-[26px] z-20 -translate-x-1/2 rounded-sm bg-foreground px-1.5 text-xs leading-[18px] font-semibold text-card"
                style={{ left: esquerdaHoje }}
              >
                hoje
              </span>
            )}
          </div>
        </div>
        {riscos.analise ? (
          <div className="space-y-2.5 text-[13px] leading-5 text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <ul aria-label="Checks da fase" className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <li aria-hidden className={ROTULO}>
                  Checks da fase
                </li>
                {ESTADOS_NA_LEGENDA.map((estado) => (
                  <li key={estado} className="flex items-center gap-1.5">
                    <Conta estado={estado} />
                    {ESTADO_CHECK[estado]}
                  </li>
                ))}
              </ul>
              {legendaBarras}
            </div>
            <p className="flex flex-wrap items-center gap-x-2">
              {nenhumAtraso}
              Cada fase leva três checks sobre a barra: antes de começar, durante e depois de terminar. Clique
              na fase para ver os riscos e as perguntas dela.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px] leading-5 text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-2">
              {nenhumAtraso}
              {legenda}
            </p>
            {legendaBarras}
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

/** O maior risco e quantos são; "—" na fase sem risco; o traço de espera enquanto o primeiro cruzamento roda. */
function CelulaRiscos({
  nivel,
  quantos,
  fase,
  esperando,
}: {
  nivel: "alto" | "medio" | "baixo" | null;
  quantos: number;
  fase: boolean;
  esperando: boolean;
}) {
  if (fase && esperando)
    return (
      <span className="flex h-[33px] items-center">
        <span aria-hidden className="h-2.5 w-14 rounded-sm bg-foreground/10" />
        <span className="sr-only">Cruzando</span>
      </span>
    );
  if (nivel)
    return (
      <span className="flex h-[33px] items-center gap-2">
        {/* o selo a 5 px do topo, em pixel inteiro: centrado nos 33 px ele cairia no meio pixel */}
        <span className="flex h-[33px] w-16 shrink-0 items-start pt-[5px]">
          <SeloRisco nivel={nivel} curto />
        </span>
        <span className="font-mono text-[13px] font-medium text-muted-foreground">
          <span className="sr-only">, </span>
          {quantos}
          <span className="sr-only"> {quantos === 1 ? "risco" : "riscos"}</span>
        </span>
      </span>
    );
  if (fase) return <span className="font-mono text-[13px] font-medium text-muted-foreground">—</span>;
  return null;
}

/**
 * A frase da fase sem data, 12 px depois da linha do hoje (o fundo cobre a linha). Quando ela não
 * cabe dali até o fim da faixa do tempo, encosta no começo da faixa, sem criar rolagem.
 */
function SemData({ posicaoHoje }: { posicaoHoje: number }) {
  const frase = useRef<HTMLSpanElement>(null);
  // antes de medir: o palpite pela posição do hoje (a frase ocupa pouco mais de meia faixa)
  const [cabe, setCabe] = useState(posicaoHoje <= 45);
  useLayoutEffect(() => {
    const el = frase.current;
    const faixa = el?.parentElement;
    if (!el || !faixa) return;
    const medir = () =>
      setCabe((faixa.clientWidth * posicaoHoje) / 100 + 12 + el.offsetWidth <= faixa.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(faixa);
    return () => observador.disconnect();
  }, [posicaoHoje]);
  return (
    <span
      ref={frase}
      className="pointer-events-none absolute top-1/2 flex h-5 -translate-y-1/2 items-center bg-card px-1 text-xs leading-5 whitespace-nowrap text-muted-foreground"
      style={{ left: cabe ? `calc(${posicaoHoje}% + 12px)` : "8px" }}
    >
      Sem data no cronograma: os checks não têm quando sair
    </span>
  );
}

const ROTULO_ESTADO = {
  atrasada: "atrasada",
  em_dia: "em dia",
  concluida: "concluída",
  nao_comecou: "não começou",
};

/** A frase que fecha a dica: o que falta, ou há quanto venceu. */
function fecho(t: TarefaCronograma, s: SituacaoPrazo): string[] {
  const resto = 100 - s.executado;
  if (t.marco) {
    if (s.diasVencida) return [`Venceu há ${plural(s.diasVencida, "dia", "dias")}.`];
    if (s.estado === "concluida") return [];
    if (s.diasParaTerminar === 0) return ["É hoje."];
    return [s.diasParaTerminar === 1 ? "Falta 1 dia." : `Faltam ${s.diasParaTerminar} dias.`];
  }
  if (s.estado === "concluida") return [];
  if (s.estado === "nao_comecou") return [`Começa em ${plural(s.diasParaComecar, "dia", "dias")}.`];
  if (s.diasVencida) return [`Venceu há ${plural(s.diasVencida, "dia", "dias")} com ${resto}% por fazer.`];
  const falta =
    s.diasParaTerminar === 0
      ? `Termina hoje, com ${resto}% por fazer.`
      : `${s.diasParaTerminar === 1 ? "Falta 1 dia" : `Faltam ${s.diasParaTerminar} dias`} e ${resto}% por fazer.`;
  return s.estado === "atrasada"
    ? [`${plural(s.pontosAtras, "ponto", "pontos")} atrás do previsto.`, falta]
    : [falta];
}

/** Quanto, ao lado da barra: em dias quando o término já passou, em pontos enquanto ainda corre. */
const desvio = (s: SituacaoPrazo) =>
  s.diasVencida ? `${s.diasVencida} d` : plural(s.pontosAtras, "ponto", "pontos");

/**
 * A marca de uma linha no tempo (barra, traço da etapa ou losango do marco) com o atraso à vista
 * e a dica de previsto contra executado, que abre com o mouse e com o foco do teclado. Na fase,
 * os três checks vão sobre a barra (no começo, no meio e no fim); na etapa fechada, depois do
 * atraso, o que espera aprovação e o que veio com alerta nas fases de dentro.
 */
function Marca({
  tarefa: t,
  situacao: s,
  etapa,
  esquerda,
  direita,
  checks,
  resumo,
}: {
  tarefa: TarefaCronograma;
  situacao: SituacaoPrazo;
  etapa: boolean;
  esquerda: number;
  direita: number;
  checks: CheckNoGantt[];
  resumo: { aprovar: number; alerta: number } | null;
}) {
  const atrasada = s.estado === "atrasada";
  const nome = `${t.nome}: ${t.marco && atrasada ? "atrasado" : ROTULO_ESTADO[s.estado]}. ${
    t.marco ? "" : `Previsto até hoje ${s.previsto}%, executado ${s.executado}%.`
  }`;
  const ALVO =
    "absolute top-1/2 -translate-y-1/2 cursor-default rounded-sm outline-offset-2 hover:outline-2 hover:outline-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const posicao = { left: `${esquerda}%`, width: `max(2px, ${direita - esquerda}%)` };
  // sem espaço à direita da barra, o rótulo vai para a esquerda dela
  const rotuloNaEsquerda = direita > 82;
  const meio = (esquerda + direita) / 2;
  // as três contas ficam no começo, no meio e no fim da barra; na barra curta elas se espalham em
  // volta do meio, 16 px de um centro ao outro, para não se sobrepor
  const centros =
    checks.length > 0
      ? [`min(${esquerda}%, ${meio}% - 16px)`, `${meio}%`, `max(${direita}%, ${meio}% + 16px)`]
      : null;
  const inicioDaMarca = t.marco ? `calc(${direita}% - 14px)` : (centros?.[0] ?? `${esquerda}%`);
  // o rótulo fica 12 px depois do fim da barra quando a última conta está sobre ele
  const afastamento = checks.length > 0 ? 12 : 6;
  const pendentes = (
    [
      ["aprovar", resumo?.aprovar ?? 0, "para aprovar"],
      ["alerta", resumo?.alerta ?? 0, "com alerta"],
    ] as const
  ).filter(([, n]) => n > 0);

  return (
    <>
      <Tooltip.Root>
        {t.marco ? (
          <Tooltip.Trigger
            aria-label={nome}
            className={cn(
              ALVO,
              "size-3.5 -translate-x-full",
              atrasada ? "text-divergencia" : "text-foreground",
            )}
            style={{ left: `${direita}%` }}
          >
            <svg aria-hidden viewBox="0 0 14 14" className="size-3.5">
              <path d="M7 0 14 7 7 14 0 7Z" fill="currentColor" />
            </svg>
          </Tooltip.Trigger>
        ) : etapa ? (
          <Tooltip.Trigger aria-label={nome} className={cn(ALVO, "flex h-3.5 items-center")} style={posicao}>
            <span className="h-1.5 w-full bg-foreground" />
          </Tooltip.Trigger>
        ) : (
          <Tooltip.Trigger
            aria-label={nome}
            className={cn(ALVO, "flex h-3.5 overflow-hidden bg-foreground/[0.22]")}
            style={posicao}
          >
            <span className="h-full shrink-0 bg-nivel" style={{ width: `${s.executado}%` }} />
            {atrasada && s.pontosAtras > 0 && (
              <span
                className="h-full shrink-0 bg-divergencia"
                style={{ width: `max(2px, ${s.pontosAtras}%)` }}
              />
            )}
          </Tooltip.Trigger>
        )}
        <Tooltip.Portal>
          <Tooltip.Positioner
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50"
          >
            <Tooltip.Popup className={POPUP}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm leading-5 font-semibold">{t.nome}</p>
                {atrasada ? (
                  <Badge variant="destructive">
                    <X aria-hidden strokeWidth={3} strokeLinecap="square" />
                    {t.marco ? "Atrasado" : "Atrasada"}
                  </Badge>
                ) : s.estado === "nao_comecou" ? (
                  <Badge variant="secondary">Não começou</Badge>
                ) : (
                  <Badge variant="nivel">
                    <Check aria-hidden strokeWidth={3} strokeLinecap="square" />
                    {s.estado === "concluida" ? "Concluída" : "Em dia"}
                  </Badge>
                )}
              </div>
              {t.marco ? (
                <LinhaDica rotulo="Data" valor={curta(t.termino)} />
              ) : (
                <>
                  <Medida rotulo="Previsto até hoje" pct={s.previsto} cor="bg-concreto" />
                  <Medida
                    rotulo="Executado"
                    pct={s.executado}
                    cor={atrasada ? "bg-divergencia" : "bg-nivel"}
                    corTexto={s.executado === 0 ? undefined : atrasada ? "text-divergencia" : "text-nivel"}
                  />
                  <hr className="border-line" />
                  <LinhaDica rotulo="Prazo" valor={`${curta(t.inicio ?? t.termino)} a ${curta(t.termino)}`} />
                </>
              )}
              {fecho(t, s).length > 0 && (
                <p className="leading-[18px] text-muted-foreground">
                  {fecho(t, s).map((frase) => (
                    <span key={frase} className="block">
                      {frase}
                    </span>
                  ))}
                </p>
              )}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      {checks.map((c, k) => (
        <ContaNaBarra key={c.momento} check={c} tarefa={t} centro={centros?.[k] ?? `${direita}%`} />
      ))}
      {(atrasada || pendentes.length > 0) && (
        <span
          className="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
          style={
            rotuloNaEsquerda
              ? { right: `calc(100% - ${inicioDaMarca} + ${afastamento}px)` }
              : { left: `calc(${centros?.[2] ?? `${direita}%`} + ${afastamento}px)` }
          }
        >
          {atrasada && (
            <span
              aria-hidden
              className="flex items-center gap-1 bg-card px-1 text-xs leading-5 font-semibold whitespace-nowrap text-divergencia"
            >
              <X className="size-3" strokeWidth={3} strokeLinecap="square" />
              {t.marco ? "atrasado" : "atrasada"} {desvio(s)}
            </span>
          )}
          {pendentes.map(([estado, n, rotulo]) => (
            <span
              key={estado}
              role="img"
              aria-label={`${n} ${rotulo}`}
              className="flex h-5 items-center gap-1 bg-card px-1"
            >
              <Conta estado={estado} />
              <span aria-hidden className="font-mono text-xs leading-5 font-medium text-foreground">
                {n}
              </span>
            </span>
          ))}
        </span>
      )}
    </>
  );
}

const POPUP =
  "w-72 space-y-2.5 rounded-md border border-foreground bg-card px-4 py-3.5 text-[13px] text-foreground transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0";
/** Os que ainda saem dizem quando; os que já saíram, não. */
const AINDA_SAI: EstadoCheck[] = ["sugerido", "aprovar", "agendado"];
const CONVITE: Record<EstadoCheck, string> = {
  sugerido: "Abra a fase para ler e aprovar.",
  aprovar: "Abra a fase para ler e aprovar.",
  agendado: "Abra a fase para ver as perguntas.",
  naobra: "Abra a fase para ver o envio.",
  ok: "Abra a fase para ver as respostas.",
  alerta: "Abra a fase para ver as respostas.",
};

/** Um check sobre a barra da fase, com a dica: o momento, quando sai, quantas perguntas e quem responde. */
function ContaNaBarra({
  check: c,
  tarefa: t,
  centro,
}: {
  check: CheckNoGantt;
  tarefa: TarefaCronograma;
  /** O centro da conta na faixa do tempo, em CSS. */
  centro: string;
}) {
  const estado = ESTADO_CHECK[c.estado].toLowerCase();
  const nome = `${MOMENTO[c.momento]}: ${estado}${c.saiEm && AINDA_SAI.includes(c.estado) ? `, sai ${diaCurto(c.saiEm)}` : ""}`;
  const dias = c.saiEm ? diasDaRegra(c.momento, c.saiEm, t) : null;
  const frase =
    dias === null
      ? ""
      : c.momento === "durante"
        ? `${regra("durante", dias, [])}, enquanto a fase durar`
        : regra(c.momento, dias, []);
  return (
    <Tooltip.Root>
      {/* alvo de 24 px com o desenho de 16 no meio; o anel (foco e mouse) contorna o alvo por dentro */}
      <Tooltip.Trigger
        aria-label={nome}
        className="absolute top-1/2 flex size-6 -translate-y-1/2 cursor-default items-center justify-center rounded-sm hover:outline-2 hover:-outline-offset-2 hover:outline-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{ left: `calc(${centro} - 12px)` }}
      >
        <Conta estado={c.estado} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        {/* a dica nasce 8 px sob o anel de foco da conta, alinhada ao começo dele */}
        <Tooltip.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Tooltip.Popup className={POPUP}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm leading-5 font-semibold">{MOMENTO_NA_DICA[c.momento]}</p>
                <p className="leading-[18px] text-muted-foreground">{t.nome}</p>
              </div>
              <SeloDoCheck estado={c.estado} />
            </div>
            <hr className="border-line" />
            <div className="space-y-1">
              <LinhaDica rotulo="Sai em" valor={c.saiEm ? `${diaCurto(c.saiEm)} · ${c.hora}` : "—"} />
              <LinhaDica rotulo="Perguntas" valor={String(c.perguntas)} />
              <LinhaDica rotulo="Quem responde" valor={c.responsavel ?? "—"} />
            </div>
            <p className="leading-[18px] text-muted-foreground">
              {frase && `${frase.charAt(0).toUpperCase()}${frase.slice(1)}. `}
              {CONVITE[c.estado]}
            </p>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function LinhaDica({ rotulo, valor, corTexto }: { rotulo: string; valor: string; corTexto?: string }) {
  return (
    <p className="flex items-center justify-between gap-6 leading-5">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn("font-mono font-medium", corTexto)}>{valor}</span>
    </p>
  );
}

function Medida({
  rotulo,
  pct,
  cor,
  corTexto,
}: {
  rotulo: string;
  pct: number;
  cor: string;
  corTexto?: string;
}) {
  return (
    <div className="space-y-1">
      <LinhaDica rotulo={rotulo} valor={`${pct}%`} corTexto={corTexto} />
      <div aria-hidden className="h-1.5 overflow-hidden rounded-sm bg-foreground/[0.14]">
        <div className={cn("h-full rounded-sm", cor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
