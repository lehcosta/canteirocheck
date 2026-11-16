/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { textoPdf } from "./execucao";
import { Cabecalho, COR, Faixa, FONTE, Icone, Rodape, Rotulo, Selo, statusExecucao } from "./marca";

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
  pagina: {
    paddingTop: 28,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 8.5,
    fontFamily: FONTE.texto,
    color: COR.ink,
    backgroundColor: COR.branco,
  },
  titulo: { fontSize: 20, lineHeight: 1.1, fontFamily: FONTE.forte, letterSpacing: -0.2 },
  endereco: { fontSize: 9, lineHeight: 1.35, color: COR.inkMuted, marginTop: 3, marginBottom: 14 },
  numeros: { flexDirection: "row", gap: 8, marginBottom: 16 },
  numero: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 1,
    borderColor: COR.line,
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 3,
    justifyContent: "space-between",
  },
  numeroValor: { fontFamily: FONTE.forte, fontSize: 14 },
  numeroTexto: { fontSize: 10, paddingTop: 3 },
  cab: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COR.ink,
  },
  linha: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COR.line,
  },
  c1: { width: "20%" },
  c2: { width: "9%" },
  c3: { width: "18%", gap: 2 },
  c4: { width: "14%", flexDirection: "row", flexWrap: "wrap", columnGap: 8 },
  c5: { flex: 1 },
  etapa: { fontFamily: FONTE.forte, fontSize: 8.5, lineHeight: 1.35 },
  corrido: { fontSize: 8.5, lineHeight: 1.35 },
  contagem: { flexDirection: "row", alignItems: "center", gap: 3 },
  numMedida: { fontFamily: FONTE.medida },
  muted: { color: COR.inkMuted },
  vazio: { paddingVertical: 16, color: COR.inkMuted },
});

export async function gerarPdfObra(d: DadosRelatorioObra, geradoEm = new Date()): Promise<Buffer> {
  const liberadas = d.linhas.filter((l) => l.status === "liberada").length;
  const bloqueadas = d.linhas.filter((l) => l.status === "bloqueada" || l.status === "recusada").length;
  return renderToBuffer(
    <Document title={textoPdf(`Relatório — ${d.obraNome}`)} author="Prumo" creator="Prumo" producer="Prumo">
      <Page size="A4" orientation="landscape" style={s.pagina}>
        <Faixa />
        <Cabecalho tipo="Relatório da obra" />

        <Text style={s.titulo}>{textoPdf(d.obraNome)}</Text>
        <Text style={s.endereco}>
          {textoPdf([d.endereco, `Responsável: ${d.engenheiroResponsavel}`].filter(Boolean).join(" · "))}
        </Text>

        <View style={s.numeros}>
          <View style={s.numero}>
            <Rotulo>Execuções</Rotulo>
            <Text style={s.numeroValor}>{d.linhas.length}</Text>
          </View>
          <View style={s.numero}>
            <Rotulo>Liberadas</Rotulo>
            <View style={s.contagem}>
              <Icone tipo="ok" cor={COR.nivel} tamanho={10} />
              <Text style={[s.numeroValor, { color: COR.nivel }]}>{liberadas}</Text>
            </View>
          </View>
          <View style={s.numero}>
            <Rotulo>Bloqueadas ou recusadas</Rotulo>
            <View style={s.contagem}>
              <Icone tipo="fora" cor={COR.divergencia} tamanho={10} />
              <Text style={[s.numeroValor, { color: COR.divergencia }]}>{bloqueadas}</Text>
            </View>
          </View>
          <View style={s.numero}>
            <Rotulo>Pendências de projeto abertas</Rotulo>
            <Text style={s.numeroValor}>{d.pendenciasAbertas}</Text>
          </View>
          <View style={s.numero}>
            <Rotulo>Custo estimado (mensagens e IA)</Rotulo>
            <Text style={s.numeroTexto}>
              {textoPdf(`US$ ${d.custoEstimadoUsd.replace(/^(\d+)\.(\d+)$/, "$1,$2")}`)}
            </Text>
          </View>
        </View>

        <View style={s.cab}>
          <Rotulo style={s.c1}>Etapa · local</Rotulo>
          <Rotulo style={s.c2}>Data</Rotulo>
          <Rotulo style={{ width: "18%" }}>Situação</Rotulo>
          <Rotulo style={{ width: "14%" }}>Pontos</Rotulo>
          <Rotulo style={s.c5}>Divergências e decisão</Rotulo>
        </View>
        {d.linhas.length === 0 ? <Text style={s.vazio}>Nenhuma execução registrada nesta obra.</Text> : null}
        {d.linhas.map((l) => {
          const st = statusExecucao(l.status);
          const detalhe = [l.causas.length ? `Causas: ${l.causas.join("; ")}` : "", l.decisao ?? ""]
            .filter(Boolean)
            .join(" — ");
          return (
            <View key={l.id} style={s.linha} wrap={false}>
              <Text style={[s.c1, s.etapa]}>{textoPdf(`${l.etapaNome} · ${l.localNome}`)}</Text>
              <Text style={s.c2}>{l.dataPrevista.split("-").reverse().join("/")}</Text>
              <View style={s.c3}>
                <Selo palavra={st.palavra} tom={st.tom} />
                {l.rodadas > 1 ? <Text style={s.muted}>{`${l.rodadas} rodadas`}</Text> : null}
              </View>
              <View style={s.c4}>
                <View style={s.contagem}>
                  <Icone tipo="ok" cor={COR.nivel} />
                  <Text style={s.numMedida}>{l.ok}</Text>
                  <Text style={s.muted}>dentro</Text>
                </View>
                <View style={s.contagem}>
                  <Icone tipo="fora" cor={l.divergentes ? COR.divergencia : COR.inkMuted} />
                  <Text style={s.numMedida}>{l.divergentes}</Text>
                  <Text style={s.muted}>fora</Text>
                </View>
              </View>
              <Text style={[s.c5, s.corrido, detalhe ? {} : s.muted]}>{textoPdf(detalhe || "—")}</Text>
            </View>
          );
        })}

        <Rodape
          texto={(pagina, total) =>
            textoPdf(
              `Prumo · gerado em ${geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · página ${pagina}/${total}`,
            )
          }
        />
      </Page>
    </Document>,
  );
}
