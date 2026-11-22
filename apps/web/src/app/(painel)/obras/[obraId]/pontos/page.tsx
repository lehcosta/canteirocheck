import { listarPontos, obterObra, opcoesEtapas } from "@canteirocheck/servicos";
import { Check, CircleAlert, FileText, LoaderCircle, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { carregarAndamento } from "@/features/obras/andamento";
import { criarPontoAction, revisarPontoAction } from "@/features/pontos/actions";
import { separarEsperado } from "@/features/pontos/esperado";
import { GRANDEZA, TIPO_LOCAL, UNIDADE } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { rotuloDisciplina } from "../projetos/disciplinas";

export const metadata: Metadata = { title: "Pontos de controle" };

const SITUACOES = ["sugerido", "aprovado", "descartado"] as const;
type Situacao = (typeof SITUACOES)[number];
const ROTULO_FILTRO: Record<Situacao, string> = {
  sugerido: "Sugeridos",
  aprovado: "Aprovados",
  descartado: "Descartados",
};
const VAZIO: Record<Situacao, string> = {
  sugerido: "Nenhum ponto aguardando revisão.",
  aprovado: "Nenhum ponto aprovado ainda.",
  descartado: "Nenhum ponto descartado.",
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const SUBLINHA = "block text-[13px] leading-[18px] text-muted-foreground";
const SELO = "inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] uppercase";

export default async function Pontos({
  params,
  searchParams,
}: {
  params: Promise<{ obraId: string }>;
  searchParams: Promise<{ situacao?: string | string[] }>;
}) {
  const { obraId } = await params;
  const { situacao: pedida } = await searchParams;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();
  const [pontos, etapas] = await Promise.all([listarPontos(s.contexto, obraId), opcoesEtapas(s.contexto)]);
  const engenheiro = s.papel === "engenheiro";
  const locais = obra.locais.map((l) => ({ valor: l.id, rotulo: `${TIPO_LOCAL[l.tipo]} ${l.nome}` }));

  const contagem = Object.fromEntries(
    SITUACOES.map((sit) => [sit, pontos.filter((p) => p.statusRevisao === sit).length]),
  ) as Record<Situacao, number>;
  const filtro: Situacao = SITUACOES.includes(pedida as Situacao)
    ? (pedida as Situacao)
    : contagem.sugerido > 0 || contagem.aprovado === 0
      ? "sugerido"
      : "aprovado";
  const lista = pontos.filter((p) => p.statusRevisao === filtro);
  const sugeridosIa = pontos.filter((p) => p.statusRevisao === "sugerido" && p.origem === "ia").length;
  const sugeridosManuais = contagem.sugerido - sugeridosIa;
  // sem nenhum ponto, o vazio diz em que pé está a leitura do DWG mais recente
  const andamento = pontos.length === 0 ? await carregarAndamento(obraId) : null;
  const leitura = andamento?.leitura;
  const temPdf = (andamento?.pdfsDeReferencia ?? 0) > 0;
  const arquivo = leitura && `${leitura.codigo} ${leitura.revisao}`;
  const projetos = `/obras/${obraId}/projetos`;
  const aMao = (rotulo: string) => (
    <a href="#novo-ponto" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>
      {rotulo}
    </a>
  );

  return (
    <>
      {contagem.sugerido > 0 && (
        <section
          aria-label="Pontos aguardando revisão"
          className="flex flex-wrap items-center gap-4 rounded-md bg-foreground px-5 py-5 text-background sm:px-6"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-prumo text-on-prumo"
          >
            <FileText className="size-[22px]" strokeWidth={2} strokeLinecap="square" />
          </span>
          <div className="min-w-0 flex-[1_1_320px] space-y-0.5">
            <p className="text-base leading-6 font-semibold">
              {[
                sugeridosIa > 0 && `A leitura do projeto sugeriu ${plural(sugeridosIa, "ponto", "pontos")}.`,
                sugeridosManuais > 0 &&
                  `${plural(sugeridosManuais, "ponto manual aguarda", "pontos manuais aguardam")} aprovação.`,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p className="text-sm leading-5 text-background/70">
              {engenheiro
                ? "Revise antes de aprovar: só pontos aprovados entram na conferência do encarregado."
                : "Um engenheiro precisa aprovar. Só pontos aprovados entram na conferência do encarregado."}
            </p>
          </div>
        </section>
      )}

      <section aria-labelledby="titulo-pontos" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <TituloSecao id="titulo-pontos">Pontos de controle</TituloSecao>
            <p className="text-[15px] text-muted-foreground">
              O que o encarregado mede em cada etapa. Pontos sugeridos mostram o trecho do projeto de onde
              vieram.
            </p>
          </div>
          <a href="#novo-ponto" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>
            <Plus aria-hidden strokeWidth={2.25} strokeLinecap="square" />
            Novo ponto manual
          </a>
        </div>

        <nav aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
          {SITUACOES.map((sit) => {
            const ativo = sit === filtro;
            return (
              <Link
                key={sit}
                href={`/obras/${obraId}/pontos?situacao=${sit}`}
                scroll={false}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors",
                  ativo
                    ? "border-foreground bg-foreground text-background"
                    : "border-concreto bg-card text-foreground hover:bg-muted",
                )}
              >
                {ROTULO_FILTRO[sit]}
                <span className="font-mono font-medium tabular-nums">{contagem[sit]}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rounded-md border bg-card">
          {pontos.length === 0 ? (
            leitura?.status === "pendente" || leitura?.status === "processando" ? (
              <div className="space-y-4 p-6">
                <p className="flex items-center gap-3 text-base leading-6 font-semibold">
                  <LoaderCircle
                    aria-hidden
                    className="size-[22px] shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  Lendo {arquivo} — {rotuloDisciplina(leitura.disciplina)}…
                </p>
                <p className="text-[15px] text-muted-foreground">
                  Os pontos sugeridos aparecem aqui em alguns minutos. Dá para sair desta tela: a leitura
                  continua.
                </p>
                {aMao("Criar ponto à mão enquanto isso")}
              </div>
            ) : leitura?.status === "falhou" ? (
              <div className="space-y-4 p-6">
                <p className="flex items-center gap-2.5 text-base leading-6 font-semibold text-divergencia">
                  <CircleAlert aria-hidden className="size-4 shrink-0" />
                  Não deu para ler {arquivo}.
                </p>
                <p className="text-[15px] text-muted-foreground">
                  Envie o DWG de novo (outra revisão ou o arquivo salvo de novo) ou crie os pontos à mão.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={projetos} className={buttonVariants()}>
                    Enviar de novo
                  </Link>
                  {aMao("Criar ponto à mão")}
                </div>
              </div>
            ) : leitura?.sugestoes === "gerando" ? (
              <div className="space-y-4 p-6">
                <p className="flex items-center gap-3 text-base leading-6 font-semibold">
                  <LoaderCircle
                    aria-hidden
                    className="size-[22px] shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  Gerando as sugestões de {arquivo}…
                </p>
                <p className="text-[15px] text-muted-foreground">
                  A leitura terminou. Os pontos sugeridos aparecem aqui em um ou dois minutos: atualize a
                  página.
                </p>
                {aMao("Criar ponto à mão enquanto isso")}
              </div>
            ) : leitura?.sugestoes === "nenhuma" ? (
              <div className="space-y-4 p-6">
                <p className="text-base leading-6 font-semibold">
                  A leitura de {arquivo} não achou medidas para sugerir.
                </p>
                <p className="max-w-[72ch] text-[15px] text-muted-foreground">
                  Ponto de controle sai de medida escrita no desenho: nível, cota, altura. Este tem só nomes
                  de ambiente, áreas e notas. Envie um executivo cotado em DWG ou crie os pontos à mão.
                  {temPdf && " O PDF enviado fica guardado para consulta e não é lido."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={projetos} className={buttonVariants()}>
                    Enviar outro DWG
                  </Link>
                  {aMao("Criar ponto à mão")}
                </div>
              </div>
            ) : leitura?.sugestoes === "falhou" ? (
              <div className="space-y-4 p-6">
                <p className="flex items-center gap-2.5 text-base leading-6 font-semibold text-divergencia">
                  <CircleAlert aria-hidden className="size-4 shrink-0" />
                  Não deu para gerar as sugestões de {arquivo}.
                </p>
                <p className="text-[15px] text-muted-foreground">
                  A leitura terminou, mas a geração dos pontos falhou. Leia o projeto de novo na página dele
                  ou crie os pontos à mão.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={projetos} className={buttonVariants()}>
                    Abrir os projetos
                  </Link>
                  {aMao("Criar ponto à mão")}
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-6">
                <p className="text-base leading-6 font-semibold">Nenhum ponto cadastrado.</p>
                <p className="max-w-[72ch] text-[15px] text-muted-foreground">
                  {temPdf && !leitura
                    ? "O PDF enviado fica guardado para consulta, mas não é lido. Para receber sugestões, envie o projeto em DWG, ou crie os pontos à mão. Precisa de pelo menos um aprovado."
                    : "Envie o projeto em DWG para receber sugestões, ou crie os pontos à mão. Precisa de pelo menos um aprovado."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={projetos} className={buttonVariants()}>
                    Enviar o DWG
                  </Link>
                  {aMao("Criar ponto à mão")}
                </div>
              </div>
            )
          ) : lista.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted-foreground">{VAZIO[filtro]}</p>
          ) : (
            <Table
              aria-label={`Pontos de controle: ${ROTULO_FILTRO[filtro].toLowerCase()}`}
              className="min-w-[980px]"
            >
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="px-4">
                    Ponto
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Grandeza
                  </TableHead>
                  <TableHead scope="col" className="px-4 text-right">
                    Esperado
                  </TableHead>
                  <TableHead scope="col" className="px-4 text-right">
                    Tolerância
                  </TableHead>
                  <TableHead scope="col" className="px-4">
                    Origem
                  </TableHead>
                  <TableHead scope="col" className="px-4 text-right">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => {
                  const esp = separarEsperado(p.esperado);
                  const detalhes = [
                    p.ehInterface &&
                      (p.localReferenciaNome ? `Interface com ${p.localReferenciaNome}` : "Interface"),
                    p.exigeFoto && "Exige foto",
                  ].filter(Boolean);
                  return (
                    <TableRow key={p.id} className="hover:bg-transparent">
                      <TableCell className="min-w-[260px] px-4 py-3.5 whitespace-normal">
                        <span className="font-semibold">{p.descricao}</span>
                        <span className={SUBLINHA}>
                          {p.etapaNome} · {p.localNome}
                          {p.regiao && ` · ${p.regiao}`}
                        </span>
                        {detalhes.length > 0 && <span className={SUBLINHA}>{detalhes.join(" · ")}</span>}
                      </TableCell>
                      <TableCell className="px-4 py-3.5">{GRANDEZA[p.grandeza]}</TableCell>
                      <TableCell className="px-4 py-3.5 text-right font-mono tabular-nums">
                        {esp.valor}
                      </TableCell>
                      <TableCell className="px-4 py-3.5 text-right">
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {esp.tolerancia ?? "—"}
                        </span>
                        {!p.toleranciaPropria && p.grandeza !== "existencia" && (
                          <span className={SUBLINHA}>padrão</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px] min-w-[200px] px-4 py-3.5 whitespace-normal">
                        <span className="text-sm">
                          {p.origem === "ia" ? "IA, a partir do projeto" : "Manual"}
                        </span>
                        {p.trechoOrigem && (
                          <span className={cn(SUBLINHA, "line-clamp-2")}>“{p.trechoOrigem}”</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-3">
                          {p.statusRevisao === "aprovado" && (
                            <span className="mr-1 text-right">
                              <span className={cn(SELO, "text-nivel")}>
                                <Check
                                  aria-hidden
                                  strokeWidth={3}
                                  strokeLinecap="square"
                                  className="size-3.5"
                                />
                                Aprovado
                              </span>
                              {p.revisadoPor && <span className={SUBLINHA}>{p.revisadoPor}</span>}
                            </span>
                          )}
                          {p.statusRevisao === "descartado" && (
                            <span className="mr-1 text-right">
                              <span className={cn(SELO, "text-muted-foreground")}>Descartado</span>
                              {p.revisadoPor && <span className={SUBLINHA}>{p.revisadoPor}</span>}
                            </span>
                          )}
                          {!engenheiro && p.statusRevisao === "sugerido" && (
                            <span className="text-sm text-muted-foreground">Aguarda um engenheiro</span>
                          )}
                          {engenheiro && p.statusRevisao !== "descartado" && (
                            <FormularioAcao acao={revisarPontoAction} className="inline-block">
                              <input type="hidden" name="obraId" value={obraId} />
                              <input type="hidden" name="pontoId" value={p.id} />
                              <Button
                                type="submit"
                                name="decisao"
                                value="descartar"
                                variant="outline"
                                className="h-11"
                              >
                                Descartar
                              </Button>
                            </FormularioAcao>
                          )}
                          {engenheiro && p.statusRevisao !== "aprovado" && (
                            <FormularioAcao acao={revisarPontoAction} className="inline-block">
                              <input type="hidden" name="obraId" value={obraId} />
                              <input type="hidden" name="pontoId" value={p.id} />
                              <Button
                                type="submit"
                                name="decisao"
                                value="aprovar"
                                variant="outline"
                                className="h-11 border-nivel text-nivel"
                              >
                                <Check aria-hidden strokeWidth={3} strokeLinecap="square" />
                                Aprovar
                              </Button>
                            </FormularioAcao>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Sem tolerância própria, vale a padrão da construtora (Configurações › Tolerâncias).
        </p>
      </section>

      <section
        id="novo-ponto"
        aria-labelledby="titulo-novo-ponto"
        className="scroll-mt-6 space-y-5 rounded-md border bg-card p-5 sm:p-6"
      >
        <div className="space-y-1">
          <TituloSecao id="titulo-novo-ponto">Novo ponto manual</TituloSecao>
          <p className="text-[15px] text-muted-foreground">
            Valor e tolerâncias na unidade escolhida. Sem tolerância, vale a padrão da construtora.{" "}
            {engenheiro
              ? "Pontos criados por você já entram aprovados."
              : "O ponto aguarda a aprovação de um engenheiro."}
          </p>
        </div>
        <FormularioAcao acao={criarPontoAction} className="grid gap-4 space-y-0 sm:grid-cols-4">
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
          <Campo
            rotulo="Valor esperado"
            nome="valorEsperado"
            inputMode="decimal"
            placeholder="6,000"
            className="[&_input]:font-mono"
          />
          <Campo
            rotulo="Referência de nível"
            nome="referenciaNivel"
            placeholder="RN-01"
            className="[&_input]:font-mono"
          />
          <Campo
            rotulo="Tolerância +"
            nome="toleranciaMais"
            inputMode="decimal"
            placeholder="0,010"
            className="[&_input]:font-mono"
          />
          <Campo
            rotulo="Tolerância −"
            nome="toleranciaMenos"
            inputMode="decimal"
            placeholder="0,010"
            className="[&_input]:font-mono"
          />
          <CampoSelect
            rotulo="Interface com (já executado)"
            nome="localReferenciaId"
            vazio="Não é interface"
            opcoes={locais}
            className="sm:col-span-2"
          />
          <label className="flex min-h-11 items-center gap-3 text-[15px] sm:col-span-2">
            <input type="checkbox" name="ehInterface" className="size-5 shrink-0 accent-foreground" />É
            interface (mede os dois lados)
          </label>
          <label className="flex min-h-11 items-center gap-3 text-[15px] sm:col-span-2">
            <input type="checkbox" name="exigeFoto" className="size-5 shrink-0 accent-foreground" />
            Exige foto
          </label>
          <div className="sm:col-span-4">
            <Button type="submit" size="lg">
              Criar ponto
            </Button>
          </div>
        </FormularioAcao>
      </section>
    </>
  );
}
