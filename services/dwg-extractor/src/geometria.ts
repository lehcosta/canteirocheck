/** Transformação afim 2D: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export interface Transformacao {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Ponto {
  x: number;
  y: number;
}

interface Insercao {
  insertionPoint: Ponto;
  xScale: number;
  yScale: number;
  /** Radianos (valor bruto do DWG). */
  rotation: number;
}

export const IDENTIDADE: Transformacao = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function aplicar(t: Transformacao, p: Ponto): Ponto {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

/** Quanto uma altura de texto (eixo Y local) é ampliada pela transformação. */
export function escalaVertical(t: Transformacao): number {
  return Math.hypot(t.c, t.d);
}

/** Aplica `interna` e depois `externa`. */
export function compor(externa: Transformacao, interna: Transformacao): Transformacao {
  return {
    a: externa.a * interna.a + externa.c * interna.b,
    b: externa.b * interna.a + externa.d * interna.b,
    c: externa.a * interna.c + externa.c * interna.d,
    d: externa.b * interna.c + externa.d * interna.d,
    e: externa.a * interna.e + externa.c * interna.f + externa.e,
    f: externa.b * interna.e + externa.d * interna.f + externa.f,
  };
}

/** Leva coordenadas da definição do bloco para o espaço onde a INSERT está (ignora extrusão/OCS). */
export function transformacaoDaInsercao(insercao: Insercao, base: Ponto): Transformacao {
  const cos = Math.cos(insercao.rotation || 0);
  const sin = Math.sin(insercao.rotation || 0);
  const sx = insercao.xScale || 1;
  const sy = insercao.yScale || 1;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return {
    a,
    b,
    c,
    d,
    e: insercao.insertionPoint.x - (a * base.x + c * base.y),
    f: insercao.insertionPoint.y - (b * base.x + d * base.y),
  };
}
