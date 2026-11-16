import { formatarComprimento, formatarDiferenca, type Unidade } from "@canteirocheck/core";
import type { obterExecucao } from "@canteirocheck/servicos";
import { Camera, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { separarEsperado } from "@/features/pontos/esperado";
import { CANAL } from "@/lib/rotulos";
import { cn } from "@/lib/utils";

type Execucao = NonNullable<Awaited<ReturnType<typeof obterExecucao>>>;
export type Rodada = Execucao["rodadas"][number];
type Ponto = Rodada["pontos"][number];
type Tentativa = Ponto["tentativas"][number];
type Midia = Tentativa["midias"][number];

const FUSO = "America/Sao_Paulo";
/** 16/11/2026 */
export const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
/** 14:32 */
export const hora = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

const canal = (c: string) => CANAL[c as keyof typeof CANAL] ?? c;

/** Selo de situação em texto (estilo `label` do DS): cor sempre com ✓/✕ e a palavra. */
const SELO = "inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] uppercase";
const ICONE = {
  "aria-hidden": true,
  strokeWidth: 3,
  strokeLinecap: "square",
  className: "size-3.5",
} as const;

function medido(t: Tentativa, unidade: Unidade | null): string {
  if (unidade === "booleano" || t.valorMedido === null) return t.dentro ? "sim" : "não";
  if (unidade) return formatarComprimento(t.valorMedido, unidade);
  return t.texto.split(" (")[0] ?? t.texto;
}

function desvio(t: Tentativa, unidade: Unidade | null): string {
  if (!unidade || unidade === "booleano" || t.diferenca === null) return "—";
  return formatarDiferenca(t.diferenca, unidade);
}

function Situacao({ ponto }: { ponto: Ponto }) {
  if (ponto.situacao === "ok")
    return (
      <span className={cn(SELO, "text-nivel")}>
        <Check {...ICONE} />
        Dentro
      </span>
    );
  if (ponto.situacao === "divergente")
    return (
      <span className={cn(SELO, "text-divergencia")}>
        <X {...ICONE} />
        Fora
      </span>
    );
  return (
    <span className={cn(SELO, ponto.tentativas.length ? "text-prumo-text" : "text-muted-foreground")}>
      {ponto.tentativas.length ? "Pendente" : "Sem medida"}
    </span>
  );
}

/** Uma linha por ponto, com a última medida da rodada; as anteriores ficam como nota embaixo do nome. */
export function TabelaMedidas({ rodada, rotulo }: { rodada: Rodada; rotulo: string }) {
  return (
    <div className="rounded-md border bg-card">
      <Table aria-label={rotulo} className="min-w-[700px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="px-3">
              Ponto
            </TableHead>
            <TableHead scope="col" className="px-3 text-right">
              Esperado
            </TableHead>
            <TableHead scope="col" className="px-3 text-right">
              Medido
            </TableHead>
            <TableHead scope="col" className="px-3 text-right">
              Tolerância
            </TableHead>
            <TableHead scope="col" className="px-3 text-right">
              Desvio
            </TableHead>
            <TableHead scope="col" className="px-3">
              Situação
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rodada.pontos.map((p) => {
            const esp = separarEsperado(p.esperado);
            const ultima = p.tentativas.at(-1);
            const anteriores = p.tentativas.slice(0, -1);
            const fora = ultima ? !ultima.dentro : false;
            return (
              <TableRow key={p.pontoId} className="align-top hover:bg-transparent">
                <TableCell className="min-w-[220px] px-3 py-3.5 whitespace-normal">
                  <span className={cn(p.situacao === "divergente" && "font-semibold")}>{p.descricao}</span>
                  <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">
                    {p.ehInterface && "Interface · "}
                    {ultima
                      ? `${ultima.tentativa}ª medida · ${ultima.usuarioNome} · ${dia(ultima.criadoEm)} ${hora(ultima.criadoEm)} · ${canal(ultima.canal)}`
                      : "Sem medida nesta rodada"}
                  </span>
                  {anteriores.map((t) => (
                    <span
                      key={t.verificacaoId}
                      className="block text-[13px] leading-[18px] text-muted-foreground"
                    >
                      {t.tentativa}ª medida:{" "}
                      <span className="font-mono tabular-nums">{medido(t, esp.unidade)}</span>
                      {t.dentro ? ", dentro" : ", fora"}
                    </span>
                  ))}
                  {ultima?.observacao && (
                    <span className="block text-[13px] leading-[18px] text-muted-foreground">
                      Obs.: {ultima.observacao}
                    </span>
                  )}
                  {ultima && !ultima.estruturada && (
                    <span className="block text-[13px] leading-[18px] font-semibold text-prumo-text">
                      Resposta não estruturada: revise a medida.
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-3.5 text-right font-mono tabular-nums">{esp.valor}</TableCell>
                <TableCell className="px-3 py-3.5 text-right whitespace-normal">
                  <span
                    className={cn("font-mono whitespace-nowrap tabular-nums", fora && "text-divergencia")}
                  >
                    {ultima ? medido(ultima, esp.unidade) : "—"}
                  </span>
                  {ultima && p.ehInterface && ultima.valorReferencia !== null && esp.unidade && (
                    <span className="block text-[13px] leading-[18px] text-muted-foreground">
                      lado executado{" "}
                      <span className="font-mono whitespace-nowrap tabular-nums">
                        {formatarComprimento(ultima.valorReferencia, esp.unidade)}
                      </span>
                    </span>
                  )}
                  {ultima?.mesmaReferenciaNivel === false && (
                    <span className="block text-[13px] leading-[18px] text-divergencia">RN diferente</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-3.5 text-right font-mono text-muted-foreground tabular-nums">
                  {esp.tolerancia ?? "—"}
                </TableCell>
                <TableCell className="px-3 py-3.5 text-right whitespace-normal">
                  <span
                    className={cn("font-mono whitespace-nowrap tabular-nums", fora && "text-divergencia")}
                  >
                    {ultima ? desvio(ultima, esp.unidade) : "—"}
                  </span>
                  {ultima && p.ehInterface && ultima.diferenca !== null && (
                    <span className="block text-[13px] leading-[18px] text-muted-foreground">
                      entre os lados
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-3.5">
                  <Situacao ponto={p} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Foto({
  midia,
  legenda,
  alt,
  className,
}: {
  midia: Midia;
  legenda?: string;
  alt: string;
  className?: string;
}) {
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      {midia.status === "armazenada" ? (
        <a
          href={`/api/midias/${midia.id}`}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border bg-line"
        >
          {/* biome-ignore lint/performance/noImgElement: URL assinada de curta duração, sem otimização do Next */}
          <img src={`/api/midias/${midia.id}`} alt={alt} className="aspect-[4/3] w-full object-cover" />
        </a>
      ) : (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md bg-line text-[13px] text-muted-foreground">
          <Camera aria-hidden className="size-7" strokeWidth={2} />
          {midia.status === "pendente" ? "Foto processando…" : "Foto com falha"}
        </div>
      )}
      {legenda && (
        <figcaption className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
          {legenda}
        </figcaption>
      )}
    </figure>
  );
}

const GRADE_FOTOS = "grid grid-cols-2 gap-4 sm:grid-cols-3";

/** Fotos enviadas junto com as medidas da rodada. */
export function FotosDaRodada({ rodada, tituloId }: { rodada: Rodada; tituloId: string }) {
  const fotos = rodada.pontos.flatMap((p) =>
    p.tentativas.flatMap((t) =>
      t.midias.map((m) => ({
        midia: m,
        legenda: `${p.descricao} · ${t.tentativa}ª medida · ${hora(t.criadoEm)}`,
        alt: `Foto da ${t.tentativa}ª medida: ${p.descricao}`,
      })),
    ),
  );
  if (fotos.length === 0) return null;
  return (
    <section aria-labelledby={tituloId} className="space-y-3">
      <h3 id={tituloId} className="text-lg leading-6 font-semibold">
        Fotos da medição
      </h3>
      <div className={GRADE_FOTOS}>
        {fotos.map((f) => (
          <Foto key={f.midia.id} {...f} />
        ))}
      </div>
    </section>
  );
}

/** Divergências confirmadas pelo encarregado: causa provável, descrição e fotos. */
export function DivergenciasDaRodada({ rodada, tituloId }: { rodada: Rodada; tituloId: string }) {
  const comDivergencia = rodada.pontos.filter((p) => p.divergencia);
  if (comDivergencia.length === 0) return null;
  return (
    <section aria-labelledby={tituloId} className="space-y-3">
      <h3 id={tituloId} className="text-lg leading-6 font-semibold">
        {comDivergencia.length === 1 ? "Divergência confirmada" : "Divergências confirmadas"}
      </h3>
      <ul className="space-y-3">
        {comDivergencia.map((p) =>
          p.divergencia ? (
            <li
              key={p.pontoId}
              className="space-y-3 rounded-md border border-l-4 border-l-divergencia bg-card px-5 py-4"
            >
              <div className="space-y-1">
                <p className="text-[13px] leading-[18px] text-muted-foreground">{p.descricao}</p>
                <p className="flex items-start gap-2 text-base font-semibold text-divergencia">
                  <X {...ICONE} className="mt-1 size-4 shrink-0" />
                  Causa provável: {p.divergencia.causa}
                </p>
                {p.divergencia.descricao && (
                  <p className="text-[15px] whitespace-pre-line">{p.divergencia.descricao}</p>
                )}
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Registrada em {dia(p.divergencia.criadoEm)} às {hora(p.divergencia.criadoEm)}
                </p>
              </div>
              {p.divergencia.midias.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {p.divergencia.midias.map((m, i) => (
                    <Foto
                      key={m.id}
                      midia={m}
                      alt={`Foto ${i + 1} da divergência: ${p.descricao}`}
                      className="w-36"
                    />
                  ))}
                </div>
              )}
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}
