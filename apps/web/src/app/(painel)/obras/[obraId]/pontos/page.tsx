import { listarPontos, obterObra, opcoesEtapas } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { criarPontoAction, revisarPontoAction } from "@/features/pontos/actions";
import { GRANDEZA, STATUS_REVISAO, TIPO_LOCAL, UNIDADE } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Pontos de controle" };

export default async function Pontos({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();
  const [pontos, etapas] = await Promise.all([listarPontos(s.contexto, obraId), opcoesEtapas(s.contexto)]);
  const engenheiro = s.papel === "engenheiro";
  const locais = obra.locais.map((l) => ({ valor: l.id, rotulo: `${TIPO_LOCAL[l.tipo]} ${l.nome}` }));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pontos de controle</CardTitle>
          <CardDescription>
            Só pontos <strong>aprovados</strong> por um engenheiro entram no checklist do WhatsApp. Pontos
            sugeridos pela IA mostram o trecho do projeto de onde vieram.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pontos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum ponto cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Etapa · local</TableHead>
                  <TableHead>Ponto</TableHead>
                  <TableHead>Esperado</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pontos.map((p) => (
                  <TableRow key={p.id} className={p.statusRevisao === "descartado" ? "opacity-50" : ""}>
                    <TableCell className="whitespace-nowrap">
                      {p.etapaNome} · {p.localNome}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <span className="font-medium">{p.descricao}</span>
                      {p.ehInterface && (
                        <Badge variant="outline" className="ml-2">
                          interface com {p.localReferenciaNome}
                        </Badge>
                      )}
                      {p.exigeFoto && <span className="ml-2 text-xs text-muted-foreground">exige foto</span>}
                      {p.trechoOrigem && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.origem === "ia" ? "IA, a partir de" : "origem"}: “{p.trechoOrigem}”
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {p.esperado}
                      {!p.toleranciaPropria && p.grandeza !== "existencia" && (
                        <span className="block text-xs text-muted-foreground">tolerância padrão</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.statusRevisao === "aprovado" ? "default" : "outline"}>
                        {STATUS_REVISAO[p.statusRevisao]}
                      </Badge>
                      {p.revisadoPor && (
                        <span className="block text-xs text-muted-foreground">{p.revisadoPor}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {engenheiro && p.statusRevisao !== "aprovado" && (
                        <FormularioAcao acao={revisarPontoAction} className="inline-block">
                          <input type="hidden" name="obraId" value={obraId} />
                          <input type="hidden" name="pontoId" value={p.id} />
                          <Button type="submit" name="decisao" value="aprovar" size="sm">
                            Aprovar
                          </Button>
                        </FormularioAcao>
                      )}
                      {engenheiro && p.statusRevisao !== "descartado" && (
                        <FormularioAcao acao={revisarPontoAction} className="inline-block">
                          <input type="hidden" name="obraId" value={obraId} />
                          <input type="hidden" name="pontoId" value={p.id} />
                          <Button type="submit" name="decisao" value="descartar" variant="ghost" size="sm">
                            Descartar
                          </Button>
                        </FormularioAcao>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Novo ponto manual</CardTitle>
          <CardDescription>
            Valor e tolerâncias na unidade escolhida. Sem tolerância, vale a padrão da construtora
            (Configurações).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioAcao acao={criarPontoAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="obraId" value={obraId} />
            <CampoSelect
              rotulo="Etapa"
              nome="etapaId"
              required
              vazio="Selecione…"
              opcoes={etapas.map((e) => ({ valor: String(e.id), rotulo: e.nome }))}
            />
            <CampoSelect rotulo="Local" nome="localId" required vazio="Selecione…" opcoes={locais} />
            <Campo
              rotulo="Região (agrupa no WhatsApp)"
              nome="regiao"
              placeholder="Laje L4 — eixos A a D"
              className="sm:col-span-2"
            />
            <Campo
              rotulo="Descrição"
              nome="descricao"
              required
              placeholder="Nível do fundo da forma — eixo A"
              className="sm:col-span-4"
            />
            <CampoSelect
              rotulo="Grandeza"
              nome="grandeza"
              required
              opcoes={Object.entries(GRANDEZA).map(([valor, rotulo]) => ({ valor, rotulo }))}
            />
            <CampoSelect
              rotulo="Unidade"
              nome="unidade"
              required
              opcoes={Object.entries(UNIDADE).map(([valor, rotulo]) => ({ valor, rotulo }))}
            />
            <Campo rotulo="Valor esperado" nome="valorEsperado" inputMode="decimal" placeholder="6,00" />
            <Campo rotulo="Referência de nível" nome="referenciaNivel" placeholder="RN-01" />
            <Campo rotulo="Tolerância +" nome="toleranciaMais" inputMode="decimal" placeholder="0,01" />
            <Campo rotulo="Tolerância −" nome="toleranciaMenos" inputMode="decimal" placeholder="0,01" />
            <CampoSelect
              rotulo="Interface com (já executado)"
              nome="localReferenciaId"
              vazio="Não é interface"
              opcoes={locais}
              className="sm:col-span-2"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ehInterface" /> É interface (mede os dois lados)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="exigeFoto" /> Exige foto
            </label>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm">
                Criar ponto
              </Button>
            </div>
          </FormularioAcao>
        </CardContent>
      </Card>
    </>
  );
}
