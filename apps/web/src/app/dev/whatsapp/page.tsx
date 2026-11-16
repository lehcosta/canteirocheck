import { SEED } from "@canteirocheck/db/seed-dados";
import { TEMPLATES } from "@canteirocheck/whatsapp";
import { FLOWS, jsonDoFlow } from "@canteirocheck/whatsapp/flows";
import { lerCaixaSimulada, listarConversasSimuladas } from "@canteirocheck/whatsapp/simulador";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambienteDoSimulador, simuladorLigado } from "@/lib/simulador";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulador de WhatsApp · Prumo" };

const CONTATOS = [
  { tel: SEED.joao.whatsappE164, nome: `${SEED.joao.nome} (encarregado)` },
  { tel: SEED.ana.whatsappE164, nome: `${SEED.ana.nome} (engenheira)` },
  { tel: SEED.admin.whatsappE164, nome: `${SEED.admin.nome}` },
];

export default async function SimuladorWhatsapp({
  searchParams,
}: {
  searchParams: Promise<{ tel?: string }>;
}) {
  if (!simuladorLigado()) notFound();
  const { redis } = ambienteDoSimulador();
  const tel = ((await searchParams).tel ?? SEED.joao.whatsappE164).replace(/[^\d+]/g, "");
  const outras = (await listarConversasSimuladas(redis)).filter(
    (d) => !CONTATOS.some((c) => c.tel.replace(/\D/g, "") === d),
  );
  const itens = await lerCaixaSimulada(redis, tel);
  const flows = Object.fromEntries(Object.values(FLOWS).map((n) => [n, jsonDoFlow(n)])) as never;
  const templates = Object.fromEntries(Object.values(TEMPLATES).map((t) => [t.nome, t.corpo]));

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[240px_1fr]">
      <aside className="grid content-start gap-2">
        <h1 className="text-lg font-semibold">Simulador de WhatsApp</h1>
        <p className="text-xs text-muted-foreground">
          Faz o papel da Meta: chama o webhook e o endpoint do Flow reais, assinados e cifrados. O worker
          precisa estar rodando (<code>pnpm dev</code>).
        </p>
        {[...CONTATOS, ...outras.map((d) => ({ tel: `+${d}`, nome: `+${d}` }))].map((c) => (
          <Link
            key={c.tel}
            href={`/dev/whatsapp?tel=${encodeURIComponent(c.tel)}`}
            className={`rounded px-3 py-2 text-sm ${c.tel.replace(/\D/g, "") === tel.replace(/\D/g, "") ? "bg-green-100 font-medium" : "hover:bg-muted"}`}
          >
            {c.nome}
            <span className="block text-xs text-muted-foreground">{c.tel}</span>
          </Link>
        ))}
        <form action="/dev/whatsapp" className="mt-2 grid gap-1">
          <input name="tel" placeholder="+55 11 9…" className="rounded border px-2 py-1 text-sm" />
          <button type="submit" className="text-left text-xs underline">
            Abrir outro número
          </button>
        </form>
        <Link href="/obras" className="mt-4 text-xs underline">
          Ir para o painel →
        </Link>
      </aside>
      <section className="grid content-start gap-2">
        <h2 className="text-sm text-muted-foreground">Conversa com {tel}</h2>
        <Chat tel={tel} itens={itens} flows={flows} templates={templates} />
      </section>
    </main>
  );
}
