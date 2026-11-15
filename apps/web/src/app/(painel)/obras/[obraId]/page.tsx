import { listarUsuarios, obterObra } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adicionarMembroAction, criarLocalAction, removerMembroAction } from "@/features/obras/actions";
import { formatarWhatsapp, PAPEL, STATUS_OBRA, TIPO_LOCAL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Obra" };

export default async function DetalheObra({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();

  const usuarios = await listarUsuarios(s.contexto);
  const naEquipe = new Set(obra.membros.map((m) => m.usuarioId));
  const candidatos = usuarios.filter((u) => u.ativo && !naEquipe.has(u.id));
  const nomeLocal = new Map(obra.locais.map((l) => [l.id, `${TIPO_LOCAL[l.tipo]} ${l.nome}`]));

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{obra.nome}</h1>
        <Badge variant={obra.status === "ativa" ? "default" : "secondary"}>{STATUS_OBRA[obra.status]}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da obra</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Endereço</dt>
              <dd>{obra.endereco ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Área</dt>
              <dd>{obra.areaM2 ? `${Number(obra.areaM2).toLocaleString("pt-BR")} m²` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Engenheiro responsável</dt>
              <dd>{obra.engenheiroResponsavel.nome}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pergunta diária aos encarregados</dt>
              <dd>
                {obra.horarioAnuncio} ({obra.fusoHorario})
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Locais</CardTitle>
            <CardDescription>
              Pavimentos, lajes, ambientes e eixos usados nos pontos de controle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {obra.locais.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum local cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Dentro de</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {obra.locais.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{TIPO_LOCAL[l.tipo]}</TableCell>
                      <TableCell className="font-medium">{l.nome}</TableCell>
                      <TableCell>{l.paiId ? nomeLocal.get(l.paiId) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <FormularioAcao acao={criarLocalAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="obraId" value={obra.id} />
              <CampoSelect
                rotulo="Tipo"
                nome="tipo"
                required
                opcoes={Object.entries(TIPO_LOCAL).map(([valor, rotulo]) => ({ valor, rotulo }))}
              />
              <Campo rotulo="Nome" nome="nome" required placeholder="L4" />
              <CampoSelect
                rotulo="Dentro de"
                nome="paiId"
                vazio="—"
                opcoes={obra.locais.map((l) => ({ valor: l.id, rotulo: nomeLocal.get(l.id) ?? l.nome }))}
              />
              <div className="sm:col-span-3">
                <Button type="submit" variant="outline" size="sm">
                  Adicionar local
                </Button>
              </div>
            </FormularioAcao>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipe</CardTitle>
            <CardDescription>
              Encarregados recebem a pergunta diária e os checklists pelo WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {obra.membros.map((m) => (
                  <TableRow key={m.usuarioId}>
                    <TableCell className="font-medium">{m.nome}</TableCell>
                    <TableCell>{PAPEL[m.papel]}</TableCell>
                    <TableCell className="tabular-nums">{formatarWhatsapp(m.whatsappE164)}</TableCell>
                    <TableCell className="text-right">
                      {m.usuarioId !== obra.engenheiroResponsavel.id && (
                        <FormularioAcao acao={removerMembroAction}>
                          <input type="hidden" name="obraId" value={obra.id} />
                          <input type="hidden" name="usuarioId" value={m.usuarioId} />
                          <Button type="submit" variant="ghost" size="sm">
                            Remover
                          </Button>
                        </FormularioAcao>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {candidatos.length > 0 && (
              <FormularioAcao acao={adicionarMembroAction} className="flex items-end gap-3">
                <input type="hidden" name="obraId" value={obra.id} />
                <CampoSelect
                  rotulo="Adicionar à equipe"
                  nome="usuarioId"
                  required
                  vazio="Selecione…"
                  className="flex-1"
                  opcoes={candidatos.map((u) => ({ valor: u.id, rotulo: `${u.nome} (${PAPEL[u.papel]})` }))}
                />
                <Button type="submit" variant="outline" size="sm">
                  Adicionar
                </Button>
              </FormularioAcao>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
