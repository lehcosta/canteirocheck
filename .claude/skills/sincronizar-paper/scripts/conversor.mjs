// Converte a página renderizada em uma árvore de nós no dialeto HTML do Paper.
// Roda DENTRO do navegador via page.evaluate: a função é serializada, então fica autocontida
// (sem imports nem variáveis de fora). Todo valor sai do getComputedStyle e do getBoundingClientRect:
// nada é estimado a partir do código-fonte.
//
// Regras do Paper que moldam a saída: só estilo inline; flex, padding e gap como layout; posição
// absoluta suportada; sem margin, display:inline, grid nem <table>. Por isso:
// - contêiner flex cujos filhos não têm margem vira flex (editável no Paper), com tamanhos explícitos;
// - qualquer outro layout (bloco, grid, tabela, margens) vira posição absoluta, medida no navegador;
// - texto vira nó de texto com as quebras de linha do navegador (white-space: pre), à risca;
// - o que o Paper não desenha (img, canvas, checkbox/select nativos) vira recorte do gabarito.
export function converterPagina({ cores }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const px = (n) => `${r2(n)}px`;

  // ── cores: qualquer sintaxe computada → sRGB → token do Paper quando bate ─────────────
  const gama = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, v * 255));
  };
  const deOklab = (L, a, b) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      gama(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      gama(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      gama(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  };
  const num = (t, escala = 1) =>
    t.endsWith("%") ? (Number.parseFloat(t) / 100) * escala : Number.parseFloat(t);
  function lerCor(valor) {
    if (!valor || valor === "transparent") return null;
    const m = /^(rgba?|oklab|oklch|color)\((.*)\)$/.exec(valor.trim());
    if (!m) return null;
    const [corpo, alfaTxt] = m[2].split("/").map((s) => s.trim());
    const partes = corpo.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    let rgb;
    let alfa = alfaTxt === undefined ? 1 : num(alfaTxt);
    if (m[1] === "rgb" || m[1] === "rgba") {
      rgb = partes.slice(0, 3).map((p) => num(p, 255));
      if (partes[3] !== undefined) alfa = num(partes[3]);
    } else if (m[1] === "oklab") {
      rgb = deOklab(num(partes[0]), num(partes[1], 0.4), num(partes[2], 0.4));
    } else if (m[1] === "oklch") {
      const h = (Number.parseFloat(partes[2]) * Math.PI) / 180;
      const C = num(partes[1], 0.4);
      rgb = deOklab(num(partes[0]), C * Math.cos(h), C * Math.sin(h));
    } else if (partes[0] === "srgb") {
      rgb = partes.slice(1, 4).map((p) => num(p) * 255);
    } else return null;
    if (alfa <= 0) return null;
    return { rgb: rgb.map((c) => Math.round(c)), alfa: r2(alfa) };
  }
  const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  function cor(valor) {
    const c = lerCor(valor);
    if (!c) return null;
    const token = cores.find((t) => t.rgb.every((v, i) => Math.abs(v - c.rgb[i]) <= 1))?.nome;
    if (c.alfa === 1) return token ? `var(${token})` : hex(c.rgb);
    if (token) return `color-mix(var(${token}) ${r2(c.alfa * 100)}%, transparent)`;
    return `rgba(${c.rgb.join(", ")}, ${c.alfa})`;
  }

  // ── visibilidade e classificação ─────────────────────────────────────────────────────
  const IGNORAR = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "NEXTJS-PORTAL"]);
  const RECORTE = new Set(["IMG", "CANVAS", "VIDEO", "IFRAME", "PICTURE", "OBJECT", "EMBED", "SELECT"]);
  const CAMPO_TEXTO = new Set(["text", "email", "password", "search", "tel", "url", "number", ""]);
  const recortes = [];

  function visivel(el, cs) {
    if (IGNORAR.has(el.tagName) || el.tagName.includes("-")) return false; // elementos customizados (overlay do Next)
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (Number.parseFloat(cs.opacity) === 0) return false;
    if (cs.clipPath?.startsWith("inset(50%")) return false;
    const r = el.getBoundingClientRect();
    if ((cs.position === "absolute" || cs.position === "fixed") && r.width <= 1 && r.height <= 1)
      return false; // sr-only
    return true;
  }
  const ehRecorte = (el) => RECORTE.has(el.tagName) || (el.tagName === "INPUT" && !CAMPO_TEXTO.has(el.type));
  const ehCampo = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && CAMPO_TEXTO.has(el.type));

  const largBorda = (cs, lado) =>
    cs[`border${lado}Style`] === "none" ? 0 : Number.parseFloat(cs[`border${lado}Width`]);
  const LADOS = ["Top", "Right", "Bottom", "Left"];
  const temMargem = (cs) => LADOS.some((l) => Number.parseFloat(cs[`margin${l}`]) !== 0);
  const temPadding = (cs) => LADOS.some((l) => Number.parseFloat(cs[`padding${l}`]) !== 0);
  const temBorda = (cs) => LADOS.some((l) => largBorda(cs, l) > 0);
  const temFundo = (cs) => lerCor(cs.backgroundColor) !== null || cs.backgroundImage !== "none";
  const decorado = (cs) =>
    temFundo(cs) ||
    temBorda(cs) ||
    temPadding(cs) ||
    cs.boxShadow !== "none" ||
    Number.parseFloat(cs.opacity) < 1;

  /** Elemento inline que só carrega texto (strong, a, span, code sem fundo...): vira span dentro do texto. */
  function inlineSoTexto(el) {
    const cs = getComputedStyle(el);
    if (el.tagName === "BR") return true;
    if (cs.display !== "inline" || el.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
    if (ehRecorte(el) || ehCampo(el) || decorado(cs) || temMargem(cs)) return false;
    for (const f of el.children) {
      if (visivel(f, getComputedStyle(f)) && !inlineSoTexto(f)) return false;
    }
    return true;
  }

  /** Filhos de um elemento em ordem, agrupando texto corrido (nós de texto + inlines só-texto) num item só. */
  function itensDe(el) {
    const itens = [];
    let grupo = [];
    const fecharGrupo = () => {
      if (grupo.some((n) => (n.nodeType === Node.TEXT_NODE ? n.data.trim() : n.textContent.trim()))) {
        itens.push({ tipo: "texto", nos: grupo });
      }
      grupo = [];
    };
    const visitar = (pai) => {
      for (const n of pai.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          grupo.push(n);
          continue;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const cs = getComputedStyle(n);
        if (cs.display === "contents") {
          visitar(n);
          continue;
        }
        if (!visivel(n, cs)) continue;
        if (inlineSoTexto(n)) {
          grupo.push(n);
          continue;
        }
        fecharGrupo();
        itens.push({ tipo: "el", el: n });
      }
    };
    visitar(el);
    fecharGrupo();
    return itens;
  }

  // ── texto ────────────────────────────────────────────────────────────────────────────
  const familia = (cs) =>
    cs.fontFamily
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
  function estiloTexto(cs) {
    const e = {
      "font-family": familia(cs),
      "font-size": cs.fontSize,
      "font-weight": cs.fontWeight,
      color: cor(cs.color) ?? "transparent",
    };
    if (cs.fontStyle !== "normal") e["font-style"] = cs.fontStyle;
    if (cs.letterSpacing !== "normal" && Number.parseFloat(cs.letterSpacing) !== 0)
      e["letter-spacing"] = cs.letterSpacing;
    if (cs.textTransform !== "none") e["text-transform"] = cs.textTransform;
    if (cs.textDecorationLine !== "none") e["text-decoration"] = cs.textDecorationLine;
    return e;
  }
  const css = (obj) =>
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const alturaLinha = (cs, fallback) =>
    cs.lineHeight === "normal" ? fallback : Number.parseFloat(cs.lineHeight);

  /**
   * Monta o conteúdo de um nó de texto a partir dos nós do grupo, com as quebras de linha
   * exatamente onde o navegador quebrou (mede cada palavra) e spans para trechos com estilo próprio.
   */
  function montarTexto(nos, csBase) {
    const base = estiloTexto(csBase);
    const pre = /^pre/.test(csBase.whiteSpace) || csBase.whiteSpace === "break-spaces";
    const trechos = []; // { texto, estilo }
    const range = document.createRange();
    let fundoLinha = null; // base da linha atual; uma palavra cujo centro passa dela abre linha nova
    // estilo do trecho onde apareceu o espaço pendente (null: nenhum). O CSS junta os espaços seguidos
    // e fica com o primeiro, então o espaço sai no estilo de onde apareceu, não da palavra seguinte.
    let espaco = null;
    let linhas = 1;
    const empurrar = (texto, estilo) => {
      const ult = trechos.at(-1);
      if (ult && ult.estilo === estilo) ult.texto += texto;
      else trechos.push({ texto, estilo });
    };
    const quebrar = (estilo) => {
      empurrar("\n", estilo);
      linhas++;
      fundoLinha = null;
      espaco = null;
    };
    const andar = (n, estilo) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === "BR") return quebrar(estilo);
        const csN = getComputedStyle(n);
        if (csN.display === "none") return;
        const dif = Object.fromEntries(Object.entries(estiloTexto(csN)).filter(([k, v]) => base[k] !== v));
        for (const f of n.childNodes) andar(f, Object.keys(dif).length ? css(dif) : "");
        return;
      }
      if (n.nodeType !== Node.TEXT_NODE) return;
      const dados = n.data;
      const re = pre ? /[^\n]+|\n/g : /\S+/g;
      let fim = 0;
      for (let m = re.exec(dados); m; m = re.exec(dados)) {
        if (!pre && /\s/.test(dados.slice(fim, m.index))) espaco ??= estilo;
        fim = m.index + m[0].length;
        if (m[0] === "\n") {
          quebrar(estilo);
          continue;
        }
        range.setStart(n, m.index);
        range.setEnd(n, fim);
        const caixas = [...range.getClientRects()].filter((c) => c.width > 0);
        if (!caixas.length) continue;
        // palavra que o navegador partiu em duas linhas (overflow-wrap): mede letra a letra
        const pedacos =
          caixas.length === 1
            ? [{ texto: m[0], caixa: caixas[0] }]
            : [...m[0]].map((letra, k) => {
                range.setStart(n, m.index + k);
                range.setEnd(n, m.index + k + 1);
                return { texto: letra, caixa: range.getClientRects()[0] };
              });
        for (const [k, { texto, caixa }] of pedacos.entries()) {
          if (!caixa) {
            empurrar(texto, estilo);
            continue;
          }
          const centro = (caixa.top + caixa.bottom) / 2;
          if (fundoLinha !== null && centro > fundoLinha) {
            quebrar(estilo);
          } else if (k === 0 && espaco !== null && trechos.length && fundoLinha !== null) {
            empurrar(" ", espaco);
          }
          espaco = null;
          fundoLinha = Math.max(fundoLinha ?? -Infinity, caixa.bottom);
          empurrar(texto, estilo);
        }
      }
      if (!pre && /\s/.test(dados.slice(fim))) espaco ??= estilo;
    };
    for (const n of nos) andar(n, "");
    while (trechos.length && trechos.at(-1).texto.endsWith("\n")) {
      trechos.at(-1).texto = trechos.at(-1).texto.slice(0, -1);
      linhas--;
    }
    const htmlDe = (ts) =>
      ts
        .map(({ texto, estilo }) => (estilo ? `<span style="${estilo}">${esc(texto)}</span>` : esc(texto)))
        .join("");
    const porLinha = [[]];
    for (const { texto, estilo } of trechos) {
      for (const [k, parte] of texto.split("\n").entries()) {
        if (k > 0) porLinha.push([]);
        if (parte) porLinha.at(-1).push({ texto: parte, estilo });
      }
    }
    return { html: htmlDe(trechos), porLinha: porLinha.map(htmlDe), base, linhas };
  }

  /** Texto como o navegador mostra com text-overflow: ellipsis (o DOM guarda o texto inteiro). */
  function truncar(el, cs) {
    const regua = document.createElement("canvas").getContext("2d");
    regua.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    regua.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
    const texto = el.textContent.replace(/\s+/g, " ").trim();
    const visto = (t) => (cs.textTransform === "uppercase" ? t.toUpperCase() : t);
    let n = texto.length;
    while (n > 0 && regua.measureText(visto(`${texto.slice(0, n)}…`)).width > el.clientWidth) n--;
    return `${texto.slice(0, n)}…`;
  }

  /** Retângulo de um grupo de texto e a altura de uma linha de conteúdo (sem o entrelinha). */
  function medirGrupo(nos) {
    const range = document.createRange();
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      alturaConteudo = 0;
    for (const n of nos) {
      range.selectNodeContents(n);
      for (const c of range.getClientRects()) {
        if (c.width === 0 && c.height === 0) continue;
        x0 = Math.min(x0, c.left);
        y0 = Math.min(y0, c.top);
        x1 = Math.max(x1, c.right);
        y1 = Math.max(y1, c.bottom);
        alturaConteudo = Math.max(alturaConteudo, c.height);
      }
    }
    if (x0 === Infinity) return null;
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0, alturaConteudo };
  }

  // ── caixa e posição ─────────────────────────────────────────────────────────────────
  /** Larguras de borda separadas em visíveis (vão para o Paper) e transparentes (viram padding/deslocamento). */
  function bordasDe(cs) {
    const visivel = {};
    const invisivel = {};
    for (const l of LADOS) {
      const w = largBorda(cs, l);
      const ve = w > 0 && lerCor(cs[`border${l}Color`]) !== null;
      visivel[l] = ve ? w : 0;
      invisivel[l] = ve ? 0 : w;
    }
    return { visivel, invisivel };
  }

  function estiloCaixa(cs) {
    const e = {};
    const fundo = cor(cs.backgroundColor);
    if (fundo) e["background-color"] = fundo;
    if (cs.backgroundImage !== "none" && !cs.backgroundImage.includes("url("))
      e["background-image"] = cs.backgroundImage;
    // borda transparente não desenha nada: sai daqui e vira deslocamento (ver bordasDe)
    const bordas = LADOS.map((l) => ({
      l,
      w: bordasDe(cs).visivel[l],
      s: cs[`border${l}Style`],
      c: cor(cs[`border${l}Color`]),
    }));
    if (bordas.every((b) => b.w === bordas[0].w && b.s === bordas[0].s && b.c === bordas[0].c)) {
      if (bordas[0].w > 0) e.border = `${px(bordas[0].w)} ${bordas[0].s} ${bordas[0].c}`;
    } else {
      for (const b of bordas) if (b.w > 0) e[`border-${b.l.toLowerCase()}`] = `${px(b.w)} ${b.s} ${b.c}`;
    }
    const cantos = [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ];
    if (cantos.some((c) => Number.parseFloat(c) > 0)) {
      e["border-radius"] = cantos.every((c) => c === cantos[0]) ? cantos[0] : cantos.join(" ");
    }
    if (cs.boxShadow !== "none") e["box-shadow"] = cs.boxShadow;
    if (Number.parseFloat(cs.opacity) < 1) e.opacity = cs.opacity;
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") e.overflow = "hidden";
    return e;
  }

  /** Nome da camada no Paper: o que o código chama de componente/landmark. */
  function nomeCamada(el) {
    const slot = el.getAttribute("data-slot");
    if (slot) return slot;
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").slice(0, 50);
    const marcos = {
      HEADER: "header",
      NAV: "nav",
      MAIN: "main",
      ASIDE: "aside",
      FOOTER: "footer",
      SECTION: "section",
      FORM: "form",
      BUTTON: "botão",
      A: "link",
      TABLE: "tabela",
      TR: "linha",
      LABEL: "rótulo",
    };
    if (el.id) return `#${el.id}`;
    return marcos[el.tagName];
  }

  /** Posição do item: no fluxo do flex do pai, ou absoluta relativa à caixa de padding do pai. */
  function posicao(rect, ctx, csEl) {
    const fora = csEl && (csEl.position === "absolute" || csEl.position === "fixed");
    if (ctx.modo === "flex" && !fora) {
      const e = { "flex-shrink": "0" };
      if (csEl && csEl.alignSelf !== "auto" && csEl.alignSelf !== "normal") e["align-self"] = csEl.alignSelf;
      return e;
    }
    return { position: "absolute", left: px(rect.left - ctx.x), top: px(rect.top - ctx.y) };
  }
  /** Caixa em fluxo também ancora os filhos absolutos (no Paper, como no CSS, vale o ancestral posicionado). */
  const ancorar = (e) => (e.position ? e : { ...e, position: "relative" });

  // ── conversão ───────────────────────────────────────────────────────────────────────
  function noTexto(nos, csBase, rect, ctx, opcoes = {}) {
    const { html, porLinha, base, linhas } = montarTexto(nos, csBase);
    if (!html.trim()) return null;
    const medida = opcoes.medida ?? medirGrupo(nos);
    const lh = alturaLinha(csBase, medida?.alturaConteudo ?? Number.parseFloat(csBase.fontSize) * 1.2);
    let caixa = rect;
    if (!caixa) {
      // o Range mede a área do glifo; o Paper posiciona pela caixa da linha (inclui o meio-entrelinha)
      const meio = (lh - medida.alturaConteudo) / 2;
      caixa = { left: medida.left, top: medida.top - meio, width: medida.width, height: linhas * lh };
    }
    const estilo = {
      ...posicao(caixa, ctx, opcoes.csPosicao),
      width: px(caixa.width),
      height: px(caixa.height),
      ...base,
      "line-height": px(lh),
      "white-space": "pre",
    };
    if (csBase.textAlign === "center" || csBase.textAlign === "right" || csBase.textAlign === "end") {
      estilo["text-align"] = csBase.textAlign === "end" ? "right" : csBase.textAlign;
    }
    // entrelinha fracionária em várias linhas (44px × 1,05 = 46,2px): o Paper empilha as linhas diferente do
    // Chrome, até 2px já na segunda. Cada linha vira um texto próprio, no topo em que o Chrome a pôs.
    if (linhas > 1 && Math.abs(lh - Math.round(lh)) > 0.01) {
      const { width, height, ...texto } = estilo;
      const caixaDoTexto = Object.fromEntries(
        Object.entries(texto).filter(
          ([k]) => !["position", "left", "top", "flex-shrink", "align-self"].includes(k),
        ),
      );
      const filhos = porLinha.flatMap((h, i) =>
        h.trim()
          ? [
              {
                tag: "div",
                estilo: {
                  position: "absolute",
                  left: "0px",
                  top: px(i * lh),
                  width,
                  height: px(lh),
                  ...caixaDoTexto,
                },
                html: h,
              },
            ]
          : [],
      );
      return {
        tag: "div",
        estilo: ancorar({ ...posicao(caixa, ctx, opcoes.csPosicao), width, height }),
        filhos,
      };
    }
    return { tag: "div", estilo, html };
  }

  function noSvg(el, rect, ctx, cs) {
    const clone = el.cloneNode(true);
    const orig = [el, ...el.querySelectorAll("*")];
    const copias = [clone, ...clone.querySelectorAll("*")];
    orig.forEach((o, i) => {
      const c = copias[i];
      const s = getComputedStyle(o);
      // contêineres (svg, g...) não pintam: a cor herdada vai explícita em cada forma
      const pinta = !["svg", "g", "defs", "symbol", "clipPath", "mask", "marker", "pattern"].includes(
        o.tagName,
      );
      for (const [attr, prop] of [
        ["fill", "fill"],
        ["stroke", "stroke"],
      ]) {
        if (!pinta) {
          c.removeAttribute(attr);
          continue;
        }
        const v = s[prop];
        if (v === "none") c.setAttribute(attr, "none");
        else if (v?.startsWith("url(")) continue;
        else if (v) c.setAttribute(attr, cor(v) ?? "none");
      }
      for (const [attr, prop] of [
        ["stroke-width", "strokeWidth"],
        ["stroke-linecap", "strokeLinecap"],
        ["stroke-linejoin", "strokeLinejoin"],
        ["fill-opacity", "fillOpacity"],
        ["stroke-opacity", "strokeOpacity"],
        ["opacity", "opacity"],
      ]) {
        if (s[prop] && s[prop] !== "1" && s[prop] !== "normal") c.setAttribute(attr, s[prop]);
      }
      if (o.style?.transform) c.setAttribute("transform", o.style.transform);
      c.removeAttribute("class");
      c.removeAttribute("style");
      if (s.display === "none" || s.visibility === "hidden") c.setAttribute("display", "none");
    });
    clone.setAttribute("width", r2(rect.width));
    clone.setAttribute("height", r2(rect.height));
    const estilo = { ...posicao(rect, ctx, cs), width: px(rect.width), height: px(rect.height) };
    const nome = nomeCamada(el);
    return { tag: "svg", estilo, bruto: clone.outerHTML, nome };
  }

  function noRecorte(el, rectOriginal, ctx, cs) {
    // recorte na grade de pixels do gabarito: fração de pixel no recorte borra a imagem
    const x0 = Math.floor(rectOriginal.left);
    const y0 = Math.floor(rectOriginal.top);
    const rect = {
      left: x0,
      top: y0,
      width: Math.ceil(rectOriginal.right) - x0,
      height: Math.ceil(rectOriginal.bottom) - y0,
    };
    const n = recortes.length;
    recortes.push({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height,
    });
    const estilo = { ...posicao(rect, ctx, cs), width: px(rect.width), height: px(rect.height) };
    if (Number.parseFloat(cs.borderTopLeftRadius) > 0) estilo["border-radius"] = cs.borderTopLeftRadius;
    return {
      tag: "img",
      estilo,
      src: `__RECORTE_${n}__`,
      nome: el.getAttribute("alt") || el.tagName.toLowerCase(),
    };
  }

  function noCampo(el, rect, ctx, cs) {
    const valor = el.value;
    const csTexto = valor ? cs : getComputedStyle(el, "::placeholder");
    const texto = valor || el.placeholder || "";
    const estilo = {
      ...posicao(rect, ctx, cs),
      width: px(rect.width),
      height: px(rect.height),
      ...estiloCaixa(cs),
      display: "flex",
      "flex-direction": "row",
      "align-items": el.tagName === "TEXTAREA" ? "flex-start" : "center",
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    };
    const filhos = [];
    if (texto) {
      const base = { ...estiloTexto(cs), color: cor(csTexto.color) ?? "transparent" };
      const lh = alturaLinha(cs, Number.parseFloat(cs.fontSize) * 1.2);
      filhos.push({
        tag: "div",
        estilo: { "flex-shrink": "0", ...base, "line-height": px(lh), "white-space": "pre" },
        html: esc(texto),
      });
    }
    return { tag: "div", estilo, filhos, nome: el.name || el.type || "campo" };
  }

  function noElemento(el, ctx) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (el.namespaceURI === "http://www.w3.org/2000/svg")
      return el.tagName === "svg" ? noSvg(el, rect, ctx, cs) : null;
    if (ehRecorte(el)) return noRecorte(el, rect, ctx, cs);
    if (ehCampo(el)) return noCampo(el, rect, ctx, cs);

    const itens = itensDe(el);
    const { visivel, invisivel } = bordasDe(cs);

    // elemento sem caixa própria que só contém texto: vira o próprio nó de texto.
    // Célula de tabela fica de fora: ela centra o texto na altura da linha, então a caixa dela não é a do texto.
    if (
      !decorado(cs) &&
      itens.length === 1 &&
      itens[0].tipo === "texto" &&
      !/flex|grid|table-cell/.test(cs.display)
    ) {
      const no = noTexto(itens[0].nos, cs, rect, ctx, { csPosicao: cs });
      if (no?.html !== undefined && cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth)
        no.html = esc(truncar(el, cs));
      return no;
    }

    const elementos = itens.filter((i) => i.tipo === "el").map((i) => i.el);
    const flex =
      /flex/.test(cs.display) &&
      elementos.every((f) => {
        const cf = getComputedStyle(f);
        const deslocado =
          cf.position === "sticky" ||
          (cf.position === "relative" &&
            ["top", "left", "bottom", "right"].some((l) => !["auto", "0px"].includes(cf[l])));
        return !temMargem(cf) && cf.order === "0" && cf.transform === "none" && !deslocado;
      });

    const caixa = estiloCaixa(cs);
    // bg-clip-padding com borda transparente (botões do shadcn): o fundo cobre só a caixa de padding.
    // O Paper não tem background-clip, então a borda vira um frame externo e o fundo fica no interno.
    const embrulhar =
      cs.backgroundClip !== "border-box" && caixa["background-color"] && LADOS.some((l) => invisivel[l] > 0);
    const folga = embrulhar ? invisivel : { Top: 0, Right: 0, Bottom: 0, Left: 0 };
    const largura = rect.width - folga.Left - folga.Right;
    const altura = rect.height - folga.Top - folga.Bottom;
    const estilo = { width: px(largura), height: px(altura), ...caixa };
    if (embrulhar && estilo["border-radius"]) {
      estilo["border-radius"] = px(Math.max(0, Number.parseFloat(cs.borderTopLeftRadius) - folga.Top));
    }

    const ctxFilhos = {
      modo: flex ? "flex" : "abs",
      x: rect.left + folga.Left + visivel.Left,
      y: rect.top + folga.Top + visivel.Top,
    };
    const pad = (l) => px(Number.parseFloat(cs[`padding${l}`]) + invisivel[l] - folga[l]);
    if (flex) {
      Object.assign(estilo, {
        display: "flex",
        "flex-direction": cs.flexDirection,
        "flex-wrap": cs.flexWrap === "nowrap" ? undefined : cs.flexWrap,
        "justify-content": cs.justifyContent === "normal" ? undefined : cs.justifyContent,
        "align-items": cs.alignItems === "normal" ? "stretch" : cs.alignItems,
        "align-content":
          cs.flexWrap !== "nowrap" && cs.alignContent !== "normal" ? cs.alignContent : undefined,
        "row-gap": cs.rowGap === "normal" || cs.rowGap === "0px" ? undefined : cs.rowGap,
        "column-gap": cs.columnGap === "normal" || cs.columnGap === "0px" ? undefined : cs.columnGap,
        padding: LADOS.some((l) => pad(l) !== "0px") ? LADOS.map(pad).join(" ") : undefined,
      });
    }

    const filhos = [];
    for (const item of itens) {
      const no = item.tipo === "el" ? noElemento(item.el, ctxFilhos) : noTexto(item.nos, cs, null, ctxFilhos);
      if (no) filhos.push(no);
    }
    if (!filhos.length && !decorado(cs)) return null;
    if (!embrulhar)
      return {
        tag: "div",
        estilo: ancorar({ ...posicao(rect, ctx, cs), ...estilo }),
        filhos,
        nome: nomeCamada(el),
      };

    const externo = {
      ...posicao(rect, ctx, cs),
      width: px(rect.width),
      height: px(rect.height),
      display: "flex",
    };
    externo.padding = LADOS.map((l) => px(folga[l])).join(" ");
    for (const k of ["box-shadow", "opacity"]) {
      if (estilo[k]) {
        externo[k] = estilo[k];
        delete estilo[k];
      }
    }
    if (caixa["border-radius"]) externo["border-radius"] = caixa["border-radius"];
    const interno = {
      tag: "div",
      estilo: { "flex-shrink": "0", position: "relative", ...estilo },
      filhos,
      nome: "fundo",
    };
    return { tag: "div", estilo: ancorar(externo), filhos: [interno], nome: nomeCamada(el) };
  }

  const body = document.body;
  const csBody = getComputedStyle(body);
  const csHtml = getComputedStyle(document.documentElement);
  const largura = document.documentElement.clientWidth;
  const altura = document.documentElement.scrollHeight; // a mesma altura da foto de página inteira
  const ctxRaiz = { modo: "abs", x: 0, y: 0 };
  const secoes = [];
  for (const item of itensDe(body)) {
    const no = item.tipo === "el" ? noElemento(item.el, ctxRaiz) : noTexto(item.nos, csBody, null, ctxRaiz);
    if (no) secoes.push(no);
  }
  return {
    largura,
    altura,
    fundo: cor(csBody.backgroundColor) ?? cor(csHtml.backgroundColor) ?? "#ffffff",
    secoes,
    recortes,
  };
}
