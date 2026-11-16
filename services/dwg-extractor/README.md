# dwg-extractor

Serviço HTTP pequeno e isolado que lê arquivos **DWG** com [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) (LibreDWG compilado para WebAssembly) e devolve as **entidades brutas** em JSON: camadas, textos, inserções de bloco com atributos, polilinhas e cotas.

Este serviço **não interpreta** nada: não limpa códigos MTEXT, não detecta ambientes, não lê marcas de nível nem carimbo. Isso fica no código proprietário do CanteiroCheck, que consome este serviço.

## Licença: por que é isolado

`@mlightcad/libredwg-web` (e o LibreDWG por baixo) é **GPL-3.0**. Por isso este serviço é **GPL-3.0-or-later** ([LICENSE](LICENSE)) e é uma unidade de deploy separada que conversa **só por HTTP**. O código proprietário nunca importa, empacota ou linka este pacote.

- **Não** é membro do workspace pnpm do monorepo (`pnpm-workspace.yaml` só inclui `apps/*` e `packages/*`). Tem `package.json` e `pnpm-lock.yaml` próprios.
- Consumidores copiam os tipos de [`src/contrato.ts`](src/contrato.ts); não importam deste pacote.

## Contrato

| Rota | Resposta |
| --- | --- |
| `GET /health` | `200 {"ok":true}` |
| `POST /extrair` (corpo = bytes do DWG, `Content-Type: application/octet-stream`) | `200` com `ResultadoExtracao` |

O cabeçalho opcional `X-Request-Id` é devolvido na resposta (sucesso ou erro). O `Content-Type` não é verificado: qualquer corpo é lido como bytes do DWG.

Erros têm sempre o formato `{"erro": "<mensagem>", "codigo": "<código>"}`:

| Status | `codigo` | Quando |
| --- | --- | --- |
| 400 | `arquivo_invalido` | Corpo vazio, sem assinatura `ACxxxx`, ou o LibreDWG devolve erro crítico (≥ `DWG_ERR_CRITICAL`) |
| 404 | `nao_encontrado` | Rota desconhecida |
| 413 | `arquivo_muito_grande` | Corpo acima de 60 MiB (62 914 560 bytes). Com `Content-Length` (ou `Expect: 100-continue`) é recusado antes do upload |
| 500 | `falha_interna` | Qualquer outra falha (conversão, worker que morreu…) |
| 504 | `timeout` | A requisição passou de `EXTRAIR_TIMEOUT_MS` (espera na fila + extração); o worker é encerrado |

Resposta `200` (tipos em [`src/contrato.ts`](src/contrato.ts)):

```ts
interface ResultadoExtracao {
  versao: { extrator: string; libredwgWeb: string }; // extrator = versão do package.json
  dwg: { versao: string | null; unidades: string | null }; // "AC1015"; $INSUNITS cru como string ("6" = metros)
  camadas: { nome: string; desligada: boolean; congelada: boolean; entidades: number }[];
  textos: {
    tipo: "TEXT" | "MTEXT" | "ATTRIB" | "ATTDEF";
    conteudo: string; // cru: \P, \A1;, {\fArial|b1;...}, %%c preservados
    camada: string;
    x: number | null; y: number | null;
    altura: number | null;
    bloco: string | null;
    tag: string | null;
  }[];
  insercoes: { bloco: string; camada: string; x: number; y: number; atributos: { tag: string; valor: string }[] }[];
  polilinhas: { camada: string; fechada: boolean; vertices: [number, number][]; arcos: number }[];
  cotas: { camada: string; texto: string | null; medida: number | null; x: number | null; y: number | null }[];
}
```

### O que entra em cada lista

