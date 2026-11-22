import type { PassosDaObra, SituacaoPasso } from "@canteirocheck/core";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinksDoPasso4 } from "./passos-obra-links";

/**
 * Os quatro passos de uma obra até a primeira conferência (regra em `passosDaObra`, packages/core): o trilho
 * vertical do cadastro, a faixa horizontal das abas da obra (compacta no celular) e o aviso de "pronta".
 */

const PASSOS = [
  {
    titulo: "Dados da obra",
    longa: "Nome, responsável e a hora da pergunta diária.",
    curta: "Nome, responsável, horário.",
  },
  {
    titulo: "Equipe no WhatsApp",
    longa: "Os encarregados que recebem a pergunta e medem.",
    curta: "Quem recebe a pergunta.",
  },
  { titulo: "Locais", longa: "Pavimentos, lajes, ambientes e eixos.", curta: "Pavimentos, lajes, eixos." },
  {
    titulo: "Pontos de controle",
    longa: "Do DWG do projeto ou cadastrados à mão.",
    curta: "Do DWG ou à mão.",
  },
] as const;

/** Como o passo aparece: além de feito/agora/depois, o passo de agora pode estar travado ou esperando alguém. */
type Aparencia = SituacaoPasso | "travado" | "falhou" | "espera";

const COR_ROTULO: Record<Aparencia, string> = {
  feito: "text-nivel",
  agora: "text-prumo-text",
  travado: "text-divergencia",
  falhou: "text-divergencia",
  espera: "text-muted-foreground",
  depois: "text-muted-foreground",
};

function Bolinha({ n, aparencia }: { n: number; aparencia: Aparencia }) {
  if (aparencia === "feito")
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-nivel text-surface-raised">
        <Check aria-hidden className="size-3.5" strokeWidth={2.6} />
      </span>
    );
  const cheia = aparencia === "agora" || aparencia === "falhou" || aparencia === "espera";
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-medium",
        cheia ? "bg-foreground text-background" : "border border-concreto bg-card text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

function Passo({
  n,
  aparencia,
  rotulo,
  descricao,
  children,
}: {
  n: number;
  aparencia: Aparencia;
  rotulo: string;
  descricao: "longa" | "curta";
  children?: React.ReactNode;
}) {
  const p = passoN(n);
  return (
    <li className="flex items-start gap-3.5">
      <Bolinha n={n} aparencia={aparencia} />
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            "text-[15px] leading-[22px] font-semibold",
            aparencia === "depois" && "text-muted-foreground",
          )}
        >
          {p.titulo}
        </p>
        <p className="text-[13px] leading-[18px] text-muted-foreground">{p[descricao]}</p>
        <p className={cn("text-xs font-semibold tracking-[0.06em] uppercase", COR_ROTULO[aparencia])}>
          {rotulo}
        </p>
        {children}
      </div>
    </li>
  );
}

/** O passo `n` (1 a 4). */
const passoN = (n: number) => PASSOS[n - 1] ?? PASSOS[0];

const ROTULO_PADRAO: Record<SituacaoPasso, string> = { feito: "Feito", agora: "Agora", depois: "Depois" };

// ── cadastro: o trilho vertical e a linha do celular ─────────────────────────────────────
/** `travado`: o rótulo do passo 1 quando o cadastro não pode seguir ("Falta um engenheiro"). */
export function TrilhoCadastro({ travado }: { travado?: string }) {
  return (
    <section aria-labelledby="titulo-trilho" className="hidden w-[340px] shrink-0 flex-col gap-5 md:flex">
      <div className="space-y-1">
        <h2 id="titulo-trilho" className="text-lg leading-6 font-semibold">
          Até a primeira conferência
        </h2>
        <p className="text-[13px] leading-[18px] text-muted-foreground">Quatro passos, todos pelo painel.</p>
      </div>
      <ol className="flex flex-col gap-[18px]">
        <Passo
          n={1}
          aparencia={travado ? "travado" : "agora"}
          rotulo={travado ?? "Agora"}
          descricao="longa"
        />
        <Passo n={2} aparencia="depois" rotulo="A seguir" descricao="longa" />
        <Passo n={3} aparencia="depois" rotulo="Depois" descricao="longa" />
        <Passo n={4} aparencia="depois" rotulo="Depois" descricao="longa" />
      </ol>
    </section>
  );
}

function Barra({ situacoes }: { situacoes: readonly SituacaoPasso[] }) {
  return (
    <div aria-hidden className="flex gap-1">
      {situacoes.map((s, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: os quatro passos são fixos
          key={i}
          className={cn(
            "h-1 flex-1 rounded-sm",
            s === "feito" ? "bg-nivel" : s === "agora" ? "bg-foreground" : "bg-line",
          )}
        />
      ))}
    </div>
  );
}

export function ProgressoCadastro() {
  return (
    <div className="space-y-2 md:hidden">
      <p className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.06em] text-prumo-text uppercase">
          Passo 1 de 4
        </span>
        <span className="text-[15px] leading-4 font-semibold">Dados da obra</span>
      </p>
      <Barra situacoes={["agora", "depois", "depois", "depois"]} />
      <p className="text-[13px] leading-[18px] text-muted-foreground">
        A seguir: equipe no WhatsApp, locais e pontos.
      </p>
    </div>
  );
}

