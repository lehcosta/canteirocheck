/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Font, Path, Rect, StyleSheet, type Styles, Svg, Text, View } from "@react-pdf/renderer";

// A hifenização padrão é a do inglês ("RESPONSÁV-EL"): quebra só entre palavras.
Font.registerHyphenationCallback((palavra) => [palavra]);

/**
 * Marca EngCheck nos relatórios PDF: cores do DS, logotipo, faixa de 4px em `liquido`, selos de status.
 * Fontes padrão do PDF (sem download): Helvetica no texto, Courier nas medidas e códigos.
 * ✓ / ✕ são desenhados em Svg: a Helvetica padrão (WinAnsi) não tem esses caracteres.
 */

export const COR = {
  ink: "#191816",
  inkMuted: "#57544D",
  line: "#DAD6CD",
  concreto: "#8A867C",
  surface: "#F4F3EF",
  liquido: "#6BE39C",
  prumo: "#F5540F",
  nivel: "#0B5E36",
  divergencia: "#C4301A",
  branco: "#FFFFFF",
} as const;

export const FONTE = {
  texto: "Helvetica",
  forte: "Helvetica-Bold",
  medida: "Courier-Bold",
  codigo: "Courier",
} as const;

type Estilo = Styles[string];

const s = StyleSheet.create({
  faixa: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: COR.liquido },
  cabecalho: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 10,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COR.line,
  },
  tipoDoc: {
    fontFamily: FONTE.forte,
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COR.inkMuted,
  },
  selo: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
  },
  seloTexto: { fontFamily: FONTE.forte, fontSize: 7, letterSpacing: 0.6, textTransform: "uppercase" },
  rotulo: {
    fontFamily: FONTE.forte,
    fontSize: 6.5,
    lineHeight: 1.4,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: COR.inkMuted,
  },
  rodapeLinha: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 44,
    height: 1,
    backgroundColor: COR.line,
  },
  rodapeTexto: { position: "absolute", left: 40, right: 40, bottom: 31, fontSize: 7, color: COR.inkMuted },
  rodapeNota: { position: "absolute", left: 40, right: 40, bottom: 20, fontSize: 7, color: COR.inkMuted },
});

/**
 * Logotipo EngCheck (estudo C): a régua de nível como marca à esquerda e "EngCheck" ao lado.
 * No PDF a palavra usa a fonte forte do relatório (Helvetica-Bold), não a Archivo do app — registrar
 * a Archivo no react-pdf exigiria o TTF; a forma da marca (régua + nome) é a mesma.
 */
export function Logotipo({ altura = 16 }: { altura?: number }) {
  const larguraRegua = (altura * 46) / 28;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: altura * 0.3 }}>
      <Svg width={larguraRegua} height={altura} viewBox="0 8 46 28">
        <Rect x={3.5} y={11.5} width={39} height={21} rx={10.5} ry={10.5} fill={COR.liquido} />
        <Rect
          x={3.5}
          y={11.5}
          width={39}
          height={21}
          rx={10.5}
          ry={10.5}
          fill="none"
          stroke={COR.ink}
          strokeWidth={7}
        />
        <Rect x={17.56} y={17.74} width={10.88} height={7.41} rx={3.7} ry={3.7} fill={COR.branco} />
        <Rect x={14.24} y={15} width={2.8} height={14} fill={COR.ink} />
        <Rect x={28.96} y={15} width={2.8} height={14} fill={COR.ink} />
      </Svg>
      <Text style={{ fontFamily: FONTE.forte, fontSize: altura * 1.02, color: COR.ink, letterSpacing: -0.3 }}>
        EngCheck
      </Text>
    </View>
  );
}

/** Faixa de 4px em `liquido` no topo de todas as páginas. Primeiro filho da `<Page>`. */
export function Faixa() {
  return <View fixed style={s.faixa} />;
}

