import { indicadoresDaObra } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Indicadores" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const horas = (h: number) =>
  `${h.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

const NUMERO = "text-right font-mono tabular-nums";

export default async function Indicadores({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await indicadoresDaObra(s.contexto, obraId);

  // Totais da obra: somas exatas das linhas por etapa.
  const soma = (f: (i: (typeof lista)[number]) => number) => lista.reduce((t, i) => t + f(i), 0);
  const execucoes = soma((i) => i.execucoes);
  const liberadas = soma((i) => i.liberadas);
  const primeira = soma((i) => i.okNaPrimeiraRodada);
  const barradas = soma((i) => i.bloqueadasOuRecusadas);
  const totais = [
    { rotulo: "Execuções", valor: String(execucoes) },
    { rotulo: "Liberadas", valor: String(liberadas) },
    { rotulo: "Ok na 1ª rodada", valor: pct(primeira, liberadas), nota: "das liberadas" },
    { rotulo: "Barradas", valor: String(barradas), nota: "bloqueadas, recusadas ou refeitas" },
  ];

  return (
    <section aria-labelledby="titulo-indicadores" className="space-y-4">
      <div className="space-y-1">
        <TituloSecao id="titulo-indicadores">Indicadores por etapa</TituloSecao>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Quanto a conferência antes do ponto sem volta está segurando: execuções barradas, causas mais comuns
          e o tempo até a liberação.
        </p>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-5 text-[15px] text-muted-foreground">
          Sem execuções ainda. Os números aparecem depois da primeira conferência.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {totais.map((t) => (
              <div key={t.rotulo} className="space-y-1 rounded-md border border-border bg-card p-5">
                <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {t.rotulo}
                </dt>
                <dd className="font-heading text-[32px] leading-10 font-bold tabular-nums">{t.valor}</dd>
                {t.nota && <dd className="text-[13px] text-muted-foreground">{t.nota}</dd>}
              </div>
            ))}
          </dl>

          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-5">Etapa</TableHead>
                  <TableHead className="h-11 text-right">Execuções</TableHead>
                  <TableHead className="h-11 text-right">Liberadas</TableHead>
                  <TableHead className="h-11 text-right">Ok na 1ª rodada</TableHead>
                  <TableHead className="h-11 text-right">Barradas</TableHead>
                  <TableHead className="h-11 text-right">Até liberar</TableHead>
                  <TableHead className="h-11 text-right">Medidas por conversa</TableHead>
                  <TableHead className="h-11 px-5">Causas de divergência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((i) => (
                  <TableRow key={i.etapa}>
                    <TableCell className="px-5 py-4 font-semibold">{i.etapa}</TableCell>
                    <TableCell className={NUMERO}>{i.execucoes}</TableCell>
                    <TableCell className={NUMERO}>{i.liberadas}</TableCell>
                    <TableCell className={NUMERO}>{pct(i.okNaPrimeiraRodada, i.liberadas)}</TableCell>
                    <TableCell className={NUMERO}>{i.bloqueadasOuRecusadas}</TableCell>
                    <TableCell className={NUMERO}>
                      {i.horasAteLiberacaoMedia === null ? "—" : horas(i.horasAteLiberacaoMedia)}
                    </TableCell>
                    <TableCell className={NUMERO}>{i.medidasNaoEstruturadas}</TableCell>
                    <TableCell className="min-w-64 px-5 py-4 whitespace-normal">
                      {i.causas.length ? (
                        <ul className="space-y-1 text-sm">
                          {i.causas.map((c) => (
                            <li key={c.causa} className="flex items-baseline justify-between gap-3">
                              <span>{c.causa}</span>
                              <span className="font-mono text-muted-foreground tabular-nums">
                                {c.quantidade}×
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Até liberar: média de horas entre o anúncio e a liberação. Medidas por conversa: respostas que
            vieram por texto livre, fora do formulário.
          </p>
        </>
      )}
    </section>
  );
}