// ── obra: a faixa das abas e o aviso de pronta ───────────────────────────────────────────
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export interface ContextoFaixa {
  obraId: string;
  passos: PassosDaObra;
  papel: string;
  responsavel: string;
  sugeridos: number;
  leitura: "pendente" | "processando" | "concluida" | "falhou" | null;
  /** Hora da pergunta diária (HH:mm), dita no passo 2 da faixa do celular. */
  horario: string;
}

/** O rótulo e a aparência do passo 4 quando ele é o de agora: lendo o DWG, leitura falhou, sugeridos… */
function passo4(c: ContextoFaixa): { aparencia: Aparencia; rotulo: string; resumo?: string; links: boolean } {
  if (c.sugeridos > 0)
    return c.papel === "engenheiro"
      ? {
          aparencia: "agora",
          rotulo: `Revise ${plural(c.sugeridos, "sugerido", "sugeridos")}`,
          resumo: "Basta um ponto aprovado para fechar o passo 4.",
          links: false,
        }
      : {
          aparencia: "espera",
          rotulo: `Esperando a ${c.responsavel}`,
          resumo: `${plural(c.sugeridos, "ponto espera", "pontos esperam")} a ${c.responsavel} aprovar pelo painel.`,
          links: false,
        };
  if (c.leitura === "pendente" || c.leitura === "processando")
    return { aparencia: "agora", rotulo: "Lendo o projeto", links: false };
  if (c.leitura === "falhou") return { aparencia: "falhou", rotulo: "Leitura falhou", links: false };
  return { aparencia: "agora", rotulo: "Agora", links: true };
}

export function FaixaPassos(c: ContextoFaixa) {
  const { situacoes, atual, feitos } = c.passos;
  const p4 = atual === 4 ? passo4(c) : null;
  const resumo = [
    `${feitos} de 4 ${feitos === 1 ? "feito" : "feitos"}.`,
    feitos === 1 ? "Esta faixa some quando os quatro estiverem prontos." : p4?.resumo,
  ]
    .filter(Boolean)
    .join(" ");
  const passoAtual = passoN(atual ?? 4);
  return (
    <section aria-labelledby="titulo-faixa" className="rounded-md border bg-card px-5 py-5 md:px-6">
      {/* celular: só o passo de agora e a barra */}
      <div className="space-y-2.5 md:hidden">
        <p className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-[0.06em] text-prumo-text uppercase">
            Passo {atual ?? 4} de 4
          </span>
          <span className="text-[15px] leading-4 font-semibold">{passoAtual.titulo}</span>
        </p>
        <Barra situacoes={situacoes} />
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          {p4 ? `${p4.rotulo}.` : atual === 2 ? `Quem recebe a pergunta das ${c.horario}.` : passoAtual.curta}
        </p>
      </div>
      <div className="hidden flex-col gap-[18px] md:flex">
        <div className="space-y-1">
          <h2 id="titulo-faixa" className="text-lg leading-6 font-semibold">
            Até a primeira conferência
          </h2>
          <p className="text-[13px] leading-[18px] text-muted-foreground">{resumo}</p>
        </div>
        <ol className="grid grid-cols-4 gap-6">
          {situacoes.map((s, i) => {
            const n = i + 1;
            const especial = n === 4 && p4;
            return (
              <Passo
                key={passoN(n).titulo}
                n={n}
                aparencia={especial ? p4.aparencia : s}
                rotulo={especial ? p4.rotulo : ROTULO_PADRAO[s]}
                descricao="curta"
              >
                {especial && p4.links && <LinksDoPasso4 obraId={c.obraId} />}
              </Passo>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export function AvisoPronta({ quem, quando }: { quem: string; quando: string }) {
  return (
    <section
      aria-labelledby="titulo-pronta"
      className="flex items-center gap-4 rounded-md border border-nivel bg-card px-5 py-5 md:px-6"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-nivel text-surface-raised">
        <Check aria-hidden className="size-5" strokeWidth={2.6} />
      </span>
      <div className="min-w-0 space-y-0.5">
        <h2 id="titulo-pronta" className="text-lg leading-6 font-semibold">
          Pronta para a primeira conferência
        </h2>
        <p className="text-[15px] leading-[22px]">
          {quando.charAt(0).toUpperCase() + quando.slice(1)} {quem} no WhatsApp. Quando uma etapa for
          anunciada, a conferência começa.
        </p>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Este aviso some quando a primeira etapa for anunciada.
        </p>
      </div>
    </section>
  );
}

// ── textos da pergunta diária ────────────────────────────────────────────────────────────
/** "Hoje às 16:00" ou "Amanhã às 16:00", conforme o relógio no fuso da obra. */
export function quandoPergunta(horario: string, fuso: string, agora = new Date()): string {
  const hhmm = horario.slice(0, 5);
  const relogio = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // com hour12: false, a meia-noite pode sair "24:00" e virar "amanhã"
  }).format(agora);
  return relogio < hhmm ? `hoje às ${hhmm}` : `amanhã às ${hhmm}`;
}

/** "o João recebe a pergunta" / "os 2 encarregados recebem a pergunta". */
export function quemRecebe(nomes: string[]): string {
  return nomes.length === 1
    ? `o ${nomes[0]} recebe a pergunta`
    : `os ${nomes.length} encarregados recebem a pergunta`;
}
