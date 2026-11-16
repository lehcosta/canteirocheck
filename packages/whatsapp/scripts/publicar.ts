/**
 * Leva os Flows (e a chave pública do endpoint) para a Meta, pela Flows API.
 * Fonte: developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi
 *
 *   pnpm --filter @canteirocheck/whatsapp publicar -- --exportar      grava os 3 Flow JSON em ./flows-json (sem Meta)
 *   pnpm --filter @canteirocheck/whatsapp publicar -- --chave         sobe a chave pública no número
 *   pnpm --filter @canteirocheck/whatsapp publicar                    cria/atualiza os Flows em DRAFT + link de preview
 *   pnpm --filter @canteirocheck/whatsapp publicar -- --publicar      publica os que estão em DRAFT e sem erros
 *   (--seco mostra o plano sem chamar a Meta)
 *
 * Flows criados ficam em DRAFT: dá para testar mandando com WHATSAPP_FLOWS_RASCUNHO=1 (mode "draft")
 * antes de publicar. Flow PUBLICADO não aceita JSON novo pela API: mude o nome (ex.: _v2) em src/flows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLOWS, jsonDoFlow, type NomeFlow } from "../src/flows";
import { chavePublicaPem } from "../src/transporte";
import { carregarChavePrivada } from "../src/transporte/cripto-flow";

const args = new Set(process.argv.slice(2));
const seco = args.has("--seco");

if (args.has("--exportar")) {
  const dir = join(import.meta.dirname, "..", "flows-json");
  mkdirSync(dir, { recursive: true });
  for (const nome of Object.values(FLOWS)) {
    writeFileSync(join(dir, `${nome}.json`), `${JSON.stringify(jsonDoFlow(nome), null, 2)}\n`);
    console.log(`✓ ${join("packages/whatsapp/flows-json", `${nome}.json`)}`);
  }
  console.log(
    "\nCole no Flow Builder da Meta para validar e ver o preview, ou rode sem --exportar para subir pela API.",
  );
  process.exit(0);
}

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome} no .env (ver README › WhatsApp: de simulado para a Meta).`);
    process.exit(1);
  }
  return v;
}

const versao = process.env.WHATSAPP_GRAPH_VERSION || "v27.0";
const token = exigir("WHATSAPP_TOKEN");
const waba = exigir("WHATSAPP_WABA_ID");
const numero = exigir("WHATSAPP_PHONE_NUMBER_ID");
const appId = process.env.WHATSAPP_APP_ID;
const endpoint = `${exigir("APP_URL").replace(/\/$/, "")}/api/whatsapp/flow`;
const graph = `https://graph.facebook.com/${versao}`;

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  if (seco) {
    console.log(`  [seco] ${init.method ?? "GET"} ${caminho}`);
    return {} as T;
  }
  const r = await fetch(`${graph}/${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const corpo = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok)
    throw new Error(
      `${init.method ?? "GET"} ${caminho} → ${r.status}: ${corpo.error?.message ?? JSON.stringify(corpo)}`,
    );
  return corpo;
}

type ErroValidacao = {
  error?: string;
  message?: string;
  line_start?: number;
  pointers?: { path?: string }[];
};

function mostrarErros(nome: string, erros: ErroValidacao[] | undefined) {
  if (seco) return; // sem chamada, sem validação da Meta
  if (!erros?.length) return console.log(`  ✓ ${nome}: Flow JSON válido para a Meta`);
  console.log(`  ✗ ${nome}: ${erros.length} erro(s) de validação`);
  for (const e of erros)
    console.log(
      `    - ${e.error ?? ""} ${e.message ?? ""} (linha ${e.line_start ?? "?"}) ${e.pointers?.map((p) => p.path).join(", ") ?? ""}`,
    );
}

if (args.has("--chave")) {
  const senha = process.env.WHATSAPP_FLOW_PRIVATE_KEY_SENHA;
  const pem = Buffer.from(exigir("WHATSAPP_FLOW_PRIVATE_KEY"), "base64").toString("utf8");
  const publica = chavePublicaPem(carregarChavePrivada(pem, senha));
  await chamar(`${numero}/whatsapp_business_encryption`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ business_public_key: publica }),
  });
  const r = await chamar<{ data?: { business_public_key_signature_status?: string }[] }>(
    `${numero}/whatsapp_business_encryption`,
  );
  console.log(
    `✓ chave pública enviada (assinatura: ${r.data?.[0]?.business_public_key_signature_status ?? "?"})`,
  );
  process.exit(0);
}

if (!endpoint.startsWith("https://")) {
  console.error(
    `O endpoint do Flow precisa ser HTTPS público (APP_URL=${process.env.APP_URL}). Local: cloudflared tunnel --url http://localhost:3000`,
  );
  if (!seco) process.exit(1);
}

type FlowMeta = { id: string; name: string; status: string };
const existentes: FlowMeta[] = [];
let depois: string | undefined;
do {
  const pagina = await chamar<{
    data?: FlowMeta[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>(`${waba}/flows?fields=id,name,status${depois ? `&after=${depois}` : ""}`);
  existentes.push(...(pagina.data ?? []));
  depois = pagina.paging?.next ? pagina.paging.cursors?.after : undefined;
} while (depois);

const idsCriados: Record<string, string> = {};
for (const nome of Object.values(FLOWS) as NomeFlow[]) {
  const json = JSON.stringify(jsonDoFlow(nome));
  const atual = existentes.find((f) => f.name === nome);
  console.log(`\n${nome} — ${atual ? `${atual.status} (${atual.id})` : "novo"}`);

  if (args.has("--publicar")) {
    if (atual?.status !== "DRAFT") {
      console.log(`  — nada a publicar (${atual?.status ?? "não existe"})`);
      continue;
    }
    await chamar(`${atual.id}/publish`, { method: "POST" });
    console.log("  ✓ publicado");
    continue;
  }

  let id = atual?.id;
  if (!atual) {
    const r = await chamar<{ id?: string; validation_errors?: ErroValidacao[] }>(`${waba}/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, categories: ["OTHER"], flow_json: json, endpoint_uri: endpoint }),
    });
    id = r.id;
    mostrarErros(nome, r.validation_errors);
  } else if (atual.status === "DRAFT") {
    const form = new FormData();
    form.set("file", new Blob([json], { type: "application/json" }), "flow.json");
    form.set("name", "flow.json");
    form.set("asset_type", "FLOW_JSON");
    const r = await chamar<{ validation_errors?: ErroValidacao[] }>(`${atual.id}/assets`, {
      method: "POST",
      body: form,
    });
    mostrarErros(nome, r.validation_errors);
  } else {
    console.log(
      `  ! ${atual.status}: a API não aceita JSON novo. Para mudar, crie uma versão com outro nome em src/flows.`,
    );
    continue;
  }
  if (!id) continue;
  idsCriados[nome] = id;
  await chamar(id, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint_uri: endpoint, ...(appId ? { application_id: appId } : {}) }),
  });
  if (!appId)
    console.log("  ! sem WHATSAPP_APP_ID: Flow com endpoint precisa de um app vinculado para publicar");
  const p = await chamar<{ preview?: { preview_url?: string } }>(`${id}?fields=preview.invalidate(false)`);
  if (p.preview?.preview_url) console.log(`  preview: ${p.preview.preview_url}`);
}

if (Object.keys(idsCriados).length) {
  console.log(`\nCole no .env:\nWHATSAPP_FLOW_IDS='${JSON.stringify(idsCriados)}'`);
}
console.log(
  args.has("--publicar")
    ? "\nPronto. Mensagens agora usam os Flows publicados."
    : "\nFlows em DRAFT. Para testar no celular antes de publicar: WHATSAPP_FLOWS_RASCUNHO=1. Depois: --publicar.",
);
