import type { Momento } from "@canteirocheck/core";
import type { FaseDoCronograma, RiscoDaFase } from "@canteirocheck/servicos";
import { Check, ChevronRight, ChevronUp, X } from "lucide-react";
import Link from "next/link";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Badge } from "@/components/ui/badge";
import { dataCurta, MOMENTO } from "@/features/checks/textos";
import { cn } from "@/lib/utils";
import { EtiquetaRisco, SeloRisco } from "../contas";

const ICONE = {
  "aria-hidden": true,
  strokeWidth: 2,
  strokeLinecap: "square",
  className: "size-3.5",
} as const;
const ROTULO = "text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const LINK =
  "flex shrink-0 items-center gap-1 rounded-sm text-sm leading-5 font-semibold text-prumo-text underline-offset-4 hover:underline";

/** A linha do cronograma que o risco cita: "linha 33" (a ordem do arquivo). */
const linha = (r: RiscoDaFase) => (r.cronogramaLinha === null ? "cronograma" : `linha ${r.cronogramaLinha}`);
const origemDoProjeto = (r: RiscoDaFase) =>
  r.projeto ? `${r.projeto.codigo} ${r.projeto.revisao}` : "Projeto";

/** Os dois trechos de onde o risco saiu, numa linha: o do projeto entre aspas, × a linha do cronograma. */
const provaResumida = (r: RiscoDaFase) =>
  r.tipo === "sequencia"
    ? `Antes: ${r.projetoTrecho} (${r.projetoReferencia ?? "cronograma"})  →  ${linha(r)}: ${r.cronogramaTrecho}`
    : `${origemDoProjeto(r)}: “${r.projetoTrecho}”  ×  ${linha(r)}: ${r.cronogramaTrecho}`;

/**
 * Em que pé está o risco pela última resposta das perguntas ligadas a ele. "Antes sem alerta" diz
 * de qual check veio quando só um deles respondeu sobre o risco.
 */
function Situacao({ risco, momentos }: { risco: RiscoDaFase; momentos: Set<Momento> }) {
  if (!risco.situacao) return null;
  if (risco.situacao.tipo === "em_aberto")
    return (
      <Badge variant="destructive">
        <X aria-hidden strokeWidth={3} strokeLinecap="square" />
        Em aberto
      </Badge>
    );
  const [unico] = momentos.size === 1 ? [...momentos] : [];
  return (
    <Badge variant="nivel">
      <Check aria-hidden strokeWidth={3} strokeLinecap="square" />
      {unico ? `${MOMENTO[unico]} sem alerta` : "Sem alerta"}
    </Badge>
  );
}

/** A prova lado a lado: o que o projeto diz, o que o cronograma diz e o que acontece se nada mudar. */
function Prova({ risco: r, fase, obraId }: { risco: RiscoDaFase; fase: FaseDoCronograma; obraId: string }) {
  const periodo =
    r.cronogramaInicio && r.cronogramaTermino
      ? `de ${dataCurta(r.cronogramaInicio)} a ${dataCurta(r.cronogramaTermino)}`
      : "sem data no cronograma";
  const sequencia = r.tipo === "sequencia";
  const versao = `v${fase.versaoCruzada ?? fase.versaoNumero}`;
  return (
    <div id={`prova-${r.codigo}`} className="space-y-4 px-4 pt-0.5 pb-[18px]">
      <div className="flex items-stretch">
        {sequencia ? (
          <Lado
            rotulo="Precisa estar pronta"
            dito={r.projetoTrecho}
            codigo={versao}
            origem={r.projetoReferencia ?? ""}
            acao={{ texto: "Ver no cronograma", href: `/obras/${obraId}/cronograma` }}
          />
        ) : (
          <Lado
            rotulo="O projeto diz"
            dito={`“${r.projetoTrecho}”`}
            codigo={origemDoProjeto(r)}
            origem={[r.projeto?.titulo, r.projetoReferencia].filter(Boolean).join(" · ")}
            acao={r.projeto && { texto: "Ver na prancha", href: `/obras/${obraId}/projetos/${r.projeto.id}` }}
          />
        )}
        <span
          aria-hidden
          className="flex w-12 shrink-0 items-center justify-center font-heading text-[30px] leading-8 font-extrabold"
        >
          {sequencia ? "→" : "×"}
        </span>
        <Lado
          rotulo={sequencia ? "Antes de começar" : "O cronograma diz"}
          dito={r.cronogramaTrecho}
          codigo={`v${fase.versaoCruzada ?? fase.versaoNumero} · ${linha(r)}`}
          origem={periodo}
          acao={{ texto: "Ver no cronograma", href: `/obras/${obraId}/cronograma` }}
        />
      </div>
      <p className="flex items-baseline gap-4">
        <span className={cn(ROTULO, "w-[108px] shrink-0")}>
          {sequencia ? "Se começar antes" : "Se nada mudar"}
        </span>
        <span className="text-[15px] leading-[22px]">{r.consequencia}</span>
      </p>
    </div>
  );
}