- **Espaços:** `textos`, `insercoes`, `polilinhas` e `cotas` incluem as entidades de nível superior do **espaço do modelo e de todos os espaços do papel** (`*Model_Space`, `*Paper_Space*`), sem marcação de origem, porque o carimbo costuma estar no papel. A ordem é: primeiro o modelo, depois o papel.
- **`camadas[].entidades`:** conta só as entidades de **nível superior do espaço do modelo**. Uma INSERT conta 1 na própria camada; ATTRIBs e o conteúdo da definição do bloco não contam; entidades do papel não contam.
- **Textos de blocos:** para cada INSERT (no modelo ou no papel) entram os seus ATTRIBs (`bloco` = nome do bloco, `tag` = tag) e os TEXT/MTEXT da definição do bloco (`bloco` = nome do bloco), **uma vez por INSERT**. A posição é transformada para o espaço da INSERT (ponto base, escala, rotação) e a altura é multiplicada pela escala Y. Blocos aninhados são expandidos recursivamente (até 8 níveis; `bloco` = bloco mais interno). Blocos anônimos de cota (`*D…`) não são inseridos, então o texto renderizado da cota não aparece em `textos`: use `cotas`.
- **Camada de textos de bloco:** é a camada **armazenada** na entidade. No AutoCAD, entidades na camada `0` dentro de um bloco herdam a camada da INSERT ao desenhar (é comum em carimbos). Ao filtrar `textos` por camada, considere também `insercoes[].camada`, que é a camada efetiva da inserção.
- **ATTDEF:** reportado quando está solto no modelo/papel. Dentro de um bloco só entra se for **constante** (não gera ATTRIB). Os demais ATTDEF são só o molde do ATTRIB.
- **Posições:** TEXT/ATTRIB/ATTDEF usam o primeiro ponto de alinhamento (grupo 10); MTEXT usa o ponto de inserção; cota usa o ponto médio do texto. `altura` é a altura armazenada (grupo 40).
- **`polilinhas`:** LWPOLYLINE e POLYLINE 2D. `fechada` vem do bit 512 do flag DWG da LWPOLYLINE (ou do bit 1 da POLYLINE). Bulges são ignorados nos vértices e contados em `arcos`. Polilinhas de dentro de blocos não entram.
- **`insercoes`:** só INSERTs de nível superior. Inserções aninhadas aparecem só via seus textos.
- **`cotas[].texto`:** texto de substituição como armazenado (`"<>"` incluído). `null` quando vazio, isto é, quando a cota mostra a medida.

## Rodar

Requer Node ≥ 22.18 (o worker usa o *type stripping* nativo do Node em dev/testes) e pnpm 10.

```bash
cd services/dwg-extractor
pnpm install --ignore-workspace   # SEMPRE com --ignore-workspace: lockfile próprio, fora do workspace
pnpm dev                          # tsx watch, http://localhost:8090
pnpm test                         # vitest
pnpm typecheck
pnpm build && pnpm start          # tsc → dist/, node dist/main.js
```

Docker:

```bash
docker build -t canteirocheck-dwg-extractor services/dwg-extractor
docker run --rm -p 8090:8090 canteirocheck-dwg-extractor
curl -X POST -H 'Content-Type: application/octet-stream' --data-binary @services/dwg-extractor/test/fixtures/amostra.dwg http://localhost:8090/extrair
```

A imagem é multi-stage (`node:22-slim`), roda como o usuário `node` (uid 1000), expõe 8090 e tem `HEALTHCHECK` em `/health`.

### Variáveis de ambiente

| Variável | Padrão | |
| --- | --- | --- |
| `PORT` | `8090` | |
| `EXTRAIR_TIMEOUT_MS` | `60000` | Prazo total por requisição |
| `EXTRAIR_CONCORRENCIA` | `2` | Workers simultâneos. Os demais esperam em fila, e a espera conta no prazo |

### Como a extração roda

O LibreDWG em WASM é síncrono. Cada `POST /extrair` sobe um `worker_threads` novo, transfere o corpo (sem copiar), espera a resposta e encerra o worker. Com isso o timeout consegue interromper um arquivo que trava (`worker.terminate()`), e a memória do WASM volta ao sistema a cada arquivo. O custo é de cerca de 130 ms por requisição (subir o worker e instanciar o WASM). Arquivos sem a assinatura `ACxxxx` são recusados na thread principal, sem subir worker.

