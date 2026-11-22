// biome-ignore-all lint/performance/useDomNodeTextContent: innerText é o texto como a pessoa vê (quebras e caixa alta)
// Medições de uma tela, rodando DENTRO da página (page.evaluate): a função é serializada, então fica
// autocontida. Devolve inventários e achados por lente; cada achado aponta um elemento marcado com
// data-critica, que o medir.mjs usa para forçar estados e recortar a prova.
export function medirPagina({ cores, acentos, raios, familias, estatica, idioma = "pt-BR" }) {
  const achados = [];
  let seq = 0;
  const r1 = (n) => Math.round(n * 10) / 10;
  const idDe = (el) => {
    if (!el.dataset.critica) el.dataset.critica = String(++seq);
    return el.dataset.critica;
  };
  const textoDe = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  const descrever = (el) => {
    const r = el.getBoundingClientRect();
    return {
      id: idDe(el),
      tag: el.tagName.toLowerCase(),
      slot: el.getAttribute("data-slot") ?? undefined,
      texto: textoDe(el).slice(0, 60),
      rect: [r1(r.left + scrollX), r1(r.top + scrollY), r1(r.width), r1(r.height)],
    };
  };
  const achar = (lente, sugestao, titulo, el, valores) =>
    achados.push({ lente, sugestao, titulo, el: el ? descrever(el) : undefined, valores });

  const todos = [...document.body.querySelectorAll("*")].filter(
    (el) =>
      !el.closest("nextjs-portal, script, style, noscript, template") &&
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      el.getBoundingClientRect().width > 0,
  );
  const html = (el) => el.namespaceURI === "http://www.w3.org/1999/xhtml";
  const caixas = todos.filter(html);
  const comTexto = caixas.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()));
  const SEL_INTERATIVO =
    // no HTML do Paper o controle é um div: as camadas "botão" e "link" (nomes do conversor do espelho) contam
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"]), [layer-name="botão"], [layer-name="link"]';
  const interativos = caixas.filter((el) => el.matches(SEL_INTERATIVO));

  // ── cor: o canvas compõe qualquer sintaxe (oklab, color-mix, alfa) em sRGB ─────────────────
  const tela = document.createElement("canvas");
  tela.width = tela.height = 1;
  const cx = tela.getContext("2d", { willReadFrequently: true });
  const pintar = (camadas) => {
    cx.globalAlpha = 1;
    cx.clearRect(0, 0, 1, 1);
    for (const [cor, opacidade] of camadas) {
      cx.globalAlpha = opacidade;
      cx.fillStyle = "#000";
      cx.fillStyle = cor;
      cx.fillRect(0, 0, 1, 1);
    }
    cx.globalAlpha = 1;
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const solida = (valor) => {
    if (!valor || valor === "transparent") return null;
    const c = pintar([[valor, 1]]);
    return c[3] >= 0.99 ? c.slice(0, 3) : null;
  };
  const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const perto = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  const tokenDe = (rgb) => cores.find((t) => perto(t.rgb, rgb))?.nome ?? null;
  const ehAcento = (rgb) => rgb && acentos.some((a) => perto(a, rgb));
  const lum = (rgb) => {
    const f = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const contraste = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** Fundo efetivo: os fundos dos ancestrais compostos de baixo para cima, com a opacidade de cada um. */
  function fundoDe(el) {
    const cadeia = [];
    for (let a = el; a; a = a.parentElement) cadeia.unshift(a);
    const camadas = [["#ffffff", 1]];
    let opac = 1;
    let complexo = false;
    for (const a of cadeia) {
      const cs = getComputedStyle(a);
      opac *= Number.parseFloat(cs.opacity);
      if (cs.backgroundImage !== "none") complexo = true;
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") camadas.push([cs.backgroundColor, opac]);
    }
    return { camadas, opac, complexo };
  }

  // ── Hierarquia e contenção ─────────────────────────────────────────────────────────────
  const tipos = new Map();
  for (const el of comTexto) {
    const cs = getComputedStyle(el);
    const chave = `${cs.fontFamily.split(",")[0].replace(/["']/g, "").trim()} ${cs.fontSize} ${cs.fontWeight}`;
    tipos.set(chave, (tipos.get(chave) ?? 0) + 1);
  }
  const primeirasLeituras = comTexto
    .map((el) => {
      const cs = getComputedStyle(el);
      return { el, peso: Number.parseFloat(cs.fontSize) * (Number(cs.fontWeight) / 400) };
    })
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 6)
    .map(({ el }) => ({ ...descrever(el), fonte: getComputedStyle(el).font }));
  const primarios = interativos.filter((el) => ehAcento(solida(getComputedStyle(el).backgroundColor)));
  // disputam a atenção os primários que cabem numa mesma janela (uma landing longa pode ter um por dobra)
  const janela = innerHeight;
  for (const [i, el] of primarios.entries()) {
    const topo = el.getBoundingClientRect().top + scrollY;
    const juntos = primarios.filter((o) => Math.abs(o.getBoundingClientRect().top + scrollY - topo) < janela);
    if (juntos.length > 1 && juntos[0] !== el && i > 0) {
      achar(
        "hierarquia",
        "atrito",
        `${juntos.length} ações primárias (fundo de acento) na mesma janela de ${janela}px`,
        el,
      );
    }
  }
  const acentoForaDeAcao = new Set();
  for (const el of todos) {
    if (el.closest(SEL_INTERATIVO)) continue;
    const cs = getComputedStyle(el);
    const usos = [
      ["fundo", cs.backgroundColor],
      ["texto", comTexto.includes(el) ? cs.color : null],
      ["borda", Number.parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : null],
      ["traço", !html(el) && cs.stroke !== "none" ? cs.stroke : null],
      ["preenchimento", !html(el) && cs.fill !== "none" && el.tagName !== "svg" ? cs.fill : null],
    ].filter(([, v]) => v && ehAcento(solida(v)));
    if (usos.length && ![...acentoForaDeAcao].some((a) => a.contains(el))) {
      acentoForaDeAcao.add(el);
      achar("hierarquia", "atrito", "acento (cor de ação) usado em algo que não é ação", el, {
        uso: usos.map((u) => u[0]).join(", "),
      });
    }
  }

  // ── Espaço ─────────────────────────────────────────────────────────────────────────────
  const espacos = new Map();
  for (const el of caixas) {
    const cs = getComputedStyle(el);
    const valores = [
      cs.paddingTop,
      cs.paddingRight,
      cs.paddingBottom,
      cs.paddingLeft,
      cs.marginTop,
      cs.marginRight,
      cs.marginBottom,
      cs.marginLeft,
      /flex|grid/.test(cs.display) ? cs.rowGap : "0px",
      /flex|grid/.test(cs.display) ? cs.columnGap : "0px",
    ].map((v) => Number.parseFloat(v) || 0);
    for (const v of valores) {
      if (v <= 0) continue;
      const k = r1(v);
      if (!espacos.has(k)) espacos.set(k, []);
      espacos.get(k).push(el);
    }
  }
  for (const [v, els] of espacos) {
    if (v % 2 !== 0 && v > 2 && v <= 96) {
      achar("espaço", "acabamento", `espaçamento de ${v}px fora da grade (${els.length}×)`, els[0]);
    }
  }
  const escala = [...espacos.keys()].filter((v) => v <= 96);
  if (escala.length > 12) {
    achar(
      "espaço",
      "acabamento",
      `${escala.length} valores de espaçamento diferentes (ritmo solto): ${escala.sort((a, b) => a - b).join(", ")}px`,
      null,
    );
  }
  // quase alinhados: inícios de texto entre si e bordas de caixa entre si, a 1–4px, em blocos vizinhos
  const range = document.createRange();
  const inicioDoTexto = (el) => {
    range.selectNodeContents(el);
    const c = [...range.getClientRects()].find((q) => q.width > 1);
    return c ? { left: c.left, top: c.top, bottom: c.bottom } : null;
  };
  // texto dentro de controle se alinha pelo controle (padding do botão), não pela coluna
  const textos = comTexto
    .filter((el) => getComputedStyle(el).display !== "inline" && !el.closest(SEL_INTERATIVO))
    .map((el) => ({ el, r: inicioDoTexto(el) }))
    .filter(({ r }) => r);
  const molduras = caixas
    .filter((el) => {
      const cs = getComputedStyle(el);
      return cs.backgroundColor !== "rgba(0, 0, 0, 0)" || Number.parseFloat(cs.borderTopWidth) > 0;
    })
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < innerWidth - 2);
  const vistos = new Set();
  for (const [grupo, conjunto] of [
    ["inícios de texto", textos],
    ["bordas de caixa", molduras],
  ]) {
    for (const a of conjunto) {
      for (const b of conjunto) {
        const dx = Math.abs(a.r.left - b.r.left);
        const vizinhos = Math.abs(a.r.top - b.r.bottom) < 120 || Math.abs(b.r.top - a.r.bottom) < 120;
        if (a === b || dx <= 0.5 || dx > 4 || !vizinhos || a.el.contains(b.el) || b.el.contains(a.el))
          continue;
        const chave = `${grupo}|${[r1(a.r.left), r1(b.r.left)].sort().join("|")}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        achar("espaço", "acabamento", `${grupo} quase alinhados (${r1(dx)}px de diferença)`, a.el, {
          outro: descrever(b.el),
        });
      }
    }
  }

  // ── Interação (o que dá para medir parado; os estados são forçados no medir.mjs) ─────────────
  const clicaveis = 'a[href], button, summary, [role="button"], [role="link"], [role="tab"]';
  for (const el of interativos) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const desabilitado = el.matches(":disabled, [aria-disabled='true']");
    const linkNoTexto =
      cs.display === "inline" &&
      [...(el.parentElement?.childNodes ?? [])].some((n) => n.nodeType === 3 && n.data.trim());
    // exceção de espaçamento do WCAG 2.5.8: alvo pequeno passa se um círculo de 24px nele não toca outro alvo
    const meioX = r.left + r.width / 2;
    const meioY = r.top + r.height / 2;
    const folgado = interativos.every((o) => {
      if (o === el || o.contains(el) || el.contains(o)) return true;
      const q = o.getBoundingClientRect();
      return (
        Math.hypot(
          Math.max(q.left - meioX, 0, meioX - q.right),
          Math.max(q.top - meioY, 0, meioY - q.bottom),
        ) >= 12
      );
    });
    if (!linkNoTexto && !folgado && Math.min(r.width, r.height) < 24) {
      achar("interação", "atrito", `alvo de ${r1(r.width)}×${r1(r.height)}px (mínimo 24×24)`, el);
    }
    // tela estática (Paper) não tem cursor nem semântica: essas duas checagens são da tela viva
    if (!estatica && el.matches(clicaveis) && !desabilitado && cs.cursor !== "pointer") {
      achar("interação", "acabamento", `clicável com cursor "${cs.cursor}"`, el);
    }
    const nome =
      el.getAttribute("aria-label") ||
      (el.getAttribute("aria-labelledby") &&
        textoDe(document.getElementById(el.getAttribute("aria-labelledby")) ?? document.body)) ||
      (el.labels?.length ? textoDe(el.labels[0]) : "") ||
      textoDe(el) ||
      el.getAttribute("title") ||
      el.querySelector("[aria-label]")?.getAttribute("aria-label") ||
      el.querySelector("svg title")?.textContent ||
      el.querySelector("img[alt]")?.getAttribute("alt");
    if (!nome && !estatica)
      achar("interação", "quebra", "controle sem nome acessível (leitor de tela não diz o que é)", el);
  }

  // ── Contraste e cor ────────────────────────────────────────────────────────────────────
  const paleta = new Map();
  const contar = (rgb, el, papel) => {
    if (!rgb) return;
    const h = hex(rgb);
    if (!paleta.has(h)) paleta.set(h, { token: tokenDe(rgb), usos: 0, papeis: new Set(), exemplo: el });
    const p = paleta.get(h);
    p.usos++;
    p.papeis.add(papel);
  };
  let piorContraste = null;
  for (const el of comTexto) {
    const cs = getComputedStyle(el);
    const { camadas, opac, complexo } = fundoDe(el);
    const fundo = pintar(camadas).slice(0, 3);
    const frente = pintar([...camadas, [cs.color, opac]]).slice(0, 3);
    const razao = contraste(frente, fundo);
    const tam = Number.parseFloat(cs.fontSize);
    const grande = tam >= 24 || (tam >= 18.66 && Number(cs.fontWeight) >= 700);
    const minimo = grande ? 3 : 4.5;
    if (!piorContraste || razao < piorContraste.razao)
      piorContraste = { razao: r1(razao), el: descrever(el) };
    if (razao < minimo) {
      achar(
        "cor",
        "quebra",
        `contraste ${r1(razao)}:1 (mínimo ${minimo}:1)${complexo ? " — fundo com imagem/gradiente, conferir no recorte" : ""}`,
        el,
        { frente: hex(frente), fundo: hex(fundo) },
      );
    }
    contar(solida(cs.color), el, "texto");
  }
  for (const el of todos) {
    const cs = getComputedStyle(el);
    if (html(el)) {
      contar(solida(cs.backgroundColor), el, "fundo");
      if (Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none")
        contar(solida(cs.borderTopColor), el, "borda");
    } else if (el.tagName !== "svg" && el.tagName !== "g") {
      if (cs.fill !== "none") contar(solida(cs.fill), el, "ícone");
      if (cs.stroke !== "none") contar(solida(cs.stroke), el, "ícone");
    }
  }
  for (const [h, p] of paleta) {
    if (!p.token)
      achar(
        "cor",
        "acabamento",
        `cor ${h} fora dos tokens (${p.usos}×: ${[...p.papeis].join(", ")})`,
        p.exemplo,
      );
  }
  // borda de campo: precisa de 3:1 contra o fundo para a pessoa achar o campo
  for (const el of interativos.filter((e) => e.matches("input, select, textarea"))) {
    const cs = getComputedStyle(el);
    if (Number.parseFloat(cs.borderTopWidth) === 0 || el.type === "checkbox" || el.type === "radio") continue;
    const { camadas } = fundoDe(el.parentElement ?? el);
    const fundo = pintar(camadas).slice(0, 3);
    const borda = pintar([...camadas, [cs.borderTopColor, 1]]).slice(0, 3);
    const razao = contraste(borda, fundo);
    if (razao < 3)
      achar("cor", "atrito", `borda do campo com ${r1(razao)}:1 contra o fundo (mínimo 3:1)`, el);
  }

  // ── Texto ──────────────────────────────────────────────────────────────────────────────
  // linhas pelos centros verticais dos nós de texto diretos: um selo ao lado do título não é outra linha
  const linhasDe = (el) => {
    const cs = getComputedStyle(el);
    const lh = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.2;
    const centros = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.data.trim())
      .flatMap((n) => {
        range.selectNodeContents(n);
        return [...range.getClientRects()].filter((c) => c.width > 1).map((c) => (c.top + c.bottom) / 2);
      })
      .sort((a, b) => a - b);
    let linhas = 0;
    let ultimo = Number.NEGATIVE_INFINITY;
    for (const c of centros) {
      if (c - ultimo > lh / 2) linhas++;
      ultimo = c;
    }
    return linhas;
  };
  // texto próprio (nós de texto diretos) além da caixa; filho girado ou deslocado não conta
  const vaza = (el) => {
    const caixa = el.getBoundingClientRect();
    return [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.data.trim())
      .some((n) => {
        range.selectNodeContents(n);
        // na vertical vale o centro da linha: o glifo de um título 56/56 passa da linha sem vazar
        return [...range.getClientRects()].some(
          (c) => c.right > caixa.right + 1 || (c.top + c.bottom) / 2 > caixa.bottom,
        );
      });
  };
  const repetidos = new Map();
  const repetir = (titulo, sugestao, el) => {
    if (!repetidos.has(titulo)) repetidos.set(titulo, { sugestao, els: [] });
    repetidos.get(titulo).els.push(el);
  };
  for (const el of comTexto) {
    const cs = getComputedStyle(el);
    const tam = Number.parseFloat(cs.fontSize);
    const texto = textoDe(el);
    if (tam < 12) repetir(`texto de ${tam}px (abaixo de 12px)`, "atrito", el);
    if (
      cs.textTransform === "uppercase" &&
      /\p{L}{2,}/u.test(texto) &&
      (cs.letterSpacing === "normal" || Number.parseFloat(cs.letterSpacing) <= 0)
    ) {
      repetir("caixa alta sem espaçamento entre letras", "acabamento", el);
    }
    if (
      cs.textOverflow === "ellipsis" &&
      el.scrollWidth > el.clientWidth &&
      !el.title &&
      !el.closest("[title]")
    ) {
      achar("texto", "atrito", "texto cortado com reticências e sem forma de ler o resto (sem title)", el);
    } else if (cs.display !== "inline" && cs.overflowX === "visible" && vaza(el)) {
      achar("texto", "quebra", "texto vaza da caixa", el);
    }
    const linhas = linhasDe(el);
    const lh = Number.parseFloat(cs.lineHeight) || tam * 1.2;
    if (linhas >= 2 && tam < 24) {
      const porLinha = texto.length / linhas;
      if (porLinha > 90)
        achar(
          "texto",
          "atrito",
          `linha longa: ~${Math.round(porLinha)} caracteres por linha (ideal 45–85)`,
          el,
        );
      if (lh / tam < 1.3)
        achar("texto", "atrito", `entrelinha apertada para texto corrido (${r1(lh / tam)}× o corpo)`, el);
    }
    const titulo = /^H[1-3]$/.test(el.tagName) || tam >= 20;
    if (titulo && linhas >= 2) {
      const diretos = [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim());
      const palavras = diretos
        .map((n) => n.data)
        .join(" ")
        .trim()
        .split(/\s+/);
      const ultima = palavras.at(-1);
      range.selectNodeContents(diretos.at(-1));
      const ultimaLinha = [...range.getClientRects()].filter((c) => c.width > 1).at(-1);
      if (ultimaLinha && palavras.length > 2 && ultimaLinha.width < tam * (ultima.length * 0.75 + 1)) {
        achar("texto", "acabamento", `título com palavra sozinha na última linha ("${ultima}")`, el);
      }
    }
  }
  for (const [titulo, { sugestao, els }] of repetidos) {
    achar("texto", sugestao, els.length > 1 ? `${titulo} (${els.length}×)` : titulo, els[0]);
  }
  const corpo = textoDe(document.body);
  // os formatos de data, número e hora valem para o português; noutro idioma fica só o valor técnico
  const formatosPt = [
    [/\b\d{4}-\d{2}-\d{2}\b/, "data no formato ISO (aaaa-mm-dd); em pt-BR é dd/mm/aaaa"],
    [/\b\d+\.\d+\s?(cm|mm|m|kg|t|%|m²|m³)\b/, "número com ponto decimal; em pt-BR é vírgula"],
    [/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i, "hora em AM/PM; em pt-BR é 24h"],
  ];
  for (const [re, msg] of [
    ...(idioma.startsWith("pt") ? formatosPt : []),
    [/\b(undefined|null|NaN|\[object Object\])\b/, "valor técnico vazando para a tela"],
  ]) {
    const m = re.exec(corpo);
    if (m) achar("texto", re.source.includes("undefined") ? "quebra" : "atrito", `${msg}: "${m[0]}"`, null);
  }

  // ── Consistência ───────────────────────────────────────────────────────────────────────
  // fonte fora da marca, e peso que a marca não carrega (o navegador sintetiza um negrito falso)
  const carregadas = new Set(
    [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => `${f.family.replace(/["']/g, "")}|${f.weight}`),
  );
  const faces = new Map();
  for (const el of comTexto) {
    const cs = getComputedStyle(el);
    const k = `${cs.fontFamily.split(",")[0].replace(/["']/g, "").trim()}|${cs.fontWeight}`;
    if (!faces.has(k)) faces.set(k, []);
    faces.get(k).push(el);
  }
  const familiasEmUso = new Set([...faces.keys()].map((k) => k.split("|")[0]));
  for (const f of familiasEmUso) {
    const els = [...faces].filter(([k]) => k.startsWith(`${f}|`)).flatMap(([, v]) => v);
    if (!familias.includes(f))
      achar("consistência", "atrito", `fonte fora da marca: ${f} (${els.length}×)`, els[0]);
  }
  for (const [k, els] of faces) {
    const [f, peso] = k.split("|");
    const pesos = [...carregadas].filter((c) => c.startsWith(`${f}|`)).map((c) => Number(c.split("|")[1]));
    if (!familias.includes(f) || !pesos.length || pesos.includes(Number(peso))) continue;
    const pedido = Number(peso);
    const usado = pesos.reduce((a, b) => (Math.abs(b - pedido) < Math.abs(a - pedido) ? b : a));
    if (pedido >= 600 && usado < 600) {
      achar(
        "consistência",
        "atrito",
        `${f} ${peso} sem face de negrito: o navegador sintetiza um negrito falso (${els.length}×)`,
        els[0],
      );
    } else {
      achar(
        "consistência",
        "acabamento",
        `${f} ${peso} pedido, mas a marca carrega ${pesos.join("/")}: aparece o ${usado} (${els.length}×)`,
        els[0],
      );
    }
  }
  const raiosEmUso = new Map();
  for (const el of caixas) {
    const cs = getComputedStyle(el);
    const visivelCaixa =
      cs.backgroundColor !== "rgba(0, 0, 0, 0)" || Number.parseFloat(cs.borderTopWidth) > 0;
    const raio = Number.parseFloat(cs.borderTopLeftRadius);
    if (!visivelCaixa || !raio) continue;
    const k = cs.borderTopLeftRadius;
    if (!raiosEmUso.has(k)) raiosEmUso.set(k, []);
    raiosEmUso.get(k).push(el);
  }
  for (const [k, els] of raiosEmUso) {
    const v = Number.parseFloat(k);
    const r = els[0].getBoundingClientRect();
    const pilula = v >= Math.min(r.width, r.height) / 2;
    if (!raios.includes(v) && !pilula)
      achar("consistência", "acabamento", `raio ${k} fora dos tokens (${els.length}×)`, els[0]);
  }
  // botões: variantes por medida; duas variantes quase iguais costumam ser a mesma que escorregou
  const variantes = new Map();
  for (const el of interativos) {
    const cs = getComputedStyle(el);
    const caixa = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || Number.parseFloat(cs.borderTopWidth) > 0;
    if (!caixa || el.matches("input, select, textarea")) continue;
    const r = el.getBoundingClientRect();
    const v = {
      altura: Math.round(r.height),
      raio: cs.borderTopLeftRadius,
      fonte: `${cs.fontSize} ${cs.fontWeight}`,
      padX: Math.round(Number.parseFloat(cs.paddingLeft)),
      fundo:
        tokenDe(solida(cs.backgroundColor) ?? [-9, -9, -9]) ??
        (cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "sem fundo" : "outro"),
    };
    const chave = JSON.stringify(v);
    if (!variantes.has(chave)) variantes.set(chave, { ...v, usos: 0, exemplo: el });
    variantes.get(chave).usos++;
  }
  const lista = [...variantes.values()];
  for (const [i, a] of lista.entries()) {
    for (const b of lista.slice(i + 1)) {
      const mesmoResto = a.raio === b.raio && a.fonte === b.fonte && a.fundo === b.fundo;
      const dif = Math.abs(a.altura - b.altura) + Math.abs(a.padX - b.padX);
      if (mesmoResto && dif > 0 && dif <= 6) {
        achar(
          "consistência",
          "acabamento",
          `botões quase iguais: ${a.altura}px/${a.padX}px × ${b.altura}px/${b.padX}px de altura/padding`,
          a.exemplo,
          { outro: descrever(b.exemplo) },
        );
      }
    }
  }
  const icones = new Map();
  for (const el of todos.filter((e) => e.tagName === "svg")) {
    const r = el.getBoundingClientRect();
    const k = `${Math.round(r.width)}×${Math.round(r.height)}`;
    icones.set(k, (icones.get(k) ?? 0) + 1);
  }

  // ── Movimento (em repouso; reduzir movimento é medido no medir.mjs) ─────────────────────────
  const transicoes = new Map();
  for (const el of caixas) {
    const cs = getComputedStyle(el);
    const duracoes = cs.transitionDuration
      .split(",")
      .map((d) => Number.parseFloat(d) * (d.includes("ms") ? 1 : 1000));
    if (!duracoes.some((d) => d > 0)) continue;
    const chave = `${cs.transitionProperty} · ${cs.transitionDuration} · ${cs.transitionTimingFunction}`;
    if (!transicoes.has(chave)) transicoes.set(chave, { usos: 0, exemplo: el });
    transicoes.get(chave).usos++;
    if (cs.transitionProperty.split(",").some((p) => p.trim() === "all")) {
      if (transicoes.get(chave).usos === 1)
        achar(
          "movimento",
          "acabamento",
          "transition: all (anima até o que não devia, como largura e cor de borda)",
          el,
        );
    }
    if (Math.max(...duracoes) > 400 && el.matches(SEL_INTERATIVO) && transicoes.get(chave).usos === 1) {
      achar(
        "movimento",
        "atrito",
        `resposta de ${Math.max(...duracoes)}ms num controle (acima de 400ms parece lento)`,
        el,
      );
    }
  }
  const animacoes = document.getAnimations().filter((a) => a.playState === "running");
  for (const a of animacoes) {
    const alvo = a.effect?.target;
    const t = a.effect?.getTiming?.();
    if (
      alvo &&
      t?.iterations === Number.POSITIVE_INFINITY &&
      !alvo.closest('[role="progressbar"], [role="status"], [aria-busy="true"], .animate-spin')
    ) {
      achar("movimento", "atrito", "animação infinita em repouso (puxa o olho o tempo todo)", alvo);
    }
  }

  return {
    pagina: { largura: innerWidth, altura: document.documentElement.scrollHeight },
    achados,
    inventario: {
      tipografia: Object.fromEntries([...tipos].sort((a, b) => b[1] - a[1])),
      primeirasLeituras,
      primarios: primarios.map(descrever),
      espacamentos: Object.fromEntries(
        [...espacos].sort((a, b) => a[0] - b[0]).map(([v, els]) => [`${v}px`, els.length]),
      ),
      paleta: Object.fromEntries(
        [...paleta].map(([h, p]) => [
          h,
          `${p.token ?? "fora dos tokens"} · ${p.usos}× · ${[...p.papeis].join(", ")}`,
        ]),
      ),
      piorContraste,
      familias: [...familiasEmUso],
      raios: Object.fromEntries([...raiosEmUso].map(([k, els]) => [k, els.length])),
      botoes: lista.map(({ exemplo, ...v }) => v),
      icones: Object.fromEntries(icones),
      transicoes: Object.fromEntries([...transicoes].map(([k, v]) => [k, v.usos])),
      animacoesEmRepouso: animacoes.length,
    },
    interativos: interativos.map((el) => ({
      id: idDe(el),
      assinatura: `${el.tagName}|${el.className?.baseVal ?? el.className}|${el.getAttribute("type") ?? ""}`,
      atual: el.getAttribute("aria-current") === "page",
      desc: descrever(el),
    })),
  };
}
