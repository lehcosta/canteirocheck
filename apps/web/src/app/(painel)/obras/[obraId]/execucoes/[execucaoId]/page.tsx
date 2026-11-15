import { aguardaDecisao, liberacaoExigeJustificativa } from "@canteirocheck/core";
import { listarRelatorios, obterExecucao } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormularioAcao } from "@/components/formulario-acao";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { decidirAction, solicitarPdfAction } from "@/features/execucoes/actions";
import { CANAL, COR_STATUS_EXECUCAO, formatarData, formatarDataHora, STATUS_EXECUCAO } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Execução" };

function Fotos({ midias }: { midias: { id: string; status: string }[] }) {
  if (midias.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {midias.map((m) =>
        m.status === "armazenada" ? (
          <a key={m.id} href={`/api/midias/${m.id}`} target="_blank" rel="noreferrer">
            {/* biome-ignore lint/performance/noImgElement: URL assinada de curta duração, sem otimização do Next */}
            <img
              src={`/api/midias/${m.id}`}
              alt="Foto da medição"
              className="h-24 w-32 rounded border object-cover"
            />
          </a>
        ) : (
          <span key={m.id} className="rounded border px-2 py-1 text-xs text-muted-foreground">
            foto {m.status === "pendente" ? "processando…" : "com falha"}
          </span>
        ),
      )}
    </div>
  );
}

export default async function Execucao({
  params,
}: {
  params: Promise<{ obraId: string; execucaoId: string }>;
}) {
  const { obraId, execucaoId } = await params;
  const s = await exigirSessao();
  const e = await obterExecucao(s.contexto, execucaoId);
  if (!e || e.obraId !== obraId) notFound();
  const relatorios = await listarRelatorios(s.contexto, { obraId, execucaoId });
  const podeDecidir = aguardaDecisao(e.status) && s.usuarioId === e.engenheiroResponsavel.id;
  const exigeJustificativa = liberacaoExigeJustificativa(e.status);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">
          {e.etapaNome} · {e.localNome}
        </h2>
        <Badge variant={COR_STATUS_EXECUCAO[e.status]}>{STATUS_EXECUCAO[e.status]}</Badge>
        <span className="text-sm text-muted-foreground">
          prevista para {formatarData(e.dataPrevista)} · anunciada por {e.anunciadaPor} · responsável{" "}
          {e.engenheiroResponsavel.nome}
        </span>
      </div>

      {podeDecidir && (
        <Card className={e.status === "bloqueada" ? "border-destructive" : ""}>
          <CardHeader>
            <CardTitle>Sua decisão — rodada {e.rodadaAtual}</CardTitle>
            <CardDescription>
              {e.status === "bloqueada"
                ? "Há divergência confirmada. Para liberar assim mesmo, a justificativa é obrigatória."
                : "Todos os pontos dentro da tolerância."}{" "}
              A decisão é registrada e não pode ser editada depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioAcao acao={decidirAction} className="grid gap-3">
              <input type="hidden" name="obraId" value={obraId} />
              <input type="hidden" name="execucaoId" value={e.id} />
              <input type="hidden" name="rodada" value={e.rodadaAtual} />
              <div className="grid gap-1.5">
                <Label htmlFor="justificativa">
                  Justificativa {exigeJustificativa ? "(obrigatória)" : "(obrigatória para recusar)"}
                </Label>
                <textarea
                  id="justificativa"
                  name="justificativa"
                  rows={3}
                  className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
                  placeholder="Ex.: Ajustar forma e reenviar conferência."
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" name="decisao" value="liberada">
                  Liberar
                </Button>
                <Button type="submit" name="decisao" value="recusada" variant="destructive">
                  Recusar
                </Button>
              </div>
            </FormularioAcao>
          </CardContent>
        </Card>
      )}

      {[...e.rodadas].reverse().map((rod) => (
        <Card key={rod.rodada}>
          <CardHeader>
            <CardTitle>
              Rodada {rod.rodada}: {rod.ok} dentro · {rod.divergentes} divergente(s)
              {rod.pendentes ? ` · ${rod.pendentes} sem resposta` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {rod.pontos.map((p) => (
              <div key={p.pontoId} className="border-b pb-3 last:border-0">
                <p className="font-medium">
                  {p.situacao === "ok" ? "✅" : p.situacao === "divergente" ? "❌" : "⏳"} {p.descricao}
                </p>
                <p className="text-sm text-muted-foreground">Esperado: {p.esperado}</p>
                {p.tentativas.map((t) => (
                  <div key={t.verificacaoId} className="mt-1 text-sm">
                    <span className={t.dentro ? "text-emerald-700" : "text-destructive"}>
                      {t.tentativa}ª medida: {t.texto}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {t.usuarioNome} · {formatarDataHora(t.criadoEm)} ·{" "}
                      {CANAL[t.canal as keyof typeof CANAL]}
                      {!t.estruturada && " · não estruturada (revisar)"}
                      {t.observacao && ` · obs.: ${t.observacao}`}
                    </span>
                    <Fotos midias={t.midias} />
                  </div>
                ))}
                {p.divergencia && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTitle>Causa provável: {p.divergencia.causa}</AlertTitle>
                    {p.divergencia.descricao && (
                      <AlertDescription>{p.divergencia.descricao}</AlertDescription>
                    )}
                    <Fotos midias={p.divergencia.midias} />
                  </Alert>
                )}
              </div>
            ))}
            {rod.decisao ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                <strong>{rod.decisao.decisao === "liberada" ? "Liberada" : "Recusada"}</strong> por{" "}
                {rod.decisao.engenheiroNome} em {formatarDataHora(rod.decisao.criadoEm)} (
                {CANAL[rod.decisao.canal as keyof typeof CANAL]})
                {rod.decisao.justificativa && <>: “{rod.decisao.justificativa}”</>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sem decisão nesta rodada.</p>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Relatórios PDF</CardTitle>
          <CardDescription>
            Gerado automaticamente a cada decisão; dá para gerar de novo a qualquer momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {relatorios.length > 0 && (
            <ul className="text-sm">
              {relatorios.map((r) => (
                <li key={r.id}>
                  <a
                    href={`/api/relatorios/${r.id}`}
                    className="hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF de {formatarDataHora(r.criadoEm)}
                  </a>{" "}
                  <span className="text-xs text-muted-foreground">sha256 {r.sha256.slice(0, 12)}…</span>
                </li>
              ))}
            </ul>
          )}
          <FormularioAcao acao={solicitarPdfAction}>
            <input type="hidden" name="obraId" value={obraId} />
            <input type="hidden" name="execucaoId" value={e.id} />
            <Button type="submit" variant="outline" size="sm">
              Gerar PDF agora
            </Button>
          </FormularioAcao>
        </CardContent>
      </Card>
    </>
  );
}