function Lado({
  rotulo,
  dito,
  codigo,
  origem,
  acao,
}: {
  rotulo: string;
  dito: string;
  codigo: string;
  origem: string;
  acao: { texto: string; href: string } | null;
}) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-3 rounded-md bg-muted px-[18px] py-4">
      <figcaption className={ROTULO}>{rotulo}</figcaption>
      <blockquote className="text-[17px] leading-[26px]">{dito}</blockquote>
      {/* empurra a origem para o pé quando o outro lado é mais alto (e soma um vão, como no desenho) */}
      <div aria-hidden className="flex-1" />
      <div className="flex items-center justify-between gap-4">
        <p className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
          <span className="shrink-0 font-mono font-medium">{codigo}</span>
          <span className="truncate text-muted-foreground">{origem}</span>
        </p>
        {acao && (
          <Link href={acao.href} className={LINK}>
            {acao.texto}
            <ChevronRight {...ICONE} />
          </Link>
        )}
      </div>
    </figure>
  );
}

/**
 * Os riscos do cruzamento para a fase, um por linha. A prova aberta vai no endereço (`?prova=R1`):
 * o estado tem link e volta com o botão de voltar do navegador.
 */
export function RiscosDaFase({
  fase,
  obraId,
  aberta,
  endereco,
}: {
  fase: FaseDoCronograma;
  obraId: string;
  /** Código do risco com a prova aberta. */
  aberta: string | null;
  /** O endereço da página com os parâmetros dados (os outros, como `agora`, ficam). */
  endereco: (troca: Record<string, string | null>) => string;
}) {
  // de quais checks vieram as respostas sobre cada risco
  const momentos = new Map<string, Set<Momento>>();
  for (const k of fase.checks)
    for (const e of k.envios)
      for (const r of e.respostas)
        for (const codigo of r.riscos)
          momentos.set(codigo, (momentos.get(codigo) ?? new Set()).add(k.momento));

  return (
    <section aria-labelledby="titulo-riscos" className="space-y-3">
      <div className="space-y-1">
        <TituloSecao id="titulo-riscos">Riscos do cruzamento</TituloSecao>
        <p className="text-[15px] leading-[22px] text-muted-foreground">
          O que o projeto e o cronograma dizem juntos sobre esta fase, e as passagens entre tarefas: o que
          precisa estar pronto antes de a seguinte começar. Cada risco cita de onde saiu.
        </p>
        {/* os riscos são do último cruzamento concluído, que pode ser de uma versão anterior à vigente */}
        {fase.versaoCruzada !== null && fase.versaoCruzada !== fase.versaoNumero && (
          <p className="text-[15px] leading-[22px] text-muted-foreground">
            Riscos lidos na v{fase.versaoCruzada}. O cruzamento da v{fase.versaoNumero} ainda não terminou.
          </p>
        )}
      </div>
      {fase.riscos.length === 0 ? (
        <p className="rounded-md border bg-card px-4 py-8 text-center text-[15px] text-muted-foreground">
          O cruzamento não apontou risco nesta fase.
        </p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {fase.riscos.map((r) => {
            const estaAberta = aberta === r.codigo;
            const emAberto = r.situacao?.tipo === "em_aberto";
            return (
              <li key={r.id}>
                <div
                  className={cn(
                    "flex items-center gap-3.5 py-3.5 pr-4",
                    emAberto ? "border-l-[3px] border-divergencia pl-[13px]" : "pl-4",
                  )}
                >
                  <EtiquetaRisco codigo={r.codigo} />
                  <span className="flex w-[106px] shrink-0">
                    <SeloRisco nivel={r.nivel} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h3 className="text-[15px] leading-[22px] font-semibold text-wrap">{r.titulo}</h3>
                    {!estaAberta && (
                      <p className="text-[13px] leading-[18px] whitespace-pre-wrap text-muted-foreground">
                        {provaResumida(r)}
                      </p>
                    )}
                  </div>
                  <Situacao risco={r} momentos={momentos.get(r.codigo) ?? new Set()} />
                  <Link
                    href={endereco({ prova: estaAberta ? null : r.codigo })}
                    scroll={false}
                    aria-expanded={estaAberta}
                    aria-controls={estaAberta ? `prova-${r.codigo}` : undefined}
                    aria-label={`${estaAberta ? "Fechar" : "Ver"} a prova de ${r.codigo}`}
                    className={LINK}
                  >
                    {estaAberta ? "Fechar a prova" : "Ver a prova"}
                    {estaAberta ? <ChevronUp {...ICONE} /> : <ChevronRight {...ICONE} />}
                  </Link>
                </div>
                {estaAberta && <Prova risco={r} fase={fase} obraId={obraId} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
