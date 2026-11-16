import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Cenário da §10 pelo navegador: João no simulador de WhatsApp (anúncio + checklist com
 * divergência na interface L3/L4) e a Eng. Ana decidindo no PAINEL. Rode com o banco recém-semeado.
 */

const JOAO = "/dev/whatsapp?tel=%2B5511900000003";
const FOTO = new URL("./fixtures/forma.jpg", import.meta.url).pathname;
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function foto(page: Page) {
  await page.locator('input[type="file"]').first().setInputFiles(FOTO);
  await expect(page.getByText("1 foto anexada (cifrada)")).toBeVisible();
}

async function tirar(page: Page, nome: string) {
  await page.screenshot({
    path: join(process.env.E2E_SAIDA ?? join(tmpdir(), "canteirocheck-e2e"), "telas", `${nome}.png`),
    fullPage: true,
  });
}

test("João anuncia e confere no simulador; a execução fica bloqueada", async ({ page }) => {
  await page.goto(JOAO, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Limpar conversa" }).click();
  await page.getByPlaceholder("Mensagem").fill("boa tarde");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByRole("button", { name: "Anunciar execução" }).last().click();

  await page.getByRole("button", { name: "▤ Anunciar" }).last().click();
  await page.getByLabel("Concretagem").check();
  await page.getByLabel("L4", { exact: true }).check();
  await tirar(page, "1-anuncio");
  await page.getByRole("button", { name: "Anunciar", exact: true }).click();

  await page.getByRole("button", { name: "Conferir L4" }).last().click();
  await page.getByRole("button", { name: "▤ Conferir agora" }).last().click();
  await page.getByRole("button", { name: "Começar" }).click();

  // interface L3/L4 primeiro: 6,040 ❌ → mede de novo → 6,040 ❌ → causa
  await expect(page.getByText(/Ponto 1 de 3/)).toBeVisible();
  for (const tentativa of [1, 2]) {
    await page.getByLabel("Lado executado").fill("6,000");
    await page.getByLabel("Lado novo").fill("6,040");
    await page.getByLabel("Sim").first().check();
    await foto(page);
    await page.getByRole("button", { name: "Enviar medida" }).click();
    if (tentativa === 1) {
      await expect(page.getByText(/lados desalinhados \(dif\. \+4 cm\)/)).toBeVisible();
      await tirar(page, "2-remedir");
    }
  }
  await expect(page.getByText(/Confirmado na 2ª medida/)).toBeVisible();
  await page.getByLabel("Forma montada fora do nível").check();
  await foto(page);
  await tirar(page, "3-causa");
  await page.getByRole("button", { name: "Registrar e continuar" }).click();

  // espera cada tela nova antes de preencher (a troca de tela limpa o formulário)
  await expect(page.getByText(/Ponto 2 de 3/)).toBeVisible();
  await page.getByLabel("Medida").fill("6,005");
  await page.getByRole("button", { name: "Enviar medida" }).click();
  await expect(page.getByText(/Ponto 3 de 3/)).toBeVisible();
  await expect(page.getByText(/✅ Ponto 2 dentro da tolerância/)).toBeVisible();
  await page.getByLabel("Medida").fill("6,000");
  await page.getByRole("button", { name: "Enviar medida" }).click();
  await expect(page.getByText(/Execução BLOQUEADA/)).toBeVisible();
  await tirar(page, "4-resumo");
  await page.getByRole("button", { name: "Enviar conferência" }).click();
  await expect(page.getByText(/não execute até a decisão/).last()).toBeVisible();
  await tirar(page, "5-joao-depois");
});

test("Eng. Ana entra pelo magic link e recusa no painel; João recebe o aviso", async ({ page, request }) => {
  await request.delete(`${MAILPIT}/api/v1/messages`);
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill("ana@exemplo.test");
  await page.getByRole("button", { name: /link/i }).click();
  let link = "";
  await expect(async () => {
    const lista = await (await request.get(`${MAILPIT}/api/v1/messages`)).json();
    const msg = await (await request.get(`${MAILPIT}/api/v1/message/${lista.messages[0].ID}`)).json();
    link = /http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\S+/.exec(msg.Text)?.[0] ?? "";
    expect(link).not.toBe("");
  }).toPass();
  await page.goto(link);
  await expect(page.getByRole("link", { name: "Edifício Teste" })).toBeVisible();
  await page.getByRole("link", { name: "Edifício Teste" }).click();
  await expect(page.getByText("Aguardando decisão")).toBeVisible();
  await tirar(page, "6-obra");
  await page.getByRole("link", { name: "Concretagem · L4" }).first().click();
  await expect(page.getByText("Causa provável: Forma montada fora do nível")).toBeVisible();
  await tirar(page, "7-execucao");
  await page
    .getByLabel(/Justificativa/)
    .fill("Forma 4 cm acima da borda da L3. Ajustar forma e reenviar conferência.");
  await page.getByRole("button", { name: "Recusar" }).click();
  await expect(page.getByText(/Execução recusada/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Recusada por Eng. Ana/)).toBeVisible();
  await tirar(page, "8-recusada");

  await page.goto(JOAO, { waitUntil: "networkidle" });
  await expect(page.getByText(/RECUSADA por Eng\. Ana/).last()).toBeVisible({ timeout: 20_000 });
  await tirar(page, "9-joao-aviso");
});
