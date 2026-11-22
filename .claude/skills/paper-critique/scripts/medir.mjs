#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// biome-ignore-all lint/performance/useDomNodeTextContent: innerText é o texto como a pessoa vê
// Mede uma tela do Prumo nas 8 lentes da crítica e junta as provas: foto, foto semicerrada,
// estados de cada controle, recortes de cada achado e um relatório por lente.
//
// uso (da raiz do repositório):
//   node .claude/skills/paper-critique/scripts/medir.mjs --rota '/obras/[obraId]' [--largura 1440]
//   node .claude/skills/paper-critique/scripts/medir.mjs --html <arquivo.html>   (tela estática do paper-explorer)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  APP,
  chromium,
  descobrirRotas,
  entrar,
  lerFontesNext,
  lerTokens,
  resolverRota,
} from "../../paper-sync/scripts/prumo.mjs";
import { medirPagina } from "./medidor.mjs";

const LENTES = [
  ["hierarquia", "HIE", "Hierarquia e contenção"],
  ["espaço", "ESP", "Espaço"],
  ["estabilidade", "EST", "Estabilidade"],
  ["interação", "INT", "Interação"],
  ["cor", "COR", "Contraste e cor"],
  ["texto", "TXT", "Texto"],
  ["consistência", "CON", "Consistência"],
  ["movimento", "MOV", "Movimento"],
];
const MAX_ESTADOS = 24;

const { values: op } = parseArgs({
  options: {
    rota: { type: "string" },
    html: { type: "string" },
    largura: { type: "string", default: "1440" },
  },
});
if (!op.rota === !op.html) {
  console.error("uso: medir.mjs --rota <rota> | --html <arquivo>  [--largura 1440]");
  process.exit(1);
}
const LARGURA = Number(op.largura);
const nome =
  (op.rota ?? op.html.split("/").at(-1)).replace(/[/[\]. ]+/g, "_").replace(/^_|_$/g, "") || "inicio";