/** Logotipo à esquerda e o tipo do documento à direita (só na primeira página). */
export function Cabecalho({ tipo }: { tipo: string }) {
  return (
    <View style={s.cabecalho}>
      <Logotipo />
      <Text style={s.tipoDoc}>{tipo}</Text>
    </View>
  );
}

/** ✓ (dentro, liberada) ou ✕ (fora, bloqueada), no traço dos ícones do painel. */
export function Icone({ tipo, cor, tamanho = 8 }: { tipo: "ok" | "fora"; cor: string; tamanho?: number }) {
  return (
    <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24">
      <Path
        d={tipo === "ok" ? "M5 12l5 5 9-10" : "M6 6l12 12M18 6L6 18"}
        fill="none"
        stroke={cor}
        strokeWidth={3.5}
        strokeLinecap="square"
      />
    </Svg>
  );
}

export type Tom = "nivel" | "divergencia" | "decisao" | "neutro";

/** Status da execução → tom do selo e palavra (nunca só a cor). */
export const STATUS_EXECUCAO: Record<string, { palavra: string; tom: Tom }> = {
  anunciada: { palavra: "Anunciada", tom: "neutro" },
  em_conferencia: { palavra: "Em conferência", tom: "neutro" },
  bloqueada: { palavra: "Bloqueada", tom: "divergencia" },
  aguardando_liberacao: { palavra: "Aguardando liberação", tom: "decisao" },
  liberada: { palavra: "Liberada", tom: "nivel" },
  recusada: { palavra: "Recusada", tom: "divergencia" },
  cancelada: { palavra: "Cancelada", tom: "neutro" },
};

export function statusExecucao(status: string): { palavra: string; tom: Tom } {
  return STATUS_EXECUCAO[status] ?? { palavra: status, tom: "neutro" };
}

/**
 * Selo em caixa alta. `nivel` e `divergencia` levam ✓/✕ e a palavra; `decisao` (pede decisão) é o
 * laranja cheio com texto quase preto; `neutro` só contorno concreto.
 */
export function Selo({ palavra, tom, style }: { palavra: string; tom: Tom; style?: Estilo }) {
  const cor =
    tom === "nivel"
      ? COR.nivel
      : tom === "divergencia"
        ? COR.divergencia
        : tom === "decisao"
          ? COR.ink
          : COR.inkMuted;
  const extra =
    tom === "decisao"
      ? { backgroundColor: COR.prumo, borderColor: COR.prumo }
      : { borderColor: tom === "neutro" ? COR.concreto : cor };
  return (
    <View style={[s.selo, extra, style ?? {}]}>
      {tom === "nivel" && <Icone tipo="ok" cor={cor} tamanho={7} />}
      {tom === "divergencia" && <Icone tipo="fora" cor={cor} tamanho={7} />}
      <Text style={[s.seloTexto, { color: cor }]}>{palavra}</Text>
    </View>
  );
}

/** Rótulo em caixa alta, estilo `label` do DS. */
export function Rotulo({ children, style }: { children: string; style?: Estilo }) {
  return <Text style={[s.rotulo, style ?? {}]}>{children}</Text>;
}

/**
 * Rodapé fixo em todas as páginas: linha `line` e texto em `ink-muted`, com a página.
 * Atenção: o `Text` com `render` não pode herdar `lineHeight` (no react-pdf 4.9 ele sai da página).
 * Nunca ponha `lineHeight` na `Page` nem num `View` ancestral: só em estilos de `Text` que também
 * definam `fontSize` (herdado, ele vira valor absoluto e estica os textos menores).
 */
export function Rodape({ texto, nota }: { texto: (pagina: number, total: number) => string; nota?: string }) {
  return (
    <>
      <View fixed style={s.rodapeLinha} />
      <Text
        style={s.rodapeTexto}
        render={({ pageNumber, totalPages }) => texto(pageNumber, totalPages ?? pageNumber)}
        fixed
      />
      {nota ? (
        <Text style={s.rodapeNota} fixed>
          {nota}
        </Text>
      ) : null}
    </>
  );
}
