/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Relatório da execução (prompt §3.12): pontos, medidas, fotos, quem conferiu e quem liberou.
 * Entrada estrutural (compatível com `ResumoExecucao` de servicos) para não criar dependência circular.
 * Fonte padrão (Helvetica/WinAnsi): acentos ok; emojis e "−" são trocados por equivalentes.
 */

export interface MidiaRelatorio {
  id: string;
  status: string;
}

export interface DadosRelatorioExecucao {
  id: string;
  obraNome: string;
  etapaNome: string;
  localNome: string;
  dataPrevista: string;
  status: string;
  rodadaAtual: number;
  anunciadaPor: string;
  engenheiroResponsavel: { nome: string };
  criadoEm: Date;
  rodadas: {
    rodada: number;
    ok: number;
    divergentes: number;
    pendentes: number;
    decisao: {
      decisao: string;
      justificativa: string | null;
      engenheiroNome: string;
      canal: string;
      criadoEm: Date;
    } | null;
    pontos: {
      pontoId: string;
      descricao: string;
      esperado: string;
      situacao: "ok" | "divergente" | "pendente";
      tentativas: {
        tentativa: number;
        texto: string;
        dentro: boolean;
        observacao: string | null;
        usuarioNome: string;
        canal: string;
        estruturada: boolean;
        criadoEm: Date;
        midias: MidiaRelatorio[];
      }[];
      divergencia: {
        causa: string;
        descricao: string | null;
        criadoEm: Date;
        midias: MidiaRelatorio[];
      } | null;
    }[];
  }[];
}

export interface FotoRelatorio {
  dados: Buffer;
  sha256: string;
}

const STATUS: Record<string, string> = {
  anunciada: "Anunciada",
  em_conferencia: "Em conferência",
  bloqueada: "BLOQUEADA",
  aguardando_liberacao: "Aguardando liberação",
  liberada: "LIBERADA",
  recusada: "RECUSADA",
  cancelada: "Cancelada",
};

const CANAL: Record<string, string> = {
  flow: "WhatsApp (formulário)",
  conversa: "WhatsApp (conversa)",
  painel: "painel",
};

/** Troca o que a fonte padrão do PDF não desenha. */
export function textoPdf(t: string): string {
  return t
    .replace(/−/g, "-")
    .replace(/✅/g, "[OK]")
    .replace(/❌/g, "[X]")
    .replace(/⏳/g, "[ ]")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^\t\n\r\u0020-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "?");
}

const fmtData = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const s = StyleSheet.create({
  pagina: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  titulo: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 10, color: "#555", marginBottom: 10 },
  caixa: { borderWidth: 1, borderColor: "#ddd", borderRadius: 3, padding: 8, marginBottom: 10 },
  linha: { flexDirection: "row", gap: 16, marginBottom: 2 },
  rotulo: { color: "#666", width: 120 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 6 },
  ponto: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 6 },
  pontoTitulo: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  ok: { color: "#047857", fontFamily: "Helvetica-Bold" },
  ruim: { color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  neutro: { color: "#555" },
  fotos: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  foto: { width: 120, height: 90, objectFit: "cover" },
  legenda: { fontSize: 6, color: "#777", width: 120 },
  rodape: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#888",
    textAlign: "center",
  },
});

function Fotos({ midias, fotos }: { midias: MidiaRelatorio[]; fotos: Map<string, FotoRelatorio> }) {
  const presentes = midias.filter((m) => fotos.has(m.id));
  if (presentes.length === 0) return null;
  return (
    <View style={s.fotos}>
      {presentes.map((m) => {
        const f = fotos.get(m.id);
        if (!f) return null;
        return (
          <View key={m.id}>
            <Image style={s.foto} src={{ data: f.dados, format: "jpg" }} />
            <Text style={s.legenda}>sha256 {f.sha256.slice(0, 16)}…</Text>
          </View>
        );
      })}
    </View>
  );
}

