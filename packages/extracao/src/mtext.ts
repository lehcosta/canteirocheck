/**
 * Limpa os códigos de formatação de MTEXT/TEXT do AutoCAD (prompt §6.1.3) e devolve texto puro.
 *
 *   \P quebra de linha · \~ espaço rígido · {\fArial|b1;…} fonte · \H2.5x; altura · \W0.8; largura
 *   \Q15; inclinação · \T1.2; espaçamento · \C1; cor · \A1; alinhamento · \pxi…; parágrafo
 *   \L \l \O \o \K \k sublinhado/sobrelinha/riscado · \S1/2; fração empilhada · { } agrupamento
 *   %%c Ø · %%d ° · %%p ± · %%u %%o (liga/desliga sublinhado) · %%nnn caractere ASCII
 */
export function limparMtext(bruto: string): string {
  let t = bruto;
  // escapes literais primeiro, para não confundir com códigos
  t = t.replace(/\\\\/g, "\uE000").replace(/\\\{/g, "\uE001").replace(/\\\}/g, "\uE002");
  t = t.replace(/\\S([^;]*?)[#^/]([^;]*?);/g, "$1/$2"); // fração empilhada
  t = t.replace(/\\p[^;]*;/g, ""); // formatação de parágrafo (\pxi…;) antes do \P de quebra
  t = t.replace(/\\P/g, "\n").replace(/\\~/g, " ");
  t = t.replace(/\\[fF][^;]*;/g, ""); // fonte
  t = t.replace(/\\[HhWwQqTtCcAa][^;]*;/g, ""); // altura, largura, inclinação, espaçamento, cor, alinhamento
  t = t.replace(/\\[LlOoKkNn]/g, "");
  t = t.replace(/[{}]/g, "");
  t = t
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[uUoOkK]/g, "");
  t = t.replace(/%%(\d{3})/g, (_, n: string) => String.fromCharCode(Number(n)));
  t = t
    .replace(/\uE000/g, "\\")
    .replace(/\uE001/g, "{")
    .replace(/\uE002/g, "}");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
