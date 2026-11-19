import { ArrowRight, Check, FileText, LayoutGrid, Ruler, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LogotipoVivo } from "@/components/logotipo-vivo";
import { Logotipo } from "@/components/marca";
import { ReguaViva } from "@/components/regua-viva";
import { PLANOS } from "@/features/demonstracao/planos";
import { cn } from "@/lib/utils";
import { FormularioDemonstracao } from "./_landing/formulario-demonstracao";

export const metadata: Metadata = {
  title: { absolute: "EngCheck — conferência de obra pelo WhatsApp" },
  description:
    "O encarregado mede pelo WhatsApp, o EngCheck compara com o projeto e o engenheiro libera ou bloqueia pelo painel antes do ponto sem volta.",
};

const SECOES = [
  { href: "#como-funciona", rotulo: "Como funciona" },
  { href: "#painel", rotulo: "O painel" },
  { href: "#para-quem", rotulo: "Para quem" },
  { href: "#seguranca", rotulo: "Segurança" },
  { href: "#planos", rotulo: "Planos" },
  { href: "#perguntas", rotulo: "Perguntas" },
];

const ETAPAS = ["Forma", "Armação", "Concretagem", "Contrapiso", "Piso", "Drywall", "Forro", "Marcenaria"];

const PASSOS = [
  {
    titulo: "Envie o projeto",
    texto:
      "O EngCheck lê o DWG (cotas de nível, ambientes e notas) e sugere os pontos de controle de cada etapa, com a tolerância padrão. O engenheiro revisa e aprova.",
  },
  {
    titulo: "O encarregado anuncia",
    texto:
      "Todo dia o EngCheck pergunta no WhatsApp o que vai ser executado. O encarregado responde em poucos toques, ou por texto e áudio.",
  },
  {
    titulo: "Mede e manda foto",
    texto:
      "Um formulário no próprio WhatsApp pede ponto por ponto. Se a medida sai da tolerância, ele vê na hora e pode refazer ou justificar.",
  },
  {
    titulo: "Você libera ou bloqueia",
    texto:
      "O engenheiro decide no painel, com as medidas e as fotos na tela. A resposta chega ao encarregado no WhatsApp e o relatório em PDF sai sozinho.",
  },
];

const MUDANCAS = [
  {
    Icone: Smartphone,
    titulo: "Sem aplicativo novo no canteiro",
    texto: "O encarregado usa o WhatsApp que já tem. Sem senha, sem treinamento, funciona com sinal fraco.",
  },
  {
    Icone: FileText,
    titulo: "O projeto vira checklist",
    texto:
      "Os pontos de controle saem do DWG, não da memória. Notas do projeto que dependem de definição travam a etapa até alguém resolver.",
  },
  {
    Icone: Ruler,
    titulo: "Tolerância clara para todos",
    texto:
      "Nível, distância, prumo, esquadro e existência, cada um com a sua tolerância. Quem mede sabe na hora se passou.",
  },
  {
    Icone: LayoutGrid,
    titulo: "Histórico que resolve discussão",
    texto:
      "Medidas, fotos, justificativas e decisões com nome, data e hora, num PDF pronto para mostrar ao cliente ou à fiscalização.",
  },
];

const PUBLICOS = [
  {
    titulo: "Construtora",
    texto: "Todas as obras em um painel: o que está aguardando decisão, o que foi barrado e por quê.",
    itens: [
      "Indicadores por etapa e por obra",
      "Tolerâncias padrão da empresa",
      "Relatórios em PDF de cada liberação",
    ],
  },
  {
    titulo: "Engenheiro responsável",
    texto: "Decide com o número e a foto na tela, sem precisar estar no canteiro em cada etapa.",
    itens: [
      "Pontos de controle sugeridos pelo DWG",
      "Libera ou bloqueia em um clique",
      "Pendências do projeto em um só lugar",
    ],
  },
  {
    titulo: "Encarregado",
    texto: "Recebe no WhatsApp o que medir e responde ali mesmo. Sabe na hora se pode seguir.",
    itens: [
      "Formulário ponto a ponto, com foto",
      "Pode responder por texto ou áudio",
      "Decisão do engenheiro no mesmo chat",
    ],
  },
];

const SEGURANCA = [
  ["Dados separados por construtora", "O isolamento é feito no próprio banco de dados, não só na tela."],
  ["Entrada sem senha", "O painel abre por um link no e-mail que vale 15 minutos e funciona uma vez só."],
  [
    "Quem, o quê e quando",
    "Cada medida, foto e decisão fica registrada com o nome de quem fez, a data e a hora.",
  ],
  [
    "PDF com impressão digital",
    "Todo relatório traz o código SHA-256 do arquivo para provar que não foi alterado.",
  ],
];

