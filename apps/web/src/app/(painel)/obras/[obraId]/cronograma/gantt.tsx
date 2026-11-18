"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { type SituacaoPrazo, situacaoDoPrazo } from "@canteirocheck/core";
import type { TarefaCronograma } from "@canteirocheck/servicos";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DIA = 86_400_000;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Colunas fixas à esquerda do tempo (px): nome, início e término. */
const FIXO = 264 + 84 + 84;
/** Botão travado sem transparência: cinza cheio, como o "Enviando…" da importação. */
const TRAVADO = "disabled:border-line disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";
const LINHA = "h-[34px] border-b last:border-b-0";
const CELULA_DATA = "w-[84px] font-mono text-[13px] font-medium text-muted-foreground";

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const curta = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—";

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
 * ou fecham tudo de uma vez.
 */
export function Gantt({
  tarefas,
  hoje,
  cabecalho,
}: {
  tarefas: TarefaCronograma[];
  hoje: string;
  /** Título e resumo da seção: os botões de expandir e recolher ficam à direita dele. */
  cabecalho: React.ReactNode;
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
                  return (
                    <tr key={t.ordem} className={LINHA}>
                      <td className="p-0">
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
                          <span className="truncate" title={t.nome}>
                            {t.nome}
                          </span>
                        </div>
                      </td>
                      <td className={CELULA_DATA}>{t.marco ? "" : curta(t.inicio)}</td>
                      <td className={CELULA_DATA}>{curta(t.termino)}</td>
                      <td className="relative p-0">
                        {situacao && t.termino && e && (
                          <Marca
                            tarefa={t}
                            situacao={situacao}
                            etapa={etapa}
                            esquerda={pct(t.inicio ?? t.termino)}
                            direita={pct(t.termino, true)}
                          />
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
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px] leading-5 text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-2">
            {!algumAtraso && e && (
              <>
                <span className="flex items-center gap-1 font-semibold text-nivel">
                  <Check aria-hidden className="size-3" strokeWidth={3} strokeLinecap="square" />
                  Nenhuma tarefa atrás do previsto
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            {legenda}
          </p>
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
        </div>
      </div>
    </Tooltip.Provider>
  );
}

const ROTULO_ESTADO = {
  atrasada: "atrasada",
  em_dia: "em dia",
  concluida: "concluída",
  nao_comecou: "não começou",
};
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

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
 * e a dica de previsto contra executado, que abre com o mouse e com o foco do teclado.
 */
function Marca({
  tarefa: t,
  situacao: s,
  etapa,
  esquerda,
  direita,
}: {
  tarefa: TarefaCronograma;
  situacao: SituacaoPrazo;
  etapa: boolean;
  esquerda: number;
  direita: number;
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
  const inicioDaMarca = t.marco ? `calc(${direita}% - 14px)` : `${esquerda}%`;

  return (
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
      {atrasada && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1 bg-card px-1 text-xs leading-5 font-semibold whitespace-nowrap text-divergencia"
          style={
            rotuloNaEsquerda
              ? { right: `calc(100% - ${inicioDaMarca} + 6px)` }
              : { left: `calc(${direita}% + 6px)` }
          }
        >
          <X className="size-3" strokeWidth={3} strokeLinecap="square" />
          {t.marco ? "atrasado" : "atrasada"} {desvio(s)}
        </span>
      )}
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Tooltip.Popup className="w-72 space-y-2.5 rounded-md border border-foreground bg-card px-4 py-3.5 text-[13px] text-foreground transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
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
