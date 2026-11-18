import { MOMENTOS, type Momento, situacaoDoPrazo } from "@canteirocheck/core";
import { type FaseDoCronograma, obterFase } from "@canteirocheck/servicos";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { dataCompleta, ddmm, plural } from "@/features/checks/textos";
import { agoraDaTela } from "@/lib/agora";
import { exigirSessao } from "@/lib/sessao";
import { SeloRisco } from "../contas";
import { ChecksDaFase } from "./checks";
import { RiscosDaFase } from "./riscos";

export const metadata: Metadata = { title: "Fase do cronograma" };

/** Onde a fase está contra o prazo: "começa em 5 dias", "em andamento desde 23/11", "concluída", "atrasada …". */
function situacao(fase: FaseDoCronograma, hoje: string): string {
  const s = situacaoDoPrazo({ ...fase, marco: false }, hoje);
  if (!s) return "sem data no cronograma";
  if (s.estado === "concluida") return "concluída";
  if (s.estado === "nao_comecou")
    return s.diasParaComecar === 0 ? "começa hoje" : `começa em ${plural(s.diasParaComecar, "dia", "dias")}`;
  const desde = fase.inicio ? `em andamento desde ${ddmm(fase.inicio)}` : "em andamento";
  if (s.estado === "em_dia") return desde;
  return s.diasVencida
    ? `atrasada ${s.diasVencida} d`
    : `${desde}, atrasada ${plural(s.pontosAtras, "ponto", "pontos")}`;
}

export default async function PaginaDaFase({
  params,
  searchParams,
}: {
  params: Promise<{ obraId: string; faseUid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { obraId, faseUid } = await params;
  const busca = await searchParams;
  const { hoje, agora } = agoraDaTela(busca);
  if (!/^\d{1,9}$/.test(faseUid)) notFound();
  const s = await exigirSessao();
  const fase = await obterFase(s.contexto, obraId, Number(faseUid), hoje);
  if (!fase) notFound();

  const agoraDaCena =
    process.env.NODE_ENV !== "production" && typeof busca.agora === "string" ? busca.agora : null;
  const prova = typeof busca.prova === "string" ? busca.prova : null;
  const editar = MOMENTOS.find((m) => m === busca.editar) ?? null;
  // os links da página levam adiante o que está aberto (editor, prova) e o relógio da cena
  const mantidos: Record<string, string> = {
    ...(editar ? { editar } : {}),
    ...(prova ? { prova } : {}),
    ...(agoraDaCena ? { agora: agoraDaCena } : {}),
  };
  /** O endereço desta página com os parâmetros trocados (null tira o parâmetro). */
  const endereco = (troca: Record<string, string | null>) => {
    const p = new URLSearchParams(mantidos);
    for (const [k, v] of Object.entries(troca)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const texto = p.toString();
    return `/obras/${obraId}/cronograma/${fase.uid}${texto ? `?${texto}` : ""}`;
  };

  // quem responde na obra: o do primeiro check que tem alguém, com o papel dele na equipe
  const responsavel = fase.checks.find((k) => k.responsavel)?.responsavel ?? null;
  const papel = responsavel && fase.responsaveis.find((u) => u.id === responsavel.id)?.papel;
  // sem as duas datas, a situação já diz "sem data no cronograma"
  const periodo =
    fase.inicio && fase.termino
      ? `${dataCompleta(fase.inicio)} a ${dataCompleta(fase.termino)}`
      : fase.termino
        ? `até ${dataCompleta(fase.termino)}`
        : fase.inicio
          ? `a partir de ${dataCompleta(fase.inicio)}`
          : null;
  const apoio = [
    fase.etapa,
    periodo,
    situacao(fase, hoje),
    responsavel
      ? `quem responde na obra: ${responsavel.nome}${papel ? `, ${papel}` : ""}`
      : "ninguém escolhido para responder na obra",
  ].filter(Boolean);

  return (
    <>
      <header className="space-y-2.5">
        <Link
          href={`/obras/${obraId}/cronograma`}
          className="flex w-fit items-center gap-1 rounded-sm text-sm leading-5 font-semibold text-prumo-text underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-3.5" strokeWidth={2} strokeLinecap="square" />
          Cronograma
        </Link>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-[22px] leading-7 font-bold">{fase.nome}</h2>
            {fase.nivel && <SeloRisco nivel={fase.nivel} sobreFundo />}
          </div>
          <p className="text-[15px] leading-[22px] text-muted-foreground">{apoio.join(" · ")}</p>
        </div>
      </header>

      {fase.checks.length === 0 ? (
        // sem check nenhum, a obra nunca foi cruzada: nem riscos nem perguntas existem ainda
        <section
          aria-labelledby="titulo-sem-cruzamento"
          className="space-y-1 rounded-md border bg-card px-5 py-8 text-center text-[15px]"
        >
          <h3 id="titulo-sem-cruzamento" className="font-semibold">
            Esta obra ainda não foi cruzada com o projeto.
          </h3>
          <p className="text-muted-foreground">
            Os riscos e as perguntas desta fase aparecem depois do cruzamento.{" "}
            <Link
              href={`/obras/${obraId}/cronograma`}
              className="font-semibold text-prumo-text underline-offset-4 hover:underline"
            >
              Ver o cronograma
            </Link>
          </p>
        </section>
      ) : (
        <>
          <RiscosDaFase fase={fase} obraId={obraId} aberta={prova} endereco={endereco} />

          <section aria-labelledby="titulo-perguntas" className="space-y-3">
            <div className="space-y-1">
              <TituloSecao id="titulo-perguntas">Perguntas de check</TituloSecao>
              <p className="text-[15px] leading-[22px] text-muted-foreground">
                Sugeridas pela IA a partir dos riscos. Nada chega ao WhatsApp
                {responsavel ? ` de ${responsavel.nome}` : " da obra"} antes da sua aprovação.
              </p>
            </div>
            <ChecksDaFase
              fase={fase}
              obraId={obraId}
              editando={editar as Momento | null}
              hoje={hoje}
              agora={agora.toISOString()}
              busca={mantidos}
            />
          </section>
        </>
      )}
    </>
  );
}
