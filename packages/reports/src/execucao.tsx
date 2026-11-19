/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Cabecalho, COR, Faixa, FONTE, Icone, Rodape, Rotulo, Selo, statusExecucao } from "./marca";

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
  pagina: {
    paddingTop: 32,
    paddingBottom: 64,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: FONTE.texto,
    color: COR.ink,
    backgroundColor: COR.branco,
  },
  obra: { fontSize: 9, color: COR.inkMuted, marginBottom: 2 },
  tituloLinha: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  titulo: { fontSize: 20, lineHeight: 1.1, fontFamily: FONTE.forte, letterSpacing: -0.2 },
  ficha: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COR.line,
    borderRadius: 4,
    marginBottom: 18,
  },
  fichaItem: { flexGrow: 1, flexBasis: 0, paddingVertical: 8, paddingHorizontal: 10, gap: 3 },
  fichaDivisa: { borderLeftWidth: 1, borderLeftColor: COR.line },
  rodadaCab: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COR.ink,
  },
  h2: { fontSize: 12, fontFamily: FONTE.forte },
  resumo: { flexDirection: "row", alignItems: "center", gap: 10, fontSize: 8.5 },
  resumoItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  ponto: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COR.line,
  },
  pontoSituacao: { width: 62, paddingTop: 1 },
  pontoCorpo: { flex: 1, gap: 4 },
  pontoTitulo: { fontFamily: FONTE.forte, fontSize: 9.5 },
  esperadoLinha: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  medida: { fontFamily: FONTE.medida, fontSize: 9 },
  tentativa: { gap: 2 },
  tentativaLinha: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  situacaoTexto: { flexDirection: "row", alignItems: "center", gap: 3 },
  palavra: { fontFamily: FONTE.forte, fontSize: 7, letterSpacing: 0.6, textTransform: "uppercase" },
  meta: { fontSize: 8, lineHeight: 1.35, color: COR.inkMuted },
  corrido: { fontSize: 9, lineHeight: 1.35 },
  causa: { borderLeftWidth: 2, borderLeftColor: COR.divergencia, paddingLeft: 6, gap: 2 },
  decisao: {
    borderWidth: 1,
    borderColor: COR.line,
    borderRadius: 4,
    backgroundColor: COR.surface,
    padding: 8,
    marginTop: 8,
    marginBottom: 18,
    gap: 4,
  },
  decisaoLinha: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  fotos: { flexDirection: "row", gap: 6, marginTop: 2, flexWrap: "wrap" },
  foto: { width: 120, height: 90, objectFit: "cover", borderRadius: 2 },
  legenda: { fontFamily: FONTE.codigo, fontSize: 6, color: COR.inkMuted, width: 120, marginTop: 2 },
});

/** Situação do ponto: ✓ Dentro / ✕ Fora / Sem resposta, sempre com a palavra. */
function SituacaoPonto({ situacao }: { situacao: "ok" | "divergente" | "pendente" }) {
  if (situacao === "pendente") {
    return <Text style={[s.palavra, { color: COR.inkMuted }]}>Sem resposta</Text>;
  }
  const ok = situacao === "ok";
  const cor = ok ? COR.nivel : COR.divergencia;
  return (
    <View style={s.situacaoTexto}>
      <Icone tipo={ok ? "ok" : "fora"} cor={cor} />
      <Text style={[s.palavra, { color: cor }]}>{ok ? "Dentro" : "Fora"}</Text>
    </View>
  );
}

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