const PERGUNTAS = [
  [
    "O encarregado precisa instalar algum aplicativo?",
    "Não. Tudo acontece no WhatsApp que ele já usa: o anúncio da etapa, o formulário de medidas e as fotos. Ele também pode responder por texto ou por áudio.",
  ],
  [
    "Preciso ter o projeto em DWG?",
    "Ajuda muito: o DWG é lido automaticamente e vira sugestões de pontos de controle. Sem ele, o engenheiro cadastra os pontos à mão e o PDF do projeto fica anexado como referência.",
  ],
  [
    "O que acontece quando uma medida sai da tolerância?",
    "O encarregado vê na hora e pode refazer a medida ou justificar. A etapa fica aguardando o engenheiro, que libera (com justificativa escrita) ou bloqueia e pede nova conferência.",
  ],
  [
    "A inteligência artificial decide alguma coisa?",
    "Não. A IA lê o projeto e entende mensagens de texto e áudio do canteiro. Quem libera ou bloqueia uma etapa é sempre o engenheiro responsável.",
  ],
  [
    "Quais etapas dá para conferir?",
    "Forma, armação, concretagem, contrapiso, piso, drywall, forro e marcenaria, com tolerâncias padrão que a construtora pode ajustar.",
  ],
];

const sobrancelha = "text-xs leading-4 font-semibold tracking-[0.06em] uppercase";
const tituloSecao =
  "font-heading text-[32px] leading-[1.05] font-extrabold tracking-[-0.02em] sm:text-[44px]";
const conteiner = "mx-auto w-full max-w-[1200px]";

/** Régua de nível do padrão gráfico: cápsula de `liquido` com a bolha no centro. */
function Regua({ fundo = "bg-[#191816]" }: { fundo?: string }) {
  return (
    <span aria-hidden className="relative block h-4 w-12 rounded-lg bg-liquido">
      <span className={cn("absolute top-1 left-4 h-2 w-4 rounded-md", fundo)} />
    </span>
  );
}

function Bolha({ de, children }: { de: "encarregado" | "prumo"; children: React.ReactNode }) {
  return de === "encarregado" ? (
    <p className="max-w-[82%] self-end rounded-[12px_12px_2px_12px] bg-[#191816] px-3 py-2 text-[#F3F1EC]">
      {children}
    </p>
  ) : (
    <div className="max-w-[88%] self-start rounded-[12px_12px_12px_2px] border bg-card px-3 py-2.5">
      {children}
    </div>
  );
}

function ConversaExemplo() {
  return (
    <div
      role="img"
      aria-label="Exemplo de conversa do encarregado com o EngCheck no WhatsApp: um ponto fora da tolerância, refeito e anotado"
      className="relative flex min-h-[640px] min-w-0 flex-[1_1_420px] justify-center overflow-hidden rounded-[8px] bg-[#191816] px-6 py-12"
    >
      <span aria-hidden className="absolute bottom-0 left-8 h-[72%] w-[88px] rounded-t-md bg-liquido" />
      <span aria-hidden className="absolute bottom-0 left-[136px] h-[38%] w-14 rounded-t-md bg-concreto" />
      <span
        aria-hidden
        className="absolute bottom-[calc(38%+16px)] left-[136px] h-8 w-14 rounded-md bg-prumo"
      />
      <span aria-hidden className="absolute top-10 right-7 grid grid-cols-2 gap-4">
        <Regua />
        <Regua />
        <Regua />
        <Regua />
      </span>

      <div className="relative flex w-[300px] max-w-full flex-col overflow-hidden rounded-[36px] border-[10px] border-ink-muted bg-background">
        <div className="flex items-center gap-2.5 border-b bg-card px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#191816]">
            <svg viewBox="0 0 64 64" className="size-[26px]" aria-hidden>
              <rect x="10" y="21" width="44" height="22" rx="11" fill="var(--liquido)" />
              <rect
                x="10"
                y="21"
                width="44"
                height="22"
                rx="11"
                fill="none"
                stroke="#F3F1EC"
                strokeWidth={6}
              />
              <rect x="26" y="28" width="12" height="7" rx="3.5" fill="#fff" />
              <rect x="22" y="24" width="2.4" height="16" fill="#F3F1EC" />
              <rect x="39.6" y="24" width="2.4" height="16" fill="#F3F1EC" />
            </svg>
          </span>
          <div>
            <p className="text-[15px] leading-5 font-semibold">EngCheck</p>
            <p className="text-xs text-muted-foreground">Residencial Jardim das Acácias</p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-3 pt-4 pb-5 text-sm leading-5">
          <Bolha de="encarregado">Vou concretar a L4 amanhã cedo.</Bolha>
          <Bolha de="prumo">
            <p>
              <strong className="font-semibold">Concretagem · L4</strong> — 3 pontos para medir antes de
              liberar.
            </p>
            <span className="mt-2 flex h-9 items-center justify-center border-t font-semibold text-prumo-text">
              Fazer conferência
            </span>
          </Bolha>
          <Bolha de="prumo">
            <span className="font-semibold text-divergencia">Ponto 2 fora da tolerância:</span>{" "}
            <span className="font-mono">3,018 m</span> (esperado{" "}
            <span className="font-mono">3,000 ±0,010</span>). Refaça a medida ou justifique.
          </Bolha>
          <Bolha de="encarregado">
            Ajustei a forma. Deu <span className="font-mono">3,004 m</span>.
          </Bolha>
          <Bolha de="prumo">
            <span className="font-semibold text-nivel">Dentro da tolerância.</span> Anotado. O engenheiro vai
            conferir.
          </Bolha>
        </div>
      </div>
    </div>
  );
}

