/** Falhas reais vistas no teste com a Meta (15/11/2026): Flow bloqueado e botões cortados. */
import { randomInt } from "node:crypto";
import { schema, withTenant } from "@canteirocheck/db";
import { comDono, criarTenantComAdmin, urlsDeTeste } from "@canteirocheck/db/testing";
import { definirFila, FilaEmMemoria } from "@canteirocheck/queue";
import { type ClienteWhatsapp, ErroGraph } from "@canteirocheck/whatsapp";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emTransacao, enviarMensagemPendente, prepararMensagem } from "../src";
import { tituloBotao } from "../src/whatsapp/entrada";

const fila = new FilaEmMemoria();
definirFila(fila);
const d = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

describe("títulos de botão", () => {
  it("não corta o nome da etapa quando cabe em 20", () => {
    expect(tituloBotao("Concretagem", "L4")).toBe("Concretagem L4");
    expect(tituloBotao("Drywall — fechamento", "Sala 12")).toBe("Drywall — f. Sala 12");
    expect(tituloBotao("Drywall — fechamento", "Sala 12").length).toBeLessThanOrEqual(20);
  });
});

describe("Flow recusado pela Meta (139000)", () => {
  it("marca a falha e avisa a pessoa por texto, em vez de silêncio", async () => {
    const t = await comDono(urlsDeTeste().dono, (db) =>
      criarTenantComAdmin(db, {
        nome: "Construtora Falhas",
        cnpj: d(14),
        admin: { nome: "Adm", email: `a${d(8)}@t.test`, whatsappE164: `+55119${randomInt(6, 10)}${d(7)}` },
      }),
    );
    const id = await emTransacao(t.tenantId, (tx, ef) =>
      prepararMensagem(tx, ef, {
        tenantId: t.tenantId,
        usuarioId: t.adminUsuarioId,
        payload: {
          assunto: "conferência",
          mensagem: { tipo: "template", nome: "x", idioma: "pt_BR", parametros: [] },
        },
      }),
    );
    // vira Flow depois de gravado só para o teste não depender da janela de 24h
    await withTenant(t.tenantId, (tx) =>
      tx
        .update(schema.mensagemWhatsapp)
        .set({
          payload: {
            assunto: "conferência",
            mensagem: { tipo: "flow", texto: "x", flowNome: "f", flowToken: "t", cta: "Abrir" },
          },
        })
        .where(eq(schema.mensagemWhatsapp.id, id)),
    );
    await withTenant(t.tenantId, (tx) =>
      tx.insert(schema.mensagemWhatsapp).values({
        tenantId: t.tenantId,
        usuarioId: t.adminUsuarioId,
        direcao: "entrada",
        waMessageId: `wamid.${d(12)}`,
        tipo: "text",
        payload: {},
      }),
    );
    const cliente: ClienteWhatsapp = {
      modo: "cloud",
      enviar: async () => {
        throw new ErroGraph(400, 139000, { error: { message: "(#139000) Blocked by Integrity" } });
      },
      baixarMidia: async () => ({ dados: new Uint8Array(), mimeType: "" }),
      baixarCdn: async () => new Uint8Array(),
    };
    fila.limpar();
    expect(await enviarMensagemPendente(t.tenantId, id, cliente)).toMatchObject({ tipo: "falhou" });
    const avisos = await withTenant(t.tenantId, (tx) =>
      tx
        .select()
        .from(schema.mensagemWhatsapp)
        .where(
          and(
            eq(schema.mensagemWhatsapp.tipo, "texto"),
            eq(schema.mensagemWhatsapp.statusEntrega, "pendente"),
          ),
        ),
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.payload).toMatchObject({
      mensagem: { texto: expect.stringContaining("Não consegui abrir o formulário") },
    });
    expect(fila.doTipo("enviar_mensagem")).toEqual([{ tenantId: t.tenantId, mensagemId: avisos[0]?.id }]);
  });
});
