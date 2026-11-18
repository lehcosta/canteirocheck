package leitor;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.jar.Manifest;
import org.mpxj.ProjectFile;
import org.mpxj.Task;
import org.mpxj.reader.UniversalProjectReader;

/**
 * Leitor de cronograma: recebe os bytes de um arquivo do MS Project (MPP ou XML) e devolve as
 * tarefas em JSON. Sem estado e sem disco: o arquivo só existe na memória do pedido.
 *
 * <pre>
 * GET  /health → 200 {"ok":true}
 * POST /ler    → 200 {"versao":{…},"projeto":{…},"tarefas":[…]}
 *                400 arquivo que o MPXJ não reconhece ou não consegue ler (falha definitiva)
 *                413 arquivo acima do limite
 *                504 leitura passou do tempo
 * </pre>
 */
public final class Servidor {
  private static final int PORTA = inteiro("PORT", 8091);
  private static final int MAX_BYTES = inteiro("LER_MAX_BYTES", 64 * 1024 * 1024);
  private static final int TIMEOUT_MS = inteiro("LER_TIMEOUT_MS", 60_000);
  private static final int CONCORRENCIA = inteiro("LER_CONCORRENCIA", 2);
  private static final String[] VERSOES = versoes();

  private Servidor() {}

  public static void main(String[] args) throws IOException {
    ExecutorService leitores = Executors.newFixedThreadPool(CONCORRENCIA);
    HttpServer servidor = HttpServer.create(new InetSocketAddress(PORTA), 16);
    servidor.setExecutor(Executors.newCachedThreadPool());
    servidor.createContext("/health", troca -> responder(troca, 200, "{\"ok\":true}"));
    servidor.createContext("/ler", troca -> {
      try {
        ler(troca, leitores);
      } catch (RuntimeException e) {
        log("erro", e.toString());
        responder(troca, 500, erro("erro_interno", "Falha inesperada na leitura."));
      }
    });
    servidor.start();
    log("pronto", "porta " + PORTA + ", mpxj " + VERSOES[1]);
  }

  private static void ler(HttpExchange troca, ExecutorService leitores) throws IOException {
    if (!"POST".equals(troca.getRequestMethod())) {
      responder(troca, 405, erro("metodo", "Use POST."));
      return;
    }
    byte[] dados;
    try (InputStream corpo = troca.getRequestBody()) {
      dados = corpo.readNBytes(MAX_BYTES + 1);
    }
    if (dados.length > MAX_BYTES) {
      responder(troca, 413, erro("grande_demais", "Arquivo acima do limite."));
      return;
    }
    if (dados.length == 0) {
      responder(troca, 400, erro("arquivo_invalido", "Arquivo vazio."));
      return;
    }
    long inicio = System.nanoTime();
    Future<ProjectFile> leitura =
        leitores.submit(() -> new UniversalProjectReader().read(new ByteArrayInputStream(dados)));
    ProjectFile projeto;
    try {
      projeto = leitura.get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
    } catch (TimeoutException e) {
      leitura.cancel(true);
      responder(troca, 504, erro("tempo_esgotado", "A leitura passou do tempo."));
      return;
    } catch (ExecutionException e) {
      // O MPXJ lança MPXJException (e às vezes RuntimeException) para arquivo corrompido.
      log("recusado", String.valueOf(e.getCause()));
      responder(troca, 400, erro("arquivo_invalido", "Não consegui ler o arquivo do MS Project."));
      return;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      responder(troca, 503, erro("interrompido", "Leitura interrompida."));
      return;
    }
    if (projeto == null) {
      responder(troca, 400, erro("arquivo_invalido", "O arquivo não é um cronograma do MS Project."));
      return;
    }
    String json = paraJson(projeto);
    log("lido", dados.length + " bytes em " + (System.nanoTime() - inicio) / 1_000_000 + " ms");
    responder(troca, 200, json);
  }

