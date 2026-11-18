import { randomInt } from "node:crypto";
import { aplicarAssinatura, type EstadoAssinatura, vincularClienteStripe } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import Stripe from "stripe";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Contexto } from "../src/contexto";
import {
  criarObra,
  criarUsuario,
  iniciarAssinatura,
  obterAssinatura,
  receberWebhookStripe,
} from "../src/index";

const digitos = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

async function novoTenant(nome: string): Promise<Contexto & { engenheiroId: string }> {
  const r = await comDono(urlsDeTeste().dono, (db) =>
    criarTenantComAdmin(db, {
      nome,
      cnpj: digitos(14),
      admin: {
        nome: `Admin ${nome}`,
        email: `admin.${digitos(8)}@teste.test`,
        whatsappE164: `+55119${digitos(8)}`,
      },
    }),
  );
  const admin: Contexto = { tenantId: r.tenantId, usuarioId: r.adminUsuarioId, papel: "admin" };
  const eng = await criarUsuario(admin, {
    nome: `Eng. ${nome}`,
    papel: "engenheiro",
    email: `eng.${digitos(8)}@teste.test`,
    whatsapp: `(11) 9${digitos(8)}`,
  });
  return { ...admin, engenheiroId: eng.id };
}

const obraNova = (t: { engenheiroId: string }, n: number) =>
  ({ nome: `Obra ${n}`, engenheiroResponsavelId: t.engenheiroId }) as const;

function estado(customerId: string, o: Partial<EstadoAssinatura> = {}): EstadoAssinatura {
  return {
    customerId,
    subscriptionId: `sub_${digitos(10)}`,
    plano: "canteiro",
    periodicidade: "mensal",
    status: "active",
    fimPeriodo: new Date("2026-12-18T00:00:00Z"),
    cancelaNoFim: false,
    em: new Date(),
    ...o,
  };
}

describe("teto de obras pelo plano", () => {
  it("construtora sem assinatura (piloto) não tem teto", async () => {
    const t = await novoTenant("Piloto");
    for (const n of [1, 2, 3]) await criarObra(t, obraNova(t, n));
    const a = await obterAssinatura(t);
    expect(a).toMatchObject({ plano: "piloto", status: null, limiteObras: null, obrasAtivas: 3 });
  });

  it("Canteiro vai até 2 obras ativas; cancelada não abre obra nova", async () => {
    const t = await novoTenant("Canteiro");
    const cliente = `cus_${digitos(10)}`;
    expect(await vincularClienteStripe(t.tenantId, cliente)).toBe(cliente);
    // segundo vínculo não troca o cliente
    expect(await vincularClienteStripe(t.tenantId, "cus_outro")).toBe(cliente);

    const sub = estado(cliente);
    expect(await aplicarAssinatura(sub)).toBe("aplicada");
    await criarObra(t, obraNova(t, 1));
    await criarObra(t, obraNova(t, 2));
    await expect(criarObra(t, obraNova(t, 3))).rejects.toThrow("O plano Canteiro vai até 2 obras ativas");

    // troca para Construtora (6): abre a terceira
    expect(await aplicarAssinatura({ ...sub, plano: "construtora", em: new Date(Date.now() + 1000) })).toBe(
      "aplicada",
    );
    await criarObra(t, obraNova(t, 3));
    expect(await obterAssinatura(t)).toMatchObject({
      plano: "construtora",
      limiteObras: 6,
      obrasAtivas: 3,
      valendo: true,
    });

    // primeiro pagamento incompleto de outra assinatura não derruba a atual; sozinho, segue como piloto
    expect(await obterAssinatura(t)).toMatchObject({ limiteObras: 6 });

    // cancelada: nenhuma obra nova
    expect(await aplicarAssinatura({ ...sub, status: "canceled", em: new Date(Date.now() + 2000) })).toBe(
      "aplicada",
    );
    await expect(criarObra(t, obraNova(t, 4))).rejects.toThrow("A assinatura não está ativa");
  });

  it("estado antigo e assinatura velha não sobrescrevem a atual", async () => {
    const t = await novoTenant("Ordem");
    const cliente = `cus_${digitos(10)}`;
    await vincularClienteStripe(t.tenantId, cliente);
    const atual = estado(cliente, { plano: "grupo", em: new Date(Date.now() + 5000) });
    expect(await aplicarAssinatura(atual)).toBe("aplicada");
    expect(await aplicarAssinatura({ ...atual, plano: "canteiro", em: new Date() })).toBe("antiga");
    expect(
      await aplicarAssinatura(estado(cliente, { status: "canceled", em: new Date(Date.now() + 9000) })),
    ).toBe("outra_assinatura");
    expect(await aplicarAssinatura(estado("cus_ninguem"))).toBe("cliente_desconhecido");
    expect(await obterAssinatura(t)).toMatchObject({ plano: "grupo", status: "active", limiteObras: 15 });
  });
});

