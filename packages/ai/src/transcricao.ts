/**
 * Transcrição de áudio do fallback conversacional (prompt §6.5). Interface própria: o provedor
 * (Whisper/OpenAI hoje) fica trocável. Sem OPENAI_API_KEY, `transcritorPadrao()` devolve null e o
 * áudio fica para revisão humana.
 */
export interface Transcritor {
  readonly nome: string;
  transcrever(audio: Uint8Array, mimeType: string): Promise<{ texto: string; segundos: number | null }>;
}

/** REST da OpenAI (`POST /v1/audio/transcriptions`, multipart). */
export class TranscritorOpenAI implements Transcritor {
  readonly nome: string;

  constructor(
    private readonly chave = process.env.OPENAI_API_KEY ?? "",
    private readonly modelo = process.env.IA_MODELO_TRANSCRICAO || "whisper-1",
  ) {
    this.nome = `openai:${this.modelo}`;
  }

  async transcrever(audio: Uint8Array, mimeType: string) {
    const ext = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mpeg")
        ? "mp3"
        : mimeType.includes("mp4")
          ? "m4a"
          : "wav";
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(audio)], { type: mimeType.split(";")[0] }), `audio.${ext}`);
    form.set("model", this.modelo);
    form.set("language", "pt");
    form.set("response_format", "verbose_json");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.chave}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`transcrição falhou: ${r.status} ${await r.text().catch(() => "")}`);
    const corpo = (await r.json()) as { text?: string; duration?: number };
    return {
      texto: corpo.text?.trim() ?? "",
      segundos: typeof corpo.duration === "number" ? corpo.duration : null,
    };
  }
}

declare global {
  var __canteiroTranscritor: Transcritor | null | undefined;
}

export function transcritorPadrao(): Transcritor | null {
  if (globalThis.__canteiroTranscritor !== undefined) return globalThis.__canteiroTranscritor;
  return process.env.OPENAI_API_KEY ? new TranscritorOpenAI() : null;
}

export function definirTranscritor(t: Transcritor | null | undefined) {
  globalThis.__canteiroTranscritor = t;
}

/** Preço estimado por minuto (USD). Confira a tabela da OpenAI; sobrescreva com IA_PRECO_TRANSCRICAO_MIN. */
export function custoTranscricao(segundos: number | null): string {
  const porMinuto = Number(process.env.IA_PRECO_TRANSCRICAO_MIN ?? "0.006");
  return (((segundos ?? 60) / 60) * porMinuto).toFixed(6);
}
