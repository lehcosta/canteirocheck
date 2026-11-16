import { listarTolerancias } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { CabecalhoPagina, TituloSecao } from "@/components/cabecalho-pagina";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { definirToleranciaAction } from "@/features/pontos/actions";
import { GRANDEZA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Tolerâncias padrão" };

/** Casas decimais mínimas por unidade: metro em milímetros (0,010 m), centímetro com uma casa. */
const CASAS: Record<string, number> = { m: 3, cm: 1, mm: 0 };

const fmt = (v: string, unidade: string) =>
  Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: CASAS[unidade] ?? 0,
    maximumFractionDigits: 4,
  });

const MENSURAVEIS = (Object.keys(GRANDEZA) as (keyof typeof GRANDEZA)[]).filter((g) => g !== "existencia");

export default async function Tolerancias() {
  const s = await exigirSessao();
  const lista = await listarTolerancias(s.contexto);
  const linhas = MENSURAVEIS.map((g) => ({ grandeza: g, padrao: lista.find((t) => t.grandeza === g) }));
  const faltam = linhas.filter((l) => !l.padrao).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Tolerâncias padrão"
        descricao="Valem para todas as obras da construtora quando o ponto de controle não tem tolerância própria."
      />

      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-labelledby="titulo-grandezas"
          className="flex min-w-0 flex-[999_1_480px] flex-col gap-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <TituloSecao id="titulo-grandezas">Por grandeza</TituloSecao>
            <p className="text-sm text-muted-foreground">
              {faltam === 0
                ? "Todas definidas"
                : `${faltam} ${faltam === 1 ? "grandeza sem padrão" : "grandezas sem padrão"}`}
            </p>
          </div>
          <div className="rounded-md border bg-card">
            <Table aria-labelledby="titulo-grandezas">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Grandeza</TableHead>
                  <TableHead className="px-4 text-right">Para mais</TableHead>
                  <TableHead className="px-4 text-right">Para menos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(({ grandeza, padrao }) => (
                  <TableRow key={grandeza}>
                    <TableCell className="px-4 font-semibold">{GRANDEZA[grandeza]}</TableCell>
                    {padrao ? (
                      <>
                        <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                          +{fmt(padrao.toleranciaMais, padrao.unidade)}&nbsp;{padrao.unidade}
                        </TableCell>
                        <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                          −{fmt(padrao.toleranciaMenos, padrao.unidade)}&nbsp;{padrao.unidade}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={2} className="px-4 text-right">
                        <Badge variant="atencao">Não definida</Badge>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {faltam > 0 && (
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Sem padrão, cada ponto dessa grandeza precisa de tolerância própria.
            </p>
          )}
        </section>

        <section
          aria-labelledby="titulo-definir"
          className="flex min-w-0 flex-[1_1_340px] flex-col gap-5 rounded-md border bg-card p-6"
        >
          <div className="space-y-1">
            <TituloSecao id="titulo-definir">Definir tolerância</TituloSecao>
            <p className="text-sm text-muted-foreground">
              Se a grandeza já tem padrão, o valor novo substitui o anterior.
            </p>
          </div>
          <FormularioAcao
            acao={definirToleranciaAction}
            className="grid gap-4 space-y-0 sm:grid-cols-2 sm:[&>p]:col-span-2"
          >
            <CampoSelect
              rotulo="Grandeza"
              nome="grandeza"
              opcoes={MENSURAVEIS.map((valor) => ({ valor, rotulo: GRANDEZA[valor] }))}
            />
            <CampoSelect
              rotulo="Unidade"
              nome="unidade"
              opcoes={["m", "cm", "mm"].map((u) => ({ valor: u, rotulo: u }))}
            />
            <Campo
              rotulo="Tolerância +"
              nome="toleranciaMais"
              required
              inputMode="decimal"
              aria-describedby="dica-tolerancia"
              className="[&_input]:font-mono [&_input]:tabular-nums"
            />
            <Campo
              rotulo="Tolerância −"
              nome="toleranciaMenos"
              required
              inputMode="decimal"
              aria-describedby="dica-tolerancia"
              className="[&_input]:font-mono [&_input]:tabular-nums"
            />
            <p
              id="dica-tolerancia"
              className="text-[13px] leading-[18px] text-muted-foreground sm:col-span-2"
            >
              Na unidade escolhida, com vírgula: 0,010&nbsp;m, 1,0&nbsp;cm ou 10&nbsp;mm.
            </p>
            <Button type="submit" size="lg" className="w-full sm:col-span-2">
              Salvar tolerância
            </Button>
          </FormularioAcao>
        </section>
      </div>
    </>
  );
}
