import { listarObrasParaAgenda } from "@canteirocheck/db";
import type { FilaBullMQ } from "@canteirocheck/queue";
import { log } from "./log";

const PREFIXO = "anuncio-";

/** "16:00" → cron de segunda a sexta às 16h00 (no fuso da obra, via `tz`). */
export function cronDoAnuncio(horario: string): string {
  const [hh = "16", mm = "00"] = horario.split(":");
  return `${Number(mm)} ${Number(hh)} * * 1-5`;
}

/**
 * Um Job Scheduler por obra ativa (anúncio diário). Idempotente: roda na subida do worker e a
 * cada 10 min, cria/atualiza os agendamentos e remove os de obras que saíram de "ativa".
 */
export async function sincronizarAgendamentos(
  fila: FilaBullMQ,
): Promise<{ ativos: number; removidos: number }> {
  const agenda = fila.fila("agenda");
  const obras = await listarObrasParaAgenda();
  const desejados = new Set<string>();
  for (const o of obras) {
    const id = `${PREFIXO}${o.obraId}`;
    desejados.add(id);
    await agenda.upsertJobScheduler(
      id,
      { pattern: cronDoAnuncio(o.horarioAnuncio), tz: o.fusoHorario },
      { name: "anuncio_diario", data: { tenantId: o.tenantId, obraId: o.obraId } },
    );
  }
  let removidos = 0;
  for (const s of await agenda.getJobSchedulers(0, -1)) {
    const id = s.key;
    if (id.startsWith(PREFIXO) && !desejados.has(id)) {
      await agenda.removeJobScheduler(id);
      removidos++;
    }
  }
  log("info", "agenda.sincronizada", { ativos: obras.length, removidos });
  return { ativos: obras.length, removidos };
}