const SAIDA = join(
  tmpdir(),
  "prumo-critica",
  `${nome}-${LARGURA}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
mkdirSync(join(SAIDA, "achados"), { recursive: true });

// layout shift desde o primeiro byte: o observador entra antes da página
const OBSERVAR_SHIFT = () => {
  window.__shifts = [];
  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (!e.hadRecentInput)
        window.__shifts.push({ valor: e.value, quando: e.startTime, nos: e.sources.map((s) => s.node) });
    }
  }).observe({ type: "layout-shift", buffered: true });
};

const navegador = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const contexto = (extra = {}) =>
  navegador.newContext({
    viewport: { width: LARGURA, height: LARGURA < 600 ? 844 : 900 }, // celular: a janela de um iPhone
    deviceScaleFactor: 1,
    locale: "pt-BR",
    ...extra,
  });

try {
  // ── abrir a tela como a pessoa vê ──────────────────────────────────────────────────────────
  const anonimo = await contexto();
  const logado = await contexto();
  await anonimo.addInitScript(OBSERVAR_SHIFT);
  await logado.addInitScript(OBSERVAR_SHIFT);
  const pAnon = await anonimo.newPage();
  const pLog = await logado.newPage();
  let page;
  let url;
  if (op.rota) {
    await entrar(pLog);
    const todas = descobrirRotas();
    url = op.rota.includes("[") ? await resolverRota(pLog, op.rota, todas, new Map()) : op.rota;
    if (!url) throw new Error(`sem dados no banco para preencher os parâmetros de ${op.rota}`);
    await pAnon.goto(APP + url, { waitUntil: "networkidle" });
    page = new URL(pAnon.url()).pathname === url ? pAnon : pLog;
    await page.goto(APP + url, { waitUntil: "networkidle" });
  } else {
    page = pAnon;
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    const corpo = readFileSync(resolve(op.html), "utf8")
      .replace(
        /paper-asset:\/\/([^"')\s]+)/g,
        (_, c) => `data:image/png;base64,${readFileSync(c).toString("base64")}`,
      )
      .replace(/color-mix\(var/g, "color-mix(in srgb, var");
    await page.evaluate((corpo) => {
      document.body.innerHTML = `<div style="position:relative;width:max-content">${corpo}</div>`;
    }, corpo);
  }
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // o que chega depois do networkidle também conta como shift

  const fontesNext = await lerFontesNext(page);
  const tokens = lerTokens(fontesNext);
  const rgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const acentos = tokens.paper
    .filter((t) => /^--color-prumo(-escuro)?$/.test(t.name))
    .map((t) => rgb(t.value));
  const raios = tokens.paper.filter((t) => t.type === "radius").map((t) => Number.parseFloat(t.value));
  const familias = tokens.paper.filter((t) => t.type === "fontFamily").map((t) => t.value);
  if (op.html) {
    // a prévia do paper-explorer usa os tokens como variáveis CSS
    const vars = tokens.paper
      .filter((t) => t.type === "color")
      .map((t) => `${t.name}:${t.value}`)
      .join(";");
    await page.evaluate(
      (vars) =>
        document.body.firstElementChild.setAttribute("style", `position:relative;width:max-content;${vars}`),
      vars,
    );
  }

  const foto = join(SAIDA, "tela.png");
  await page.screenshot({ path: foto, fullPage: true, caret: "hide" });
  const medida = await page.evaluate(medirPagina, {
    cores: tokens.cores,
    acentos,
    raios,
    familias,
    estatica: Boolean(op.html),
  });
  // ── Estabilidade: shifts do carregamento ────────────────────────────────────────────────
  if (op.rota) {
    const shifts = await page.evaluate(() =>
      window.__shifts.map((s) => ({
        valor: s.valor,
        quando: Math.round(s.quando),
        nos: s.nos.filter(Boolean).map((n) => {
          const el = n.nodeType === 1 ? n : n.parentElement;
          if (!el) return null;
          if (!el.dataset.critica) el.dataset.critica = `c${Math.random().toString(36).slice(2, 7)}`;
          const r = el.getBoundingClientRect();
          return {
            id: el.dataset.critica,
            tag: el.tagName.toLowerCase(),
            texto: (el.innerText ?? "").trim().slice(0, 60),
            rect: [r.left + scrollX, r.top + scrollY, r.width, r.height],
          };
        }),
      })),
    );
    const cls = shifts.reduce((s, x) => s + x.valor, 0);
    medida.inventario.cls = Math.round(cls * 1000) / 1000;
    for (const s of shifts) {
      medida.achados.push({
        lente: "estabilidade",
        sugestao: s.valor >= 0.1 ? "quebra" : "atrito",
        titulo: `layout shift de ${Math.round(s.valor * 1000) / 1000} aos ${s.quando}ms do carregamento`,
        el: s.nos.find(Boolean),
      });
    }
  }

  // ── Interação e Estabilidade: estados forçados (sem clicar em nada) ─────────────────────────
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  // estados a partir do repouso: um campo com autofocus já estaria focado e pareceria "sem foco visível"
  await page.evaluate(() => document.activeElement?.blur());
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const ESTADOS = [
    ["hover", "passar o mouse"],
    ["focus-visible", "foco pelo teclado"],
    ["active", "pressionado"],
  ];
  const visual = (id) =>
    page.evaluate((id) => {
      const el = document.querySelector(`[data-critica="${id}"]`);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // posição de layout (offset*), que ignora transform: afundar 1px ao pressionar não empurra ninguém
      const caixaDe = (v) =>
        v instanceof HTMLElement ? [v.offsetLeft, v.offsetTop, v.offsetWidth, v.offsetHeight].join(",") : "";
      const vizinhos = [...(el.parentElement?.children ?? [])].map(caixaDe);
      return {
        estilo: [
          cs.backgroundColor,
          cs.color,
          cs.borderColor,
          cs.outlineStyle,
          cs.outlineColor,
          cs.outlineWidth,
          cs.boxShadow,
          cs.textDecorationLine,
          cs.opacity,
          cs.transform,
          cs.filter,
        ].join("|"),
        caixa: caixaDe(el),
        vizinhos: vizinhos.join(";"),
        rect: [r.left + scrollX, r.top + scrollY, r.width, r.height],
      };
    }, id);
  const unicos = [];
  const assinaturas = new Set();
  for (const i of medida.interativos) {
    if (assinaturas.has(i.assinatura)) continue;
    assinaturas.add(i.assinatura);
    unicos.push(i);
  }
  const estados = [];
  // estados só existem na tela viva; no HTML estático do Paper não há o que forçar
  for (const i of op.html ? [] : unicos.slice(0, MAX_ESTADOS)) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `[data-critica="${i.id}"]`,
    });
    if (!nodeId) continue;
    const base = await visual(i.id);
    const linha = { ...i, quadros: [] };
    const recorte = (r) => ({
      x: Math.max(0, r[0] - 8),
      y: Math.max(0, r[1] - 8),
      width: r[2] + 16,
      height: r[3] + 16,
    });
    linha.quadros.push({
      estado: "normal",
      png: (await page.screenshot({ clip: recorte(base.rect), fullPage: true })).toString("base64"),
    });
    for (const [estado, rotulo] of ESTADOS) {
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [estado] });
      const v = await visual(i.id);
      linha.quadros.push({
        estado: rotulo,
        png: (await page.screenshot({ clip: recorte(base.rect), fullPage: true })).toString("base64"),
      });
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
      // item da página atual (aria-current) já está destacado: não precisa reagir ao mouse
      const ehControle = /^(A|BUTTON|SUMMARY)\|/.test(i.assinatura) && !i.atual;
      if (v.caixa !== base.caixa || v.vizinhos !== base.vizinhos) {
        medida.achados.push({
          lente: "estabilidade",
          sugestao: "atrito",
          titulo: `${rotulo} muda o tamanho ou empurra os vizinhos`,
          el: i.desc,
        });
      } else if (v.estilo === base.estilo) {
        if (estado === "focus-visible") {
          medida.achados.push({
            lente: "interação",
            sugestao: "quebra",
            titulo: "sem foco visível pelo teclado",
            el: i.desc,
          });
        } else if (estado === "hover" && ehControle) {
          medida.achados.push({
            lente: "interação",
            sugestao: "atrito",
            titulo: "não responde ao passar o mouse",
            el: i.desc,
          });
        }
      }
    }
    estados.push(linha);
  }
  medida.inventario.controlesTestados = `${Math.min(unicos.length, MAX_ESTADOS)} de ${unicos.length} tipos (${medida.interativos.length} controles)`;

  // ── Movimento: a mesma tela pedindo "reduzir movimento" ───────────────────────────────────
  if (op.rota) {
    const calmo = await contexto({
      reducedMotion: "reduce",
      storageState: await page.context().storageState(),
    });
    const pc = await calmo.newPage();
    await pc.goto(APP + url, { waitUntil: "networkidle" });
    await pc.waitForTimeout(800);
    const emMovimento = await pc.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => {
          const el = a.effect?.target;
          return el ? `${el.tagName.toLowerCase()} "${(el.innerText ?? "").trim().slice(0, 30)}"` : "?";
        }),
    );
    const deslocam = await pc.evaluate(
      () =>
        [...document.querySelectorAll("*")].filter((el) => {
          const cs = getComputedStyle(el);
          return (
            Number.parseFloat(cs.transitionDuration) > 0 &&
            /transform|translate|scale|rotate|all/.test(cs.transitionProperty)
          );
        }).length,
    );
    medida.inventario.comReduzirMovimento = {
      animacoes: emMovimento.length,
      transicoesDeMovimento: deslocam,
    };
    if (emMovimento.length) {
      medida.achados.push({
        lente: "movimento",
        sugestao: "atrito",
        titulo: `${emMovimento.length} animação(ões) continuam com "reduzir movimento": ${emMovimento.slice(0, 3).join(", ")}`,
      });
    }
    await calmo.close();
  }

  // ── provas: foto semicerrada, folha de estados, recortes ───────────────────────────────────
  const fer = await (await contexto()).newPage();
  const fotoB64 = readFileSync(foto).toString("base64");
  const semicerrado = await fer.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.filter = "blur(8px) grayscale(0.3)";
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }, fotoB64);
  writeFileSync(join(SAIDA, "semicerrado.png"), Buffer.from(semicerrado, "base64"));

  if (estados.length) {
    await fer.setContent(
      `<body style="margin:0;padding:24px;background:#e9e7e1;font:13px system-ui;width:max-content">${estados
        .map(
          (
            e,
          ) => `<div style="display:flex;gap:16px;align-items:center;padding:8px 0;border-bottom:1px solid #ccc">
          <div style="width:220px">${e.desc.tag} ${e.desc.slot ? `[${e.desc.slot}]` : ""}<br><b>${(e.desc.texto || "—").replace(/</g, "&lt;")}</b></div>
          ${e.quadros.map((q) => `<figure style="margin:0;text-align:center"><img src="data:image/png;base64,${q.png}" style="background:#fff"><figcaption>${q.estado}</figcaption></figure>`).join("")}
        </div>`,
        )
        .join("")}</body>`,
    );
    await fer.screenshot({ path: join(SAIDA, "estados.png"), fullPage: true });
  }

  // códigos e recortes por lente, na ordem das lentes
  const porLente = new Map(LENTES.map(([l]) => [l, []]));
  for (const a of medida.achados) porLente.get(a.lente)?.push(a);
  const recortes = [];
  for (const [l, sigla] of LENTES) {
    for (const [n, a] of porLente.get(l).entries()) {
      a.codigo = `${sigla}-${n + 1}`;
      if (a.el?.rect) recortes.push({ codigo: a.codigo, rect: a.el.rect });
    }
  }
  const imagens = await fer.evaluate(
    async ({ b64, recortes }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      return recortes.map(({ codigo, rect: [x, y, w, h] }) => {
        const m = 16;
        const c = document.createElement("canvas");
        const x0 = Math.max(0, Math.floor(x - m));
        const y0 = Math.max(0, Math.floor(y - m));
        c.width = Math.max(1, Math.min(img.width - x0, Math.ceil(w + 2 * m)));
        c.height = Math.max(1, Math.min(img.height - y0, Math.ceil(h + 2 * m)));
        const ctx = c.getContext("2d");
        ctx.drawImage(img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
        ctx.strokeStyle = "rgb(230,0,0)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - x0, y - y0, w, h);
        return [codigo, c.toDataURL("image/png").split(",")[1]];
      });
    },
    { b64: fotoB64, recortes },
  );
  for (const [codigo, b64] of imagens)
    writeFileSync(join(SAIDA, "achados", `${codigo}.png`), Buffer.from(b64, "base64"));

  // ── relatório ──────────────────────────────────────────────────────────────────────────
  const inv = medida.inventario;
  const md = [
    `# Medidas de ${op.rota ?? op.html}${url && url !== op.rota ? ` (${url})` : ""} — ${LARGURA}px`,
    "",
    `Provas: \`tela.png\`, \`semicerrado.png\`${estados.length ? ", `estados.png`" : ""} e \`achados/<código>.png\` (o elemento circulado em vermelho).`,
    op.html
      ? "Tela estática: estabilidade no carregamento, estados e movimento com reduzir movimento não se aplicam."
      : "",
    "",
  ];
  for (const [l, , titulo] of LENTES) {
    md.push(`## ${titulo}`, "");
    const lista = porLente.get(l);
    if (!lista.length) md.push("Nada sinalizado pela medição.");
    for (const a of lista) {
      const onde = a.el
        ? ` — ${a.el.tag}${a.el.slot ? `[${a.el.slot}]` : ""} "${a.el.texto}" em (${a.el.rect.map(Math.round).join(", ")})`
        : "";
      const extra = a.valores ? ` ${JSON.stringify(a.valores)}` : "";
      md.push(`- **${a.codigo}** (${a.sugestao}) ${a.titulo}${onde}${extra}`);
    }
    md.push("");
  }
  md.push(
    "## Inventário",
    "",
    `- Primeiras leituras (maior corpo × peso): ${inv.primeirasLeituras.map((p) => `"${p.texto}" (${p.fonte})`).join("; ")}`,
    `- Ações primárias: ${inv.primarios.length} (${inv.primarios.map((p) => `"${p.texto}"`).join(", ")})`,
    `- Tipografia (família corpo peso: usos): ${JSON.stringify(inv.tipografia)}`,
    `- Espaçamentos (valor: usos): ${JSON.stringify(inv.espacamentos)}`,
    `- Paleta: ${JSON.stringify(inv.paleta)}`,
    `- Pior contraste de texto: ${inv.piorContraste ? `${inv.piorContraste.razao}:1 em "${inv.piorContraste.el.texto}"` : "—"}`,
    `- Raios: ${JSON.stringify(inv.raios)} · Famílias: ${inv.familias.join(", ")} · Ícones: ${JSON.stringify(inv.icones)}`,
    `- Variantes de botão: ${inv.botoes.length} ${JSON.stringify(inv.botoes)}`,
    `- Transições: ${JSON.stringify(inv.transicoes)} · Animações em repouso: ${inv.animacoesEmRepouso}`,
    inv.comReduzirMovimento ? `- Com reduzir movimento: ${JSON.stringify(inv.comReduzirMovimento)}` : "",
    inv.cls !== undefined ? `- CLS do carregamento: ${inv.cls} (bom ≤ 0,1)` : "",
    `- Controles com estados testados: ${inv.controlesTestados}`,
  );
  writeFileSync(join(SAIDA, "medidas.md"), md.filter((l) => l !== null).join("\n"));
  writeFileSync(join(SAIDA, "medidas.json"), JSON.stringify(medida, null, 1));
  const total = Object.fromEntries(LENTES.map(([l, sigla]) => [sigla, porLente.get(l).length]));
  console.log(`achados por lente: ${JSON.stringify(total)}\nmedidas: ${join(SAIDA, "medidas.md")}`);
} finally {
  await navegador.close();
}
