/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { textoPdf } from "./execucao";

/** Relatório da obra: todas as execuções, com situação, divergências e decisões. */

export interface LinhaRelatorioObra {
  id: string;
  etapaNome: string;
  localNome: string;
  dataPrevista: string;
  status: string;
  rodadas: number;
  ok: number;
  divergentes: number;
  causas: string[];
  decisao: string | null; // "Liberada por Eng. Ana em 16/11 10:02"
}

export interface DadosRelatorioObra {
  obraNome: string;
  endereco: string | null;
  engenheiroResponsavel: string;
  custoEstimadoUsd: string;
  pendenciasAbertas: number;
  linhas: LinhaRelatorioObra[];
}

const s = StyleSheet.create({
  pagina: { padding: 32, fontSize: 8, fontFamily: "Helvetica" },
  titulo: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { color: "#555", marginBottom: 10 },
  cab: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#999",
    paddingBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  linha: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 3 },
  c1: { width: "22%" },
  c2: { width: "10%" },
  c3: { width: "14%" },
  c4: { width: "10%" },
  c5: { width: "44%" },
  rodape: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#888",
    textAlign: "center",
  },
});

const STATUS: Record<string, string> = {
  anunciada: "Anunciada",
  em_conferencia: "Em conferência",
  bloqueada: "BLOQUEADA",
  aguardando_liberacao: "Aguardando",
  liberada: "Liberada",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

export async function gerarPdfObra(d: DadosRelatorioObra, geradoEm = new Date()): Promise<Buffer> {
  return renderToBuffer(
    <Document title={textoPdf(`Relatório — ${d.obraNome}`)} author="CanteiroCheck">
      <Page size="A4" orientation="landscape" style={s.pagina}>
        <Text style={s.titulo}>{textoPdf(d.obraNome)}</Text>
        <Text style={s.sub}>
          {textoPdf(
            `${d.endereco ?? ""} · Responsável: ${d.engenheiroResponsavel} · ${d.linhas.length} execuções · ${d.pendenciasAbertas} pendência(s) de projeto aberta(s) · custo estimado de mensagens e IA: US$ ${d.custoEstimadoUsd}`,
          )}
        </Text>
        <View style={s.cab}>
          <Text style={s.c1}>Etapa · local</Text>
          <Text style={s.c2}>Data</Text>
          <Text style={s.c3}>Situação</Text>
          <Text style={s.c4}>Pontos</Text>
          <Text style={s.c5}>Divergências e decisão</Text>
        </View>
        {d.linhas.map((l) => (
          <View key={l.id} style={s.linha} wrap={false}>
            <Text style={s.c1}>{textoPdf(`${l.etapaNome} · ${l.localNome}`)}</Text>
            <Text style={s.c2}>{l.dataPrevista.split("-").reverse().join("/")}</Text>
            <Text
              style={s.c3}
            >{`${STATUS[l.status] ?? l.status}${l.rodadas > 1 ? ` (${l.rodadas} rodadas)` : ""}`}</Text>
            <Text style={s.c4}>{`${l.ok} ok / ${l.divergentes} div.`}</Text>
            <Text style={s.c5}>
              {textoPdf(
                [l.causas.length ? `Causas: ${l.causas.join("; ")}` : "", l.decisao ?? ""]
                  .filter(Boolean)
                  .join(" — ") || "—",
              )}
            </Text>
          </View>
        ))}
        <Text
          style={s.rodape}
          render={({ pageNumber, totalPages }) =>
            textoPdf(
              `Gerado em ${geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · página ${pageNumber}/${totalPages}`,
            )
          }
          fixed
        />
      </Page>
    </Document>,
  );
}