describe("checkout", () => {
  it("só admin assina, e sem chave do Stripe a cobrança fica desligada", async () => {
    const t = await novoTenant("Checkout");
    const eng: Contexto = { tenantId: t.tenantId, usuarioId: t.engenheiroId, papel: "engenheiro" };
    const o = { email: "a@b.test", urls: { sucesso: "http://x/ok", cancelamento: "http://x/volta" } };
    await expect(iniciarAssinatura(eng, { plano: "canteiro" }, null, o)).rejects.toThrow("permissão");
    await expect(iniciarAssinatura(t, { plano: "canteiro" }, null, o)).rejects.toThrow(
      "não está configurada",
    );
  });
});

describe("webhook do Stripe", () => {
  const segredo = "whsec_teste";
  const stripe = new Stripe("sk_test_falso");
  const assinar = (corpo: string) =>
    stripe.webhooks.generateTestHeaderString({ payload: corpo, secret: segredo });

  let t: Contexto & { engenheiroId: string };
  let cliente: string;
  beforeAll(async () => {
    t = await novoTenant("Webhook");
    cliente = `cus_${digitos(10)}`;
    await vincularClienteStripe(t.tenantId, cliente);
  });

  const assinatura = (status: string, chave = "prumo_construtora_anual") =>
    ({
      id: "sub_webhook",
      customer: cliente,
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      items: { data: [{ price: { lookup_key: chave }, current_period_end: 1_800_000_000 }] },
    }) as unknown as Stripe.Subscription;

  const evento = (type: string, object: object) =>
    JSON.stringify({ id: `evt_${digitos(8)}`, object: "event", type, created: 1, data: { object } });

  it("recusa assinatura inválida e funciona desligado sem segredo", async () => {
    const corpo = evento("customer.subscription.updated", { id: "sub_webhook" });
    expect((await receberWebhookStripe(corpo, "t=1,v1=errado", stripe, segredo)).status).toBe(400);
    expect((await receberWebhookStripe(corpo, assinar(corpo), stripe, undefined)).status).toBe(503);
    expect((await receberWebhookStripe(corpo, assinar(corpo), null, segredo)).status).toBe(503);
  });

  it("lê a assinatura de novo no Stripe e grava; repetir é idempotente", async () => {
    const retrieve = vi
      .spyOn(stripe.subscriptions, "retrieve")
      .mockResolvedValue(assinatura("active") as never);
    const corpo = evento("checkout.session.completed", { mode: "subscription", subscription: "sub_webhook" });
    expect(await receberWebhookStripe(corpo, assinar(corpo), stripe, segredo)).toEqual({
      status: 200,
      corpo: "aplicada",
    });
    expect(await receberWebhookStripe(corpo, assinar(corpo), stripe, segredo)).toEqual({
      status: 200,
      corpo: "aplicada",
    });
    expect(retrieve).toHaveBeenCalledWith("sub_webhook");
    expect(await obterAssinatura(t)).toMatchObject({
      plano: "construtora",
      periodicidade: "anual",
      status: "active",
      fimPeriodo: new Date(1_800_000_000 * 1000),
    });

    retrieve.mockResolvedValue(assinatura("past_due") as never);
    const atualizado = evento("customer.subscription.updated", { id: "sub_webhook" });
    await receberWebhookStripe(atualizado, assinar(atualizado), stripe, segredo);
    expect(await obterAssinatura(t)).toMatchObject({ status: "past_due", valendo: true, limiteObras: 6 });

    retrieve.mockResolvedValue(assinatura("active", "preco_qualquer") as never);
    expect((await receberWebhookStripe(atualizado, assinar(atualizado), stripe, segredo)).corpo).toBe(
      "fora_do_catalogo",
    );

    const outro = evento("invoice.created", { id: "in_1" });
    expect(await receberWebhookStripe(outro, assinar(outro), stripe, segredo)).toEqual({
      status: 200,
      corpo: "ignorado",
    });
    retrieve.mockRestore();
  });
});

describe("primeiro pagamento incompleto", () => {
  it("segue como piloto, sem teto", async () => {
    const t = await novoTenant("Incompleto");
    const cliente = `cus_${digitos(10)}`;
    await vincularClienteStripe(t.tenantId, cliente);
    await aplicarAssinatura(estado(cliente, { status: "incomplete" }));
    expect(await obterAssinatura(t)).toMatchObject({
      status: "incomplete",
      valendo: false,
      limiteObras: null,
    });
    for (const n of [1, 2, 3]) await criarObra(t, obraNova(t, n));
  });
});
