import { describe, expect, it } from "vitest";
import { chaveDoTenant, garantirBucket, gravarObjeto, lerObjeto, sha256, urlDeLeitura } from "../src";

const TENANT = "00000000-0000-4000-8000-000000000001";

describe("storage (S3 local)", () => {
  it("grava, lê e serve por URL assinada", async () => {
    await garantirBucket();
    const chave = chaveDoTenant(TENANT, "teste", `${Date.now()}.txt`);
    const dados = new TextEncoder().encode("olá, canteiro");
    const { sha256: hash } = await gravarObjeto(chave, dados, "text/plain");
    expect(hash).toBe(sha256(dados));
    expect(new TextDecoder().decode(await lerObjeto(chave))).toBe("olá, canteiro");

    const r = await fetch(await urlDeLeitura(chave, "a.txt"));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("olá, canteiro");
  });

  it("URL adulterada é recusada", async () => {
    const chave = chaveDoTenant(TENANT, "teste", "x.txt");
    await gravarObjeto(chave, new Uint8Array([1]), "application/octet-stream");
    const url = new URL(await urlDeLeitura(chave));
    url.pathname = url.pathname.replace("x.txt", "y.txt");
    expect((await fetch(url)).status).toBe(403);
  });

  it("chave não escapa do tenant", () => {
    expect(() => chaveDoTenant(TENANT, "..", "x")).toThrow();
    expect(() => chaveDoTenant(TENANT, "a/b")).toThrow();
    expect(chaveDoTenant(TENANT, "obras", "o1", "f.jpg")).toBe(`tenants/${TENANT}/obras/o1/f.jpg`);
  });
});
