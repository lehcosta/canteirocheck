/** Log estruturado em JSON (uma linha por evento), pronto para qualquer coletor. */
export function log(nivel: "info" | "warn" | "error", evento: string, dados: Record<string, unknown> = {}) {
  const linha = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...dados });
  if (nivel === "error") console.error(linha);
  else console.log(linha);
}