function ConferenciaExemplo() {
  const linhas = [
    { ponto: "Nível do fundo — eixo A", esperado: "3,000 m", medido: "3,004 m", dentro: true },
    {
      ponto: "Nível do fundo — eixo C",
      esperado: "3,000 m",
      medido: "3,018 m",
      dentro: false,
      desvio: "8 mm",
    },
    { ponto: "Prumo do pilar P12", esperado: "0 mm", medido: "4 mm", dentro: true },
  ];
  return (
    <div
      role="img"
      aria-label="Exemplo de conferência no painel: um ponto fora da tolerância, aguardando liberação"
      className="claro flex min-w-0 flex-[1_1_520px] flex-col gap-4 rounded-md bg-card p-6 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-heading text-[22px] leading-7 font-bold">Concretagem · L4</p>
          <p className="text-[13px] text-ink-muted">Conferida por João Pereira · hoje, 14:32</p>
        </div>
        <span className="inline-flex h-[26px] items-center rounded-sm bg-prumo px-2.5 text-xs font-semibold tracking-[0.06em] text-on-prumo uppercase">
          Aguardando liberação
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[460px] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] tracking-[0.06em] text-ink-muted uppercase">
              <th scope="col" className="border-b border-line px-3 py-2.5 text-left font-semibold">
                Ponto
              </th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-right font-semibold">
                Esperado
              </th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-right font-semibold">
                Medido
              </th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-left font-semibold">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={l.ponto} className={cn(i < linhas.length - 1 && "border-b border-line")}>
                <td className={cn("px-3 py-3", !l.dentro && "font-semibold")}>{l.ponto}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">{l.esperado}</td>
                <td
                  className={cn(
                    "px-3 py-3 text-right font-mono tabular-nums",
                    !l.dentro && "text-divergencia",
                  )}
                >
                  {l.medido}
                </td>
                <td
                  className={cn(
                    "px-3 py-3 text-xs font-semibold tracking-[0.06em] uppercase",
                    l.dentro ? "text-nivel" : "text-divergencia",
                  )}
                >
                  {l.dentro ? "✓ Dentro" : `✕ Fora · ${l.desvio}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div aria-hidden className="flex flex-wrap gap-3">
        <span className="inline-flex h-11 items-center rounded-md bg-prumo px-[18px] text-[15px] font-semibold text-on-prumo">
          Liberar concretagem
        </span>
        <span className="inline-flex h-11 items-center rounded-md border border-divergencia px-[18px] text-[15px] font-semibold text-divergencia">
          Bloquear e pedir nova medida
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground">
      {/* topo fixo: no celular fica só logo, "Entrar" e o botão, para não ocupar a tela */}
      <header className="sticky top-0 z-40 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <div className={cn(conteiner, "flex items-center justify-between gap-4 lg:gap-8")}>
          <Link href="/" aria-label="EngCheck, início" className="text-foreground">
            <LogotipoVivo className="h-7 sm:h-8" />
          </Link>
          <nav aria-label="Seções" className="hidden items-center gap-x-6 text-[15px] lg:flex">
            {SECOES.map((s) => (
              <a key={s.href} href={s.href} className="py-2.5 hover:text-prumo-text">
                {s.rotulo}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/login" className="py-2.5 text-[15px] font-semibold hover:text-prumo-text">
              Entrar
            </Link>
            <a
              href="#demonstracao"
              className="inline-flex h-11 items-center rounded-md bg-primary px-3.5 text-[15px] font-semibold text-primary-foreground sm:px-[18px]"
            >
              <span className="sm:hidden">Demonstração</span>
              <span className="hidden sm:inline">Agendar demonstração</span>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section id="inicio" className="scroll-mt-20 px-6 pt-16 pb-24 sm:pt-[72px]">
          <div className={cn(conteiner, "flex flex-wrap items-center gap-14")}>
            <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
              <p className={cn(sobrancelha, "text-prumo-text")}>Conferência de obra pelo WhatsApp</p>
              <h1 className="font-heading text-[42px] leading-none font-extrabold tracking-[-0.025em] sm:text-[56px] lg:text-[68px]">
                Confira antes do ponto sem volta.
              </h1>
              <p className="max-w-[560px] text-[19px] leading-[30px] text-muted-foreground">
                O encarregado mede pelo WhatsApp, o EngCheck compara com o projeto e mostra o que saiu da
                tolerância. Você libera ou bloqueia pelo painel antes de concretar, fechar a parede ou
                assentar o piso.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="#demonstracao"
                  className="inline-flex h-[52px] items-center gap-2 rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground"
                >
                  Agendar demonstração
                  <ArrowRight aria-hidden className="size-[18px]" />
                </a>
                <a
                  href="#como-funciona"
                  className="inline-flex h-[52px] items-center rounded-md border border-concreto bg-card px-6 text-base font-semibold"
                >
                  Ver como funciona
                </a>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {[
                  "Nada para o encarregado instalar",
                  "Lê o projeto em DWG",
                  "Relatório PDF de cada liberação",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check aria-hidden className="size-4 text-nivel" strokeWidth={3} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <ConversaExemplo />
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-20 border-y bg-card px-6 py-24">
          <div className={cn(conteiner, "flex flex-col gap-12")}>
            <div className="flex max-w-[720px] flex-col gap-4">
              <p className={cn(sobrancelha, "text-prumo-text")}>Como funciona</p>
              <h2 className={tituloSecao}>Do projeto à liberação, em quatro passos.</h2>
              <p className="text-lg leading-7 text-muted-foreground">
                Cada etapa crítica passa pela mesma conferência: o que o projeto pede, o que foi medido e quem
                decidiu.
              </p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="flex flex-col gap-3 rounded-md bg-background p-6">
                  <span className="font-mono text-[15px] font-medium text-prumo-text">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[19px] leading-[26px] font-semibold">{p.titulo}</h3>
                  <p className="text-[15px] leading-[23px] text-muted-foreground">{p.texto}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
              <span className="text-sm font-semibold">Etapas prontas para conferir</span>
              <ul className="flex flex-wrap gap-2">
                {ETAPAS.map((e) => (
                  <li key={e} className="inline-flex h-8 items-center rounded-sm border px-3 text-sm">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="painel" className="scroll-mt-20 dark bg-[#191816] px-6 py-24 text-foreground">
          <div className={cn(conteiner, "flex flex-wrap items-center gap-14")}>
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
              <p className={cn(sobrancelha, "text-prumo-text")}>O painel do engenheiro</p>
              <h2 className={tituloSecao}>Medida antes de opinião.</h2>
              <p className="text-lg leading-7 text-muted-foreground">
                Cada conferência chega com o esperado, o medido, a tolerância e o desvio, ponto por ponto.
                Nada de “tá bom” por telefone: a decisão fica registrada com nome, data e hora.
              </p>
              <ul className="mt-2 flex flex-col gap-3.5 text-base">
                {[
                  "Etapas aguardando decisão no topo, com o que está fora destacado.",
                  "Liberar com ponto fora da tolerância exige justificativa escrita.",
                  "Indicadores por etapa: o que passa de primeira e as causas que mais se repetem.",
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-liquido" strokeWidth={3} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <ConferenciaExemplo />
          </div>
        </section>

        <section id="beneficios" className="scroll-mt-20 px-6 py-24">
          <div className={cn(conteiner, "flex flex-col gap-12")}>
            <div className="flex max-w-[720px] flex-col gap-4">
              <p className={cn(sobrancelha, "text-prumo-text")}>O que muda na obra</p>
              <h2 className={tituloSecao}>O erro aparece quando ainda dá para corrigir.</h2>
            </div>
            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {MUDANCAS.map(({ Icone, titulo, texto }) => (
                <div key={titulo} className="flex flex-col gap-3">
                  <span className="flex size-11 items-center justify-center rounded-md bg-[#191816] text-liquido">
                    <Icone aria-hidden className="size-[22px]" />
                  </span>
                  <h3 className="text-[19px] leading-[26px] font-semibold">{titulo}</h3>
                  <p className="text-[15px] leading-[23px] text-muted-foreground">{texto}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="para-quem" className="scroll-mt-20 border-y bg-card px-6 py-24">
          <div className={cn(conteiner, "flex flex-col gap-12")}>
            <div className="flex max-w-[720px] flex-col gap-4">
              <p className={cn(sobrancelha, "text-prumo-text")}>Para quem</p>
              <h2 className={tituloSecao}>Cada um faz a sua parte, no lugar certo.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {PUBLICOS.map((p) => (
                <article key={p.titulo} className="flex flex-col gap-3.5 rounded-md border p-7">
                  <h3 className="font-heading text-2xl leading-7 font-bold">{p.titulo}</h3>
                  <p className="text-[15px] leading-[23px] text-muted-foreground">{p.texto}</p>
                  <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[15px] leading-[22px]">
                    {p.itens.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="seguranca" className="scroll-mt-20 px-6 py-24">
          <div className={cn(conteiner, "flex flex-wrap gap-12")}>
            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
              <p className={cn(sobrancelha, "text-prumo-text")}>Segurança</p>
              <h2 className={tituloSecao}>O registro da obra é da construtora.</h2>
              <p className="text-lg leading-7 text-muted-foreground">
                E fica do jeito que foi feito: ninguém muda uma medida depois que ela foi enviada.
              </p>
            </div>
            <dl className="grid min-w-0 flex-[2_1_560px] gap-x-8 sm:grid-cols-2">
              {SEGURANCA.map(([t, d]) => (
                <div key={t} className="border-t py-5">
                  <dt className="text-base font-semibold">{t}</dt>
                  <dd className="mt-1.5 text-[15px] leading-[23px] text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="planos" className="scroll-mt-20 border-t px-6 py-16 sm:py-24">
          <div className={cn(conteiner, "flex flex-col gap-8 sm:gap-12")}>
            <div className="flex flex-col gap-3 sm:gap-4">
              <p className={cn(sobrancelha, "text-prumo-text")}>Planos</p>
              <h2 className={tituloSecao}>Um preço por tamanho de construtora.</h2>
              <p className="text-base leading-6 text-muted-foreground sm:text-lg sm:leading-7">
                Você paga pelas obras ativas. O encarregado no WhatsApp não entra na conta.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
              {PLANOS.map((p) => (
                <article
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-6 rounded-md border p-6 sm:p-7",
                    // no celular a recomendada sobe para o topo da pilha
                    p.destaque ? "border-ink bg-ink text-surface-raised max-lg:order-first" : "bg-card",
                  )}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex min-h-7 items-center justify-between gap-3">
                      <h3 className="font-heading text-2xl leading-7 font-bold">{p.nome}</h3>
                      {p.destaque && (
                        <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-liquido px-2 text-xs font-semibold tracking-[0.06em] text-on-prumo uppercase">
                          Recomendado
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-[15px] leading-[23px]",
                        p.destaque ? "text-line" : "text-ink-muted",
                      )}
                    >
                      {p.frase}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-end gap-1.5">
                      <span
                        className={cn(
                          "font-mono text-base leading-10 font-medium",
                          p.destaque ? "text-line" : "text-ink-muted",
                        )}
                      >
                        R$
                      </span>
                      <span className="font-heading text-5xl leading-none font-extrabold tracking-[-0.02em]">
                        {p.preco}
                      </span>
                      <span
                        className={cn(
                          "text-[15px] leading-[34px]",
                          p.destaque ? "text-line" : "text-ink-muted",
                        )}
                      >
                        /mês
                      </span>
                    </p>
                    <p
                      className={cn(
                        "font-mono text-[13px] leading-5 font-medium",
                        p.destaque ? "text-line" : "text-ink-muted",
                      )}
                    >
                      {p.ano}
                    </p>
                  </div>
                  <span aria-hidden className={cn("h-px", p.destaque ? "bg-ink-muted" : "bg-line")} />
                  <div className="flex flex-1 flex-col gap-2.5 text-[15px] leading-[22px]">
                    <p className="font-semibold">{p.obras}</p>
                    <ul className="flex flex-col gap-2.5">
                      {p.itens.map((i) => (
                        <li key={i} className="flex items-center gap-2.5">
                          <Check
                            aria-hidden
                            className={cn("size-4 shrink-0", p.destaque ? "text-liquido" : "text-nivel")}
                            strokeWidth={3}
                          />
                          {i}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Link
                    href={`/?plano=${p.id}#demonstracao`}
                    aria-label={`Quero o plano ${p.nome}`}
                    className={cn(
                      "inline-flex h-11 items-center justify-center rounded-md px-[18px] text-[15px] font-semibold",
                      p.destaque
                        ? // sobre o grafite o anel de foco usa o laranja de texto do tema escuro
                          "bg-prumo text-on-prumo hover:bg-[color-mix(in_oklch,var(--prumo),var(--ink)_10%)] focus-visible:outline-[#ff8e57]"
                        : "border border-concreto bg-card text-ink hover:bg-surface",
                    )}
                  >
                    Quero este plano
                  </Link>
                </article>
              ))}
            </div>
            <div className="flex flex-col gap-4 text-[15px] leading-[22px] lg:flex-row lg:items-center lg:justify-between">
              <p className="text-muted-foreground">
                Em todos: encarregados sem limite no WhatsApp, mensagens incluídas e nenhuma taxa de
                implantação.
              </p>
              <p className="flex shrink-0 flex-wrap items-center gap-x-2">
                Mais de 15 obras?
                <Link
                  href="/?plano=sob-medida#demonstracao"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-prumo-text hover:underline max-lg:py-2.5"
                >
                  Falar com a EngCheck
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section id="perguntas" className="scroll-mt-20 border-t bg-card px-6 py-24">
          <div className="mx-auto flex max-w-[880px] flex-col gap-8">
            <h2 className={tituloSecao}>Perguntas frequentes</h2>
            <div className="flex flex-col border-t">
              {PERGUNTAS.map(([p, r], i) => (
                <details key={p} open={i === 0} className="group border-b">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg leading-[26px] font-semibold [&::-webkit-details-marker]:hidden">
                    {p}
                    <span aria-hidden className="shrink-0 font-mono text-prumo-text group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="pb-5 text-base leading-[25px] text-muted-foreground">{r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="demonstracao" className="scroll-mt-20 dark bg-[#191816] px-6 py-24 text-foreground">
          <div className={cn(conteiner, "flex flex-wrap items-start gap-14")}>
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
              <p className={cn(sobrancelha, "text-prumo-text")}>Demonstração</p>
              <h2 className="font-heading text-4xl leading-none font-extrabold tracking-[-0.025em] sm:text-[56px]">
                Obra no prumo.
              </h2>
              <p className="text-lg leading-7 text-muted-foreground">
                Mostramos uma conferência inteira com uma obra sua: do DWG ao WhatsApp do encarregado e à
                liberação no painel.
              </p>
              <ReguaViva className="mt-4 block h-auto w-full max-w-[320px]" />
            </div>
            {/* o cartão volta ao tema claro para o formulário */}
            <div className="claro min-w-0 flex-[1_1_440px] rounded-md bg-card p-8 text-foreground">
              <FormularioDemonstracao />
            </div>
          </div>
        </section>
      </main>

      <footer className="dark border-t border-line bg-[#191816] px-6 pt-10 pb-12 text-muted-foreground">
        <div className={cn(conteiner, "flex flex-wrap items-center justify-between gap-6")}>
          <div className="flex flex-col gap-2.5">
            <Logotipo className="h-7 self-start text-foreground" />
            <span className="text-sm">Obra no prumo: cada etapa conferida antes de seguir.</span>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {[
              ...SECOES.filter((s) => s.href !== "#painel" && s.href !== "#para-quem"),
              { href: "#demonstracao", rotulo: "Demonstração" },
            ].map((s) => (
              <a key={s.href} href={s.href} className="py-2.5 text-foreground hover:text-prumo-text">
                {s.rotulo}
              </a>
            ))}
            <Link href="/login" className="py-2.5 text-foreground hover:text-prumo-text">
              Entrar no painel
            </Link>
          </nav>
          <span className="text-[13px]">© 2026 EngCheck</span>
        </div>
      </footer>
    </div>
  );
}
