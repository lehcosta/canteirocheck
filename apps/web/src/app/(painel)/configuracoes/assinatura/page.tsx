import { CATALOGO, PLANOS_PAGOS } from "@canteirocheck/core";
import { type Assinatura, confirmarCheckout, nomeDoPlano, obterAssinatura } from "@canteirocheck/servicos";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CabecalhoPagina, TituloSecao } from "@/components/cabecalho-pagina";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { assinarAction, gerenciarAssinaturaAction } from "@/features/assinatura/actions";
import { exigirSessao } from "@/lib/sessao";
import { stripe } from "@/lib/stripe";

export const metadata: Metadata = { title: "Assinatura" };

const reais = (centavos: number, casas = 2) =>
  (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const data = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const STATUS: Record<
  string,
  { rotulo: string; variante: "nivel" | "atencao" | "destructive" | "secondary" }
> = {
  active: { rotulo: "Ativa", variante: "nivel" },
  trialing: { rotulo: "Em teste", variante: "nivel" },
  past_due: { rotulo: "Pagamento pendente", variante: "atencao" },
  unpaid: { rotulo: "Não paga", variante: "destructive" },
  canceled: { rotulo: "Cancelada", variante: "destructive" },
  incomplete: { rotulo: "Pagamento incompleto", variante: "atencao" },
  incomplete_expired: { rotulo: "Expirada", variante: "destructive" },
  paused: { rotulo: "Pausada", variante: "atencao" },
};

function PlanoAtual({ a, ehAdmin }: { a: Assinatura; ehAdmin: boolean }) {
  const status = a.status ? STATUS[a.status] : undefined;
  const preco =
    a.plano in CATALOGO && a.periodicidade
      ? CATALOGO[a.plano as keyof typeof CATALOGO].centavos[a.periodicidade as "mensal" | "anual"]
      : null;
  return (
    <section aria-labelledby="titulo-atual" className="flex flex-col gap-5 rounded-md border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Plano atual</p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="titulo-atual" className="font-heading text-2xl leading-7 font-bold">
              {a.status === null ? "Piloto" : nomeDoPlano(a.plano)}
            </h2>
            {status ? (
              <Badge variant={status.variante}>{status.rotulo}</Badge>
            ) : (
              <Badge variant="secondary">Sem cobrança</Badge>
            )}
          </div>
          {preco !== null && a.valendo && (
            <p className="font-mono text-sm font-medium tabular-nums text-muted-foreground">
              R$ {reais(preco)} {a.periodicidade === "anual" ? "por ano" : "por mês"}
            </p>
          )}
        </div>
        {ehAdmin && a.temCliente && (
          <FormularioAcao acao={gerenciarAssinaturaAction} className="space-y-2">
            <Button type="submit" variant={a.valendo ? "outline" : "default"}>
              {a.valendo ? "Gerenciar assinatura" : "Ver faturas e cartão"}
            </Button>
          </FormularioAcao>
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-4 border-t pt-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Obras ativas</dt>
          <dd className="font-mono text-lg font-medium tabular-nums">
            {a.obrasAtivas}
            {a.limiteObras !== null && a.limiteObras > 0 && <> de {a.limiteObras}</>}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            {a.status === null ? "Cobrança" : a.cancelaNoFim ? "Termina em" : "Próxima cobrança"}
          </dt>
          <dd className="text-[15px] leading-7">
            {a.status === null
              ? "Construtora piloto, sem teto de obras"
              : a.fimPeriodo && a.valendo
                ? data(a.fimPeriodo)
                : "Sem cobrança prevista"}
          </dd>
        </div>
      </dl>
      {a.status === "past_due" && (
        <p className="text-sm text-prumo-text">
          O último pagamento não passou. Atualize o cartão em Gerenciar assinatura para não perder o plano.
        </p>
      )}
      {a.limiteObras === 0 && (
        <p className="text-sm text-divergencia">
          Sem assinatura ativa, as obras que existem continuam, mas não dá para abrir obra nova.
        </p>
      )}
    </section>
  );
}

function EscolherPlano({ a }: { a: Assinatura }) {
  return (
    <section aria-labelledby="titulo-planos" className="flex flex-col gap-4">
      <div className="space-y-1">
        <TituloSecao id="titulo-planos">
          {a.status === null ? "Escolher plano" : "Assinar de novo"}
        </TituloSecao>
        <p className="text-sm text-muted-foreground">
          O pagamento é feito na página segura do Stripe. Encarregados no WhatsApp não entram na conta.
        </p>
      </div>
      <FormularioAcao acao={assinarAction} className="flex flex-col gap-4 space-y-0">
        <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <legend className="sr-only">Periodicidade</legend>
          <label className="flex min-h-11 items-center gap-2 text-[15px]">
            <input
              type="radio"
              name="periodicidade"
              value="mensal"
              defaultChecked
              className="size-4 accent-ink"
            />
            Mensal
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[15px]">
            <input type="radio" name="periodicidade" value="anual" className="size-4 accent-ink" />
            Anual, pagando 10 meses
          </label>
        </fieldset>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANOS_PAGOS.map((id) => {
            const p = CATALOGO[id];
            const cabe = a.obrasAtivas <= p.limiteObras;
            return (
              <div key={id} className="flex flex-col gap-4 rounded-md border bg-card p-6">
                <div className="space-y-1">
                  <h3 className="font-heading text-xl leading-7 font-bold">{p.nome}</h3>
                  <p className="font-mono text-sm font-medium tabular-nums">
                    R$ {reais(p.centavos.mensal)}/mês · R$ {reais(p.centavos.anual, 0)}/ano
                  </p>
                </div>
                <p className="flex items-center gap-2 text-[15px]">
                  <Check aria-hidden className="size-4 shrink-0 text-nivel" strokeWidth={3} />
                  até {p.limiteObras} obras ativas
                </p>
                {!cabe && (
                  <p className="text-[13px] leading-[18px] text-muted-foreground">
                    Hoje há {a.obrasAtivas} obras ativas, acima do teto deste plano.
                  </p>
                )}
                <Button
                  type="submit"
                  name="plano"
                  value={id}
                  variant={id === "construtora" ? "default" : "outline"}
                  className="mt-auto w-full"
                  disabled={!cabe}
                >
                  Assinar {p.nome}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Mais de 15 obras? Fale com a Prumo para um plano sob medida.
        </p>
      </FormularioAcao>
    </section>
  );
}

export default async function PaginaAssinatura({
  searchParams,
}: {
  searchParams: Promise<{ sessao?: string; confirmada?: string }>;
}) {
  const s = await exigirSessao();
  const { sessao, confirmada } = await searchParams;
  if (sessao) {
    // Volta do Checkout: grava na hora, sem esperar o webhook, e limpa a URL (F5 não relê o Stripe).
    const ok = await confirmarCheckout(s.contexto, stripe, sessao).catch(() => false);
    redirect(ok ? "/configuracoes/assinatura?confirmada=1" : "/configuracoes/assinatura");
  }
  const a = await obterAssinatura(s.contexto);
  const ehAdmin = s.papel === "admin";

  return (
    <>
      <CabecalhoPagina
        titulo="Assinatura"
        descricao="O plano define quantas obras podem estar ativas ao mesmo tempo."
      />
      {confirmada === "1" && (
        <p
          role="status"
          className="rounded-md border border-nivel bg-card px-4 py-3 text-[15px] font-semibold text-nivel"
        >
          Assinatura confirmada. Obrigado!
        </p>
      )}
      {!stripe && ehAdmin && (
        <p className="rounded-md border bg-card px-4 py-3 text-[15px] text-muted-foreground">
          A cobrança ainda não está configurada neste ambiente (falta STRIPE_SECRET_KEY).
        </p>
      )}
      <PlanoAtual a={a} ehAdmin={ehAdmin} />
      {ehAdmin && !a.valendo && stripe && <EscolherPlano a={a} />}
      {!ehAdmin && (
        <p className="text-sm text-muted-foreground">
          Só o admin da construtora troca o plano ou paga a assinatura.
        </p>
      )}
    </>
  );
}