  /** Só as linhas que o Gantt desenha: fora a tarefa-resumo do projeto (nível 0), as linhas em branco e as inativas. */
  static String paraJson(ProjectFile projeto) {
    List<Task> tarefas = new ArrayList<>();
    for (Task t : projeto.getTasks()) {
      Integer nivel = t.getOutlineLevel();
      if (nivel == null || nivel < 1) continue;
      if (t.getName() == null || t.getName().isBlank()) continue;
      if (!t.getActive()) continue;
      tarefas.add(t);
    }
    tarefas.sort(Comparator.comparing(Task::getID, Comparator.nullsLast(Comparator.naturalOrder())));

    StringBuilder s = new StringBuilder(256 + tarefas.size() * 160);
    s.append("{\"versao\":{\"leitor\":").append(texto(VERSOES[0]));
    s.append(",\"mpxj\":").append(texto(VERSOES[1])).append("}");
    s.append(",\"projeto\":{\"nome\":").append(texto(projeto.getProjectProperties().getName()));
    s.append(",\"inicio\":").append(data(projeto.getProjectProperties().getStartDate()));
    s.append(",\"termino\":").append(data(projeto.getProjectProperties().getFinishDate())).append("}");
    s.append(",\"tarefas\":[");
    boolean primeira = true;
    for (Task t : tarefas) {
      if (!primeira) s.append(',');
      primeira = false;
      Number pct = t.getPercentageComplete();
      long percentual = pct == null ? 0 : Math.max(0, Math.min(100, Math.round(pct.doubleValue())));
      s.append("{\"uid\":").append(t.getUniqueID() == null ? t.getID() : t.getUniqueID());
      s.append(",\"nome\":").append(texto(t.getName().strip()));
      s.append(",\"nivel\":").append(t.getOutlineLevel());
      s.append(",\"resumo\":").append(t.getSummary());
      s.append(",\"marco\":").append(t.getMilestone());
      s.append(",\"inicio\":").append(data(t.getStart()));
      s.append(",\"termino\":").append(data(t.getFinish()));
      s.append(",\"percentual\":").append(percentual).append('}');
    }
    return s.append("]}").toString();
  }

  private static String data(LocalDateTime d) {
    return d == null ? "null" : "\"" + d.toLocalDate() + "\"";
  }

  static String texto(String v) {
    if (v == null) return "null";
    StringBuilder s = new StringBuilder(v.length() + 2).append('"');
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      switch (c) {
        case '"' -> s.append("\\\"");
        case '\\' -> s.append("\\\\");
        case '\n' -> s.append("\\n");
        case '\r' -> s.append("\\r");
        case '\t' -> s.append("\\t");
        default -> {
          if (c < 0x20) s.append(String.format("\\u%04x", (int) c));
          else s.append(c);
        }
      }
    }
    return s.append('"').toString();
  }

  private static String erro(String codigo, String mensagem) {
    return "{\"codigo\":" + texto(codigo) + ",\"erro\":" + texto(mensagem) + "}";
  }

  private static void responder(HttpExchange troca, int status, String json) throws IOException {
    byte[] corpo = json.getBytes(StandardCharsets.UTF_8);
    troca.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    troca.sendResponseHeaders(status, corpo.length);
    try (OutputStream saida = troca.getResponseBody()) {
      saida.write(corpo);
    }
  }

  private static int inteiro(String nome, int padrao) {
    String v = System.getenv(nome);
    return v == null || v.isBlank() ? padrao : Integer.parseInt(v.trim());
  }

  /** [versão do leitor, versão do MPXJ], gravadas no manifesto do jar pelo pom.xml. */
  private static String[] versoes() {
    try (InputStream m = Servidor.class.getResourceAsStream("/META-INF/MANIFEST.MF")) {
      if (m != null) {
        var atributos = new Manifest(m).getMainAttributes();
        String leitor = atributos.getValue("Leitor-Versao");
        String mpxj = atributos.getValue("Mpxj-Versao");
        if (leitor != null && mpxj != null) return new String[] {leitor, mpxj};
      }
    } catch (IOException e) {
      // cai no padrão abaixo
    }
    return new String[] {"dev", "desconhecida"};
  }

  private static void log(String evento, String detalhe) {
    System.out.println("{\"evento\":" + texto("leitor." + evento) + ",\"detalhe\":" + texto(detalhe) + "}");
  }
}
