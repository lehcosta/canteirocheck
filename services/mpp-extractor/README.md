# mpp-extractor

Lê um cronograma do MS Project (`.mpp` ou o XML do MS Project, MSPDI) e devolve as tarefas em JSON.
É um serviço à parte porque a única biblioteca que lê `.mpp` de verdade é o
[MPXJ](https://www.mpxj.org) (Java, LGPL-2.1-or-later): ele roda numa JVM isolada e o resto do
sistema fala com ele só por HTTP, como o `dwg-extractor`. Sem estado e sem disco: o arquivo só
existe na memória do pedido.

Quem chama é o job `ler_cronograma` do worker (`packages/servicos/src/cronogramas.ts`), que
valida a resposta com o `esquemaLeitura`. Mudou o JSON aqui, mude o esquema lá.

## Contrato

| Rota | Resposta |
|---|---|
| `GET /health` | `200 {"ok":true}` |
| `POST /ler` (corpo: os bytes do arquivo) | `200` com o JSON abaixo |
| | `400 {"codigo":"arquivo_invalido","erro":"…"}`: o MPXJ não reconhece ou não consegue ler (falha definitiva; o `erro` vai para a tela) |
| | `413`: acima de `LER_MAX_BYTES` |
| | `504`: passou de `LER_TIMEOUT_MS` (o worker tenta de novo) |

```json
{
  "versao": { "leitor": "0.1.0", "mpxj": "16.11.0" },
  "projeto": { "nome": "Cronograma_EdTeste_rev04", "inicio": "2026-08-03", "termino": "2027-06-30" },
  "tarefas": [
    { "uid": 1, "nome": "Infraestrutura", "nivel": 1, "resumo": true, "marco": false,
      "inicio": "2026-08-03", "termino": "2026-10-30", "percentual": 100 }
  ]
}
```

As tarefas vêm na ordem do arquivo (pelo ID). Ficam de fora a tarefa-resumo do projeto (nível 0),
as linhas em branco e as tarefas inativas. `inicio` e `termino` são `null` quando o arquivo não
traz a data.

## Rodar

```bash
docker compose -f infra/docker-compose.yml up -d --no-deps --wait mpp-extractor   # porta 58091
curl -s -X POST --data-binary @services/mpp-extractor/test/fixtures/cronograma.xml \
  http://localhost:58091/ler | head -c 400
```

Variáveis: `PORT` (8091), `LER_MAX_BYTES` (64 MB), `LER_TIMEOUT_MS` (60000), `LER_CONCORRENCIA` (2).
A memória da JVM vem de `JAVA_TOOL_OPTIONS` no Dockerfile (`-Xmx768m`).

## Trocar a versão do MPXJ

Mude `mpxj.version` no `pom.xml`, reconstrua a imagem e leia de novo o XML de `test/fixtures` e um
`.mpp` de verdade. Depois regrave `packages/servicos/test/fixtures/cronograma.leitura.json` com a
saída nova. O repositório não tem `.mpp` de fixture (o formato é binário e proprietário): a
leitura de `.mpp` se confere à mão.
