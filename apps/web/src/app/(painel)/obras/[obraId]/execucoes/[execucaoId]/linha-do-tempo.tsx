import type { obterExecucao } from "@canteirocheck/servicos";
import { CANAL } from "@/lib/rotulos";
import { dia, hora } from "./medidas";

type Execucao = NonNullable<Awaited<ReturnType<typeof obterExecucao>>>;

interface Evento {
  quando: Date;
  texto: string;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Eventos da execução montados a partir do resumo, do mais antigo para o mais recente. */
function eventos(e: Execucao): Evento[] {
  const variasRodadas = e.rodadas.length > 1;
  const lista: Evento[] = [{ quando: e.criadoEm, texto: `Anunciada por ${e.anunciadaPor}` }];
  for (const r of e.rodadas) {
    const prefixo = variasRodadas ? `Rodada ${r.rodada}: ` : "";
    const tentativas = r.pontos.flatMap((p) => p.tentativas);
    const ultima = tentativas.reduce<Date | null>(
      (max, t) => (!max || t.criadoEm > max ? t.criadoEm : max),
      null,
    );
    if (ultima) {
      const fotos = tentativas.reduce((n, t) => n + t.midias.length, 0);
      const partes = [
        plural(tentativas.length, "medida enviada", "medidas enviadas"),
        fotos ? plural(fotos, "foto", "fotos") : null,
      ].filter(Boolean);
      const fora = r.divergentes
        ? `; ${plural(r.divergentes, "ponto fora", "pontos fora")} da tolerância`
        : "";
      lista.push({ quando: ultima, texto: `${prefixo}${partes.join(" e ")}${fora}` });
    }
    for (const p of r.pontos) {
      if (p.divergencia)
        lista.push({
          quando: p.divergencia.criadoEm,
          texto: `${prefixo}divergência confirmada em ${p.descricao}`,
        });
    }
    if (r.decisao) {
      const verbo = r.decisao.decisao === "liberada" ? "liberou" : "recusou";
      const onde = CANAL[r.decisao.canal as keyof typeof CANAL] ?? r.decisao.canal;
      lista.push({
        quando: r.decisao.criadoEm,
        texto: `${r.decisao.engenheiroNome} ${verbo}${variasRodadas ? ` a rodada ${r.rodada}` : ""} (${onde})`,
      });
    }
  }
  return lista
    .map((ev) => ({ ...ev, texto: ev.texto.charAt(0).toUpperCase() + ev.texto.slice(1) }))
    .sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

/** Linha do tempo agrupada por dia (dd/mm/aaaa), com hora em 24h. */
export function LinhaDoTempoExecucao({
  execucao,
  pendente,
}: {
  execucao: Execucao;
  pendente: string | null;
}) {
  const grupos = new Map<string, Evento[]>();
  for (const ev of eventos(execucao)) {
    const d = dia(ev.quando);
    grupos.set(d, [...(grupos.get(d) ?? []), ev]);
  }
  return (
    <ol className="space-y-5">
      {[...grupos].map(([d, itens]) => (
        <li key={d} className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{d}</p>
          <ol className="space-y-3">
            {itens.map((ev) => (
              <li key={`${ev.quando.getTime()}-${ev.texto}`} className="flex items-baseline gap-3">
                <time
                  dateTime={ev.quando.toISOString()}
                  className="w-12 shrink-0 font-mono text-sm text-muted-foreground tabular-nums"
                >
                  {hora(ev.quando)}
                </time>
                <span className="text-[15px] leading-[22px]">{ev.texto}</span>
              </li>
            ))}
          </ol>
        </li>
      ))}
      {pendente && (
        <li className="flex items-baseline gap-3">
          <span className="w-12 shrink-0 font-mono text-sm text-prumo-text">agora</span>
          <span className="text-[15px] leading-[22px] font-semibold">{pendente}</span>
        </li>
      )}
    </ol>
  );
}