## Fixture de teste

Não temos DWG real. [`test/fixtures/amostra.dxf`](test/fixtures/amostra.dxf) foi **escrito à mão** (R2000/AC1015) e contém:

- camadas `0`, `A-TEXTO`, `A-AMBIENTE`, `A-NIVEL`, `CARIMBO`, `A-COTA` e `A-OCULTA` (desligada e congelada);
- TEXT "SALA", "ÁREA: 18,50 m²" e "PILAR %%c30";
- MTEXT `{\fArial|b1;NOTA:} PISO A DEFINIR\PAGUARDANDO PROJETO DE AR CONDICIONADO`;
- LWPOLYLINE fechada 5 × 3,7 em `A-AMBIENTE`, LWPOLYLINE aberta com um bulge e POLYLINE 2D fechada;
- marcas de nível "+6,00" e "N.A. +3,05";
- bloco `CARIMBO` (TEXT fixo e ATTDEFs CLIENTE/FASE/REVISAO/DATA) inserido com ATTRIBs;
- uma cota linear rotacionada (medida 5);
- um TEXT no espaço do papel ("FOLHA 01/01").

O libredwg-web **não escreve DWG** (só `dwg_write_dxf`). Por isso o `amostra.dwg` é gerado pelo `dxf2dwg` do LibreDWG nativo:

```bash
brew install libredwg                   # testado com 0.13.3
./scripts/gerar-fixture.sh              # dxf2dwg -y --as r2000 + roda os testes de extração
```

O DWG gerado **é lido de volta pelo libredwg-web** (é o que os testes usam), com duas perdas causadas pelo encoder R2000 do `dxf2dwg` 0.13.3, e não pelo libredwg-web:

1. a altura do MTEXT (grupo 40) é gravada em `rect_width`, e `text_height` fica 0. Reordenar os grupos não resolve;
2. o flag "congelada" da camada (grupo 70, bit 1) é descartado. O "desligada" sobrevive como cor negativa.

Lendo o mesmo DXF pelo libredwg-web (`dxf_read_file`), os dois valores vêm certos. Os testes cobrem esse caminho para validar o mapeamento de `altura` e `congelada`. O `dxf2dwg` também avisa `Unknown DIMENSION_LINEAR.block *D1` (a cota perde a referência ao bloco anônimo), o que não afeta a extração.

## Limitações conhecidas (libredwg-web 0.9.0)

- **Escapes `\U+XXXX`** são decodificados para Unicode pelo próprio libredwg-web antes de chegarem aqui (`\U+00C1` → `Á`). Os demais códigos (`\P`, `{\f…;}`, `\A1;`, `%%c`) chegam intactos.
- **Camada desligada:** o conversor do libredwg-web não marca `off` quando o DWG grava a camada desligada como índice de cor negativo. O serviço lê a cor bruta via `dynapi` e corrige.
- **`dwg_read_data` engole erros:** o wrapper só avisa no console e devolve o ponteiro mesmo para lixo. O serviço usa `dwg_read_file` direto e trata `error ≥ 128` como arquivo inválido. Erros menores (avisos de CRC, classes desconhecidas) são comuns em arquivos reais e são ignorados.
- **MINSERT** não é convertida pelo libredwg-web e não aparece.
- **Blocos dinâmicos** aparecem com o nome anônimo da INSERT (`*U12`), sem resolver o nome efetivo.
- **Extrusão/OCS** é ignorada na transformação de textos de bloco (blocos espelhados por extrusão negativa saem com X invertido).
- Só os campos documentados acima. Hatch, linhas, arcos, círculos, leaders, tabelas e xrefs não são extraídos.
- **Memória:** um DWG grande pode ocupar centenas de MB de heap WASM por worker. Ajuste `EXTRAIR_CONCORRENCIA` à memória do container.
- O `dxf2dwg` só escreve até R2000, então a fixture não exercita leitura de DWG R2004+ (AC1018+). Validar com um DWG real assim que houver.