export function RelatorioExecucao({
  r,
  fotos,
  geradoEm,
}: {
  r: DadosRelatorioExecucao;
  fotos: Map<string, FotoRelatorio>;
  geradoEm: Date;
}) {
  const statusEstilo =
    r.status === "liberada" ? s.ok : r.status === "bloqueada" || r.status === "recusada" ? s.ruim : s.neutro;
  return (
    <Document title={textoPdf(`${r.etapaNome} · ${r.localNome} — ${r.obraNome}`)} author="Prumo">
      <Page size="A4" style={s.pagina}>
        <Text style={s.titulo}>{textoPdf(`${r.etapaNome} · ${r.localNome}`)}</Text>
        <Text style={s.sub}>{textoPdf(`${r.obraNome} — relatório de conferência antes da execução`)}</Text>

        <View style={s.caixa}>
          <View style={s.linha}>
            <Text style={s.rotulo}>Situação</Text>
            <Text style={statusEstilo}>{STATUS[r.status] ?? r.status}</Text>
          </View>
          <View style={s.linha}>
            <Text style={s.rotulo}>Data prevista</Text>
            <Text>{r.dataPrevista.split("-").reverse().join("/")}</Text>
          </View>
          <View style={s.linha}>
            <Text style={s.rotulo}>Anunciada por</Text>
            <Text>{textoPdf(`${r.anunciadaPor} em ${fmtData(r.criadoEm)}`)}</Text>
          </View>
          <View style={s.linha}>
            <Text style={s.rotulo}>Engenheiro responsável</Text>
            <Text>{textoPdf(r.engenheiroResponsavel.nome)}</Text>
          </View>
          <View style={s.linha}>
            <Text style={s.rotulo}>Rodadas de conferência</Text>
            <Text>{r.rodadaAtual}</Text>
          </View>
        </View>

        {r.rodadas.map((rod) => (
          <View key={rod.rodada} wrap>
            <Text style={s.h2}>
              {textoPdf(
                `Rodada ${rod.rodada} — ${rod.ok} dentro da tolerância, ${rod.divergentes} divergente(s)${rod.pendentes ? `, ${rod.pendentes} sem resposta` : ""}`,
              )}
            </Text>
            {rod.pontos.map((p) => (
              <View key={p.pontoId} style={s.ponto} wrap={false}>
                <Text style={s.pontoTitulo}>
                  <Text style={p.situacao === "ok" ? s.ok : p.situacao === "divergente" ? s.ruim : s.neutro}>
                    {p.situacao === "ok" ? "[OK] " : p.situacao === "divergente" ? "[X] " : "[ ] "}
                  </Text>
                  {textoPdf(p.descricao)}
                </Text>
                <Text style={s.neutro}>{textoPdf(`Esperado: ${p.esperado}`)}</Text>
                {p.tentativas.map((t) => (
                  <View key={t.tentativa}>
                    <Text>
                      {textoPdf(
                        `${t.tentativa}ª medida: ${t.texto} — ${t.dentro ? "dentro" : "fora"} da tolerância · ${t.usuarioNome} · ${fmtData(t.criadoEm)} · ${CANAL[t.canal] ?? t.canal}${t.estruturada ? "" : " (não estruturada)"}${t.observacao ? ` · obs.: ${t.observacao}` : ""}`,
                      )}
                    </Text>
                    <Fotos midias={t.midias} fotos={fotos} />
                  </View>
                ))}
                {p.divergencia ? (
                  <View>
                    <Text style={s.ruim}>
                      {textoPdf(
                        `Causa provável: ${p.divergencia.causa}${p.divergencia.descricao ? ` — ${p.divergencia.descricao}` : ""}`,
                      )}
                    </Text>
                    <Fotos midias={p.divergencia.midias} fotos={fotos} />
                  </View>
                ) : null}
              </View>
            ))}
            <View style={[s.caixa, { marginTop: 6 }]}>
              {rod.decisao ? (
                <Text>
                  <Text style={rod.decisao.decisao === "liberada" ? s.ok : s.ruim}>
                    {rod.decisao.decisao === "liberada" ? "LIBERADA" : "RECUSADA"}
                  </Text>
                  {textoPdf(
                    ` por ${rod.decisao.engenheiroNome} em ${fmtData(rod.decisao.criadoEm)} (${CANAL[rod.decisao.canal] ?? rod.decisao.canal})${rod.decisao.justificativa ? `. Justificativa: ${rod.decisao.justificativa}` : ""}`,
                  )}
                </Text>
              ) : (
                <Text style={s.neutro}>Sem decisão do engenheiro nesta rodada.</Text>
              )}
            </View>
          </View>
        ))}

        <Text
          style={s.rodape}
          render={({ pageNumber, totalPages }) =>
            textoPdf(
              `Execução ${r.id} · gerado em ${fmtData(geradoEm)} · página ${pageNumber}/${totalPages} · A comparação medido × projetado é feita por regra determinística; a liberação é decisão do engenheiro responsável.`,
            )
          }
          fixed
        />
      </Page>
    </Document>
  );
}

export async function gerarPdfExecucao(
  r: DadosRelatorioExecucao,
  fotos: Map<string, FotoRelatorio>,
  geradoEm = new Date(),
): Promise<Buffer> {
  return renderToBuffer(<RelatorioExecucao r={r} fotos={fotos} geradoEm={geradoEm} />);
}
