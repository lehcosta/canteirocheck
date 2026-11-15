import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "../src/cliente";
import * as schema from "../src/schema";
import { registrarEntradaWhatsapp, variantesWhatsapp } from "../src/sistema";
import { novoTenant } from "./fabrica";

describe("identificação pelo número do WhatsApp", () => {
  it("wa_id brasileiro sem o 9 casa com o cadastro com 9 (e vice-versa)", () => {
    expect(variantesWhatsapp("551198765432")).toEqual(["+551198765432", "+5511998765432"]);
    expect(variantesWhatsapp("5511998765432")).toEqual(["+5511998765432", "+551198765432"]);
    expect(variantesWhatsapp("551132654321")).toEqual(["+551132654321"]); // fixo: não inventa 9
    expect(variantesWhatsapp("14155550123")).toEqual(["+14155550123"]);
  });

  it("registra a entrada no tenant certo, guarda o wa_id e é idempotente por wamid", async () => {
    const t = await novoTenant("Construtora WhatsApp");
    const [admin] = await withTenant(t.tenantId, (tx) =>
      tx.select().from(schema.usuario).where(eq(schema.usuario.id, t.adminUsuarioId)),
    );
    if (!admin) throw new Error("admin não encontrado");
    const semNove = admin.whatsappE164.replace(/^\+55(\d{2})9/, "55$1");
    const wamid = `wamid.${Date.now()}`;

    const r1 = await registrarEntradaWhatsapp({
      waMessageId: wamid,
      waId: semNove,
      tipo: "text",
      payload: {},
    });
    expect(r1).toMatchObject({ tenantId: t.tenantId, usuarioId: admin.id, duplicada: false });
    const r2 = await registrarEntradaWhatsapp({
      waMessageId: wamid,
      waId: semNove,
      tipo: "text",
      payload: {},
    });
    expect(r2).toMatchObject({ mensagemId: r1.mensagemId, duplicada: true });

    const [depois] = await withTenant(t.tenantId, (tx) =>
      tx.select().from(schema.usuario).where(eq(schema.usuario.id, admin.id)),
    );
    expect(depois?.whatsappWaId).toBe(semNove);
  });

  it("número desconhecido grava sem tenant (invisível para o app)", async () => {
    const r = await registrarEntradaWhatsapp({
      waMessageId: `wamid.desconhecido.${Date.now()}`,
      waId: "5599999999999",
      tipo: "text",
      payload: {},
    });
    expect(r).toMatchObject({ tenantId: null, usuarioId: null, duplicada: false });
  });
});
