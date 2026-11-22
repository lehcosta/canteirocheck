// Compara duas imagens de tela (gabarito × prévia ou exportação do Paper), compartilhado pelas skills
// do Paper. Roda o cálculo numa página do navegador (canvas), sem dependências.
import { readFileSync, writeFileSync } from "node:fs";
import { alturaPar } from "./paper.mjs";

/**
 * Critério de "à risca": nenhum bloco de BLOCO×BLOCO px com mais de LIMITE_BLOCO de pixels divergentes.
 * A % global dilui defeito localizado (um ícone errado some numa tela inteira); o bloco não deixa.
 */
const BLOCO = 32;
const LIMITE_BLOCO = 0.05;
/**
 * Diferença por canal (0–255) a partir da qual um pixel conta como divergente. Um pixel que bate com
 * algum vizinho a 1px de distância não conta: Chrome e Paper arredondam a linha de base do texto
 * de jeitos diferentes, e isso desloca glifos em até 1px.
 */
const TOLERANCIA_PIXEL = 48;

export const CRITERIO = `nenhum bloco ${BLOCO}x${BLOCO} com mais de ${LIMITE_BLOCO * 100}% de pixels divergentes`;

/** % de pixels divergentes entre gabarito e exportação do Paper, e uma imagem com as diferenças em vermelho. */
export async function comparar(ferramentas, gabarito, exportado, destinoDiff) {
  const a = `data:image/png;base64,${readFileSync(gabarito).toString("base64")}`;
  const b = `data:image/png;base64,${readFileSync(exportado).toString("base64")}`;
  const r = await ferramentas.evaluate(
    async ({ a, b, tol, bloco, limiteBloco }) => {
      const carregar = async (s) => {
        const i = new Image();
        i.src = s;
        await i.decode();
        return i;
      };
      const [ia, ib] = await Promise.all([carregar(a), carregar(b)]);
      const w = ia.width;
      const h = ia.height;
      const tela = (img) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        // recorta no tamanho do gabarito, sem redimensionar (a linha a mais da altura par fica de fora)
        ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = tela(ia);
      const db = tela(ib);
      const saida = document.createElement("canvas");
      saida.width = w;
      saida.height = h;
      const sctx = saida.getContext("2d");
      sctx.globalAlpha = 0.25;
      sctx.drawImage(ia, 0, 0);
      sctx.globalAlpha = 1;
      const marca = sctx.getImageData(0, 0, w, h);
      const dist = (i, j) =>
        Math.max(Math.abs(da[i] - db[j]), Math.abs(da[i + 1] - db[j + 1]), Math.abs(da[i + 2] - db[j + 2]));
      let difs = 0;
      const colunas = Math.ceil(w / bloco);
      const porBloco = new Map();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (dist(i, i) <= tol) continue;
          let vizinho = false;
          for (let dy = -1; dy <= 1 && !vizinho; dy++) {
            for (let dx = -1; dx <= 1 && !vizinho; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy >= 0 && yy < h && xx >= 0 && xx < w) vizinho = dist(i, (yy * w + xx) * 4) <= tol;
            }
          }
          if (vizinho) continue;
          difs++;
          const b = Math.floor(y / bloco) * colunas + Math.floor(x / bloco);
          porBloco.set(b, (porBloco.get(b) ?? 0) + 1);
          marca.data.set([230, 0, 0, 255], i);
        }
      }
      const blocos = [...porBloco]
        .filter(([, n]) => n > bloco * bloco * limiteBloco)
        .map(([b]) => ({ x: (b % colunas) * bloco, y: Math.floor(b / colunas) * bloco }));
      sctx.putImageData(marca, 0, 0);
      sctx.strokeStyle = "rgb(230, 0, 0)";
      sctx.lineWidth = 2;
      for (const { x, y } of blocos) sctx.strokeRect(x + 1, y + 1, bloco - 2, bloco - 2);
      return {
        blocos,
        pct: (difs / (w * h)) * 100,
        png: saida.toDataURL("image/png"),
        tamanhos: { gabarito: [ia.width, ia.height], paper: [ib.width, ib.height] },
      };
    },
    { a, b, tol: TOLERANCIA_PIXEL, bloco: BLOCO, limiteBloco: LIMITE_BLOCO },
  );
  writeFileSync(destinoDiff, Buffer.from(r.png.split(",")[1], "base64"));
  // mesma largura; altura igual ou a da prancheta par (ver alturaPar)
  const [lg, ag] = r.tamanhos.gabarito;
  const [lp, ap] = r.tamanhos.paper;
  const mesmoTamanho = lg === lp && (ap === ag || ap === alturaPar(ag));
  return {
    status: r.blocos.length === 0 && mesmoTamanho ? "à risca" : "divergente",
    divergencia: Math.round(r.pct * 100) / 100,
    blocosDivergentes: r.blocos.length,
    // onde olhar primeiro (coordenadas no gabarito)
    primeirosBlocos: r.blocos.slice(0, 12),
    tamanhos: r.tamanhos,
  };
}