function ItemFicha({ rotulo, valor, primeiro }: { rotulo: string; valor: string; primeiro?: boolean }) {
  return (
    <View style={primeiro ? s.fichaItem : [s.fichaItem, s.fichaDivisa]}>
      <Rotulo>{rotulo}</Rotulo>
      <Text style={s.corrido}>{textoPdf(valor)}</Text>
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
  const status = statusExecucao(r.status);
  return (
    <Document
      title={textoPdf(`${r.etapaNome} · ${r.localNome} — ${r.obraNome}`)}
      author="EngCheck"
      creator="EngCheck"
      producer="EngCheck"
    >
      <Page size="A4" style={s.pagina}>
        <Faixa />
        <Cabecalho tipo="Relatório de conferência" />

        <Text style={s.obra}>{textoPdf(r.obraNome)}</Text>
        <View style={s.tituloLinha}>
          <Text style={s.titulo}>{textoPdf(`${r.etapaNome} · ${r.localNome}`)}</Text>
          <Selo palavra={status.palavra} tom={status.tom} />
        </View>

        <View style={s.ficha}>
          <ItemFicha primeiro rotulo="Data prevista" valor={r.dataPrevista.split("-").reverse().join("/")} />
          <ItemFicha rotulo="Anunciada por" valor={`${r.anunciadaPor} em ${fmtData(r.criadoEm)}`} />
          <ItemFicha rotulo="Responsável" valor={r.engenheiroResponsavel.nome} />
          <ItemFicha rotulo="Rodadas" valor={String(r.rodadaAtual)} />
        </View>

        {r.rodadas.map((rod) => (
          <View key={rod.rodada} wrap>
            <View style={s.rodadaCab} wrap={false} minPresenceAhead={60}>
              <Text style={s.h2}>{`Rodada ${rod.rodada}`}</Text>
              <View style={s.resumo}>
                <View style={s.resumoItem}>
                  <Icone tipo="ok" cor={COR.nivel} />
                  <Text>{`${rod.ok} dentro da tolerância`}</Text>
                </View>
                <View style={s.resumoItem}>
                  <Icone tipo="fora" cor={COR.divergencia} />
                  <Text>{`${rod.divergentes} fora`}</Text>
                </View>
                {rod.pendentes ? (
                  <Text style={{ color: COR.inkMuted }}>{`${rod.pendentes} sem resposta`}</Text>
                ) : null}
              </View>
            </View>

            {rod.pontos.map((p) => (
              <View key={p.pontoId} style={s.ponto} wrap={false}>
                <View style={s.pontoSituacao}>
                  <SituacaoPonto situacao={p.situacao} />
                </View>
                <View style={s.pontoCorpo}>
                  <Text style={s.pontoTitulo}>{textoPdf(p.descricao)}</Text>
                  <View style={s.esperadoLinha}>
                    <Rotulo>Esperado</Rotulo>
                    <Text style={s.medida}>{textoPdf(p.esperado)}</Text>
                  </View>
                  {p.tentativas.map((t) => (
                    <View key={t.tentativa} style={s.tentativa}>
                      <View style={s.tentativaLinha}>
                        <Rotulo>{`${t.tentativa}ª medida`}</Rotulo>
                        <Text style={s.medida}>{textoPdf(t.texto)}</Text>
                        <View style={s.situacaoTexto}>
                          <Icone
                            tipo={t.dentro ? "ok" : "fora"}
                            cor={t.dentro ? COR.nivel : COR.divergencia}
                          />
                          <Text style={[s.palavra, { color: t.dentro ? COR.nivel : COR.divergencia }]}>
                            {t.dentro ? "Dentro da tolerância" : "Fora da tolerância"}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.meta}>
                        {textoPdf(
                          `${t.usuarioNome} · ${fmtData(t.criadoEm)} · ${CANAL[t.canal] ?? t.canal}${t.estruturada ? "" : " · resposta não estruturada"}`,
                        )}
                      </Text>
                      {t.observacao ? <Text style={s.meta}>{textoPdf(`Obs.: ${t.observacao}`)}</Text> : null}
                      <Fotos midias={t.midias} fotos={fotos} />
                    </View>
                  ))}
                  {p.divergencia ? (
                    <View style={s.causa}>
                      <Rotulo style={{ color: COR.divergencia }}>Causa provável</Rotulo>
                      <Text style={s.corrido}>
                        {textoPdf(
                          `${p.divergencia.causa}${p.divergencia.descricao ? ` — ${p.divergencia.descricao}` : ""}`,
                        )}
                      </Text>
                      <Fotos midias={p.divergencia.midias} fotos={fotos} />
                    </View>
                  ) : null}
                </View>
              </View>
            ))}

            <View style={s.decisao} wrap={false}>
              {rod.decisao ? (
                <>
                  <View style={s.decisaoLinha}>
                    <Selo
                      palavra={rod.decisao.decisao === "liberada" ? "Liberada" : "Recusada"}
                      tom={rod.decisao.decisao === "liberada" ? "nivel" : "divergencia"}
                    />
                    <Text style={s.corrido}>
                      {textoPdf(
                        `por ${rod.decisao.engenheiroNome} em ${fmtData(rod.decisao.criadoEm)} · ${CANAL[rod.decisao.canal] ?? rod.decisao.canal}`,
                      )}
                    </Text>
                  </View>
                  {rod.decisao.justificativa ? (
                    <Text style={s.corrido}>{textoPdf(`Justificativa: ${rod.decisao.justificativa}`)}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ color: COR.inkMuted }}>Sem decisão do engenheiro nesta rodada.</Text>
              )}
            </View>
          </View>
        ))}

        <Rodape
          texto={(pagina, total) =>
            textoPdf(`Execução ${r.id} · gerado em ${fmtData(geradoEm)} · página ${pagina}/${total}`)
          }
          nota="A comparação medido × projetado é feita por regra determinística; a liberação é decisão do engenheiro responsável."
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
