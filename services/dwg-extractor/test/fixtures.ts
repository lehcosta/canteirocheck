import { readFileSync } from "node:fs";

export function lerFixture(nome: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
}
