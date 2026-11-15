import { listarTolerancias } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { definirToleranciaAction } from "@/features/pontos/actions";
import { GRANDEZA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Tolerâncias padrão" };

const fmt = (v: string) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export default async function Tolerancias() {
  const s = await exigirSessao();
  const lista = await listarTolerancias(s.contexto);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tolerâncias padrão</CardTitle>
        <CardDescription>
          Usadas quando o ponto de controle não tem tolerância própria. Valem para todas as obras da
          construtora.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grandeza</TableHead>
              <TableHead>Tolerância</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{GRANDEZA[t.grandeza]}</TableCell>
                <TableCell className="tabular-nums">
                  +{fmt(t.toleranciaMais)} / −{fmt(t.toleranciaMenos)} {t.unidade}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <FormularioAcao acao={definirToleranciaAction} className="grid gap-3 sm:grid-cols-5">
          <CampoSelect
            rotulo="Grandeza"
            nome="grandeza"
            opcoes={Object.entries(GRANDEZA)
              .filter(([k]) => k !== "existencia")
              .map(([valor, rotulo]) => ({ valor, rotulo }))}
          />
          <CampoSelect
            rotulo="Unidade"
            nome="unidade"
            opcoes={["m", "cm", "mm"].map((u) => ({ valor: u, rotulo: u }))}
          />
          <Campo rotulo="Tolerância +" nome="toleranciaMais" required inputMode="decimal" />
          <Campo rotulo="Tolerância −" nome="toleranciaMenos" required inputMode="decimal" />
          <div className="flex items-end">
            <Button type="submit" size="sm">
              Salvar
            </Button>
          </div>
        </FormularioAcao>
      </CardContent>
    </Card>
  );
}
