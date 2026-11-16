# Referência — WhatsApp Cloud API + WhatsApp Flows (docs oficiais da Meta)

Consultado em **2026-11-15**. Fonte única: developers.facebook.com. As URLs antigas `developers.facebook.com/docs/whatsapp/...` redirecionam para `developers.facebook.com/documentation/business-messaging/whatsapp/...`; abaixo cito as URLs resolvidas. Cada página também existe em `.md` (acrescente `.md` ao final da URL).
Os nomes de campos, JSON e código estão como aparecem nos docs. Quando algo não está escrito nos docs, aparece como **NÃO CONFIRMADO**.

## 0. Versões e descontinuações

| Item | Valor nos docs |
| --- | --- |
| Graph API nos exemplos atuais | `v27.0` (encryption, text, reply buttons). A página "Send a Flow" ainda mostra `v16.0`/`v18.0`. |
| Flow JSON `version` | **7.3 (Recommended)**. Para publicar: 5.1, 6.0–6.3, 7.0–7.2, 7.3. Para enviar: 2.1, 3.0, 3.1, 4.0, 5.0, 5.1, 6.x, 7.x |
| `data_api_version` | `3.0` e **`4.0` (Recommended)** |
| `flow_message_version` | `3` |
| Versões congeladas (frozen) | 2.1, 3.0, 3.1, 4.0 desde 08/04/2025; 5.0 desde 10/09/2025. Frozen = não dá para publicar, mas ainda dá para enviar e abrir. Expired = não dá para enviar nem abrir. |
| `data_channel_uri` | Descontinuado. A partir do Flow JSON 3.0, a URL vai em `endpoint_uri` (Flows API ou Builder). |
| Data API 4.0 (nov/2025) | Acrescenta `flow_token_signature` (JWT) e verificação feita pela plataforma. Para ativar: `"data_api_version": "4.0"` no Flow JSON. |
| WhatsApp Web | Suporta Flows desde dez/2025. |

Fontes: …/flows/changelogs · …/flows/guides/versioning · …/flows/guides/flowjson

---

## 1. Endpoint de dados do Flow

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint · …/flows/guides/whatsapp-business-encryption · …/flows/reference/error-codes · …/flows/guides/bestpractices · …/flows/guides/healthmonitoring

### 1.1 Par de chaves e upload da chave pública

- Use uma chave RSA de 2048 bits: `openssl genrsa -des3 -out private.pem 2048` e depois `openssl rsa -in private.pem -outform PEM -pubout -out public.pem`.
- Upload: `POST /PHONE_NUMBER_ID/whatsapp_business_encryption`, como `application/x-www-form-urlencoded`, com o parâmetro `business_public_key` (string, **Required**). A Meta assina a chave no upload. Isso precisa ser feito **para cada phone number**.
- Autenticação: system user access token com a permissão `whatsapp_business_messaging`.

```bash
curl -X POST \
  'https://graph.facebook.com/v27.0/PHONE_NUMBER_ID/whatsapp_business_encryption' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'business_public_key=BUSINESS_PUBLIC_KEY'
```
Resposta: `{ "success": true }`. Consulta: `GET` no mesmo path retorna `business_public_key` e `business_public_key_signature_status` (`VALID | MISMATCH`).
- Faça o upload de novo ao re-registrar o número ou ao receber os alertas `public-key-missing` / `public-key-signature-verification`.
- Requisitos do servidor: aceitar `POST`, usar HTTPS com certificado TLS válido (esse certificado não tem relação com a criptografia do payload).
- Para Flows com endpoint, a URL vai em `endpoint_uri` e é preciso vincular um app Meta (`application_id`) pela Flows API (…/flows/guides/flowsapi).

### 1.2 Request (corpo HTTP)

```json
{
"encrypted_flow_data": "<ENCRYPTED_FLOW_DATA>",
"encrypted_aes_key": "<ENCRYPTED_AES_KEY>",
"initial_vector": "<INITIAL_VECTOR>"
}
```
Os três campos são `string` e **Required**: `encrypted_flow_data` (payload cifrado), `encrypted_aes_key` (chave AES de 128 bits, cifrada) e `initial_vector` (IV de 128 bits). **Toda** requisição vem cifrada, inclusive o ping.

**Assinatura:** a Meta assina todas as requisições ao endpoint com SHA256 e envia o valor no header `X-Hub-Signature-256`, no formato `sha256=<hex>`. A chave é o App Secret do app vinculado ao Flow. Para validar, calcule a assinatura sobre o payload e compare com o que vem depois de `sha256=`. Se falhar, responda **432** (ver 1.5). Para trocar o App Secret sem downtime, aceite o secret antigo e o novo por X horas.

### 1.3 Criptografia (data_api_version "3.0")

**Decifrar a requisição**
1. Decodifique `encrypted_aes_key` de base64 e decifre com a chave privada usando **RSA/ECB/OAEPWithSHA-256AndMGF1Padding**, com SHA256 também no MGF1. O resultado é uma chave de payload de **128 bits**.
2. Decodifique `encrypted_flow_data` e `initial_vector` de base64 e decifre com **AES-GCM** (`aes-128-gcm`). A **tag de 128 bits fica nos últimos 16 bytes** do array cifrado.
3. O resultado é um JSON em UTF-8.

**Cifrar a resposta**
1. Converta o JSON da resposta para bytes UTF-8.
2. Calcule o IV da resposta **invertendo todos os bits do IV da requisição** (XOR de cada byte com `0xFF`).
3. Cifre com AES-GCM usando a mesma chave, o IV invertido, **AAD vazio** e tag de 128 bits (16 bytes).
4. Concatene `ciphertext || tag`, codifique em **base64** e envie no corpo **como texto puro**. O exemplo dos docs responde `HTTP/2 200` com `content-type: text/plain`.

**Se não conseguir decifrar:** responda **HTTP 421**. O cliente baixa a chave pública de novo e repete a requisição.

**Data API 4.0:** o guia só descreve a criptografia "para data_api_version 3.0", e o campo `version` da requisição aparece como "must be set to `3.0`". O valor de `version` e qualquer diferença de criptografia na 4.0 são **NÃO CONFIRMADO**.

Exemplo oficial em Node (Express), trecho de cripto copiado como está nos docs:
```ts
const decryptRequest = (body: any, privatePem: string) => {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  // Decrypt the AES key created by the client
  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privatePem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64"),
  );

  // Decrypt the Flow data
  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");

  const TAG_LENGTH = 16;
  const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    decryptedAesKey,
    initialVectorBuffer,
  );
  decipher.setAuthTag(encrypted_flow_data_tag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encrypted_flow_data_body),
    decipher.final(),
  ]).toString("utf-8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
};

const encryptResponse = (
  response: any,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer,
) => {
  // Flip the initialization vector
  const flipped_iv = [];
  for (const pair of initialVectorBuffer.entries()) {
    flipped_iv.push(~pair[1]);
  }
  // Encrypt the response data
  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    Buffer.from(flipped_iv),
  );
  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
};
```
Repositório de exemplo citado nos docs: github.com/WhatsApp/WhatsApp-Flows-Tools (examples/endpoint/nodejs/basic e book-appointment).

### 1.4 Payloads decifrados por `action`

**Data exchange (`INIT` | `BACK` | `data_exchange`)**
```json
{
"version": "<VERSION>",
"action": "<ACTION_NAME>",
"screen": "<SCREEN_NAME>",
"data": {
"prop_1": "value_1",
…
"prop_n": "value_n"
},
"flow_token": "<FLOW-TOKEN>"
}
```
- `version`: "Value must be set to `3.0`".
- `action`: `INIT` quando o Flow abre e foi enviado com `flow_action: "data_exchange"`; `BACK` quando o usuário volta de uma tela com `refresh_on_back: true` (nesse caso `screen` é a tela de onde ele saiu); `data_exchange` quando uma tela é enviada com `on-click-action.name = "data_exchange"`. O endpoint também é chamado quando há `on-select-action` em algum componente.
- Em `INIT` e `BACK`, `screen` e `data` podem vir vazios. `data` contém o `payload` da ação.
- `flow_token_signature` (string) só vem com Flow JSON >= 7.3 **e** `data_api_version` >= 4.0. É um JWT HS256 assinado com o App Secret, com o `flow_token` no payload. Verificar é opcional.
- `"SUCCESS"` é nome reservado e não pode ser id de tela.

**Resposta "próxima tela"**, usada em todas as trocas menos a última:
```json
{
"screen": "<SCREEN_NAME>",
"data": {
"property_1": "value_1",
...
"property_n": "value_n",
"error_message": "<ERROR-MESSAGE>"
}
}
```
`screen` e `data` são Required. Se `data.error_message` estiver presente, o usuário vai para `<SCREEN_NAME>` e aparece um **snackbar** com o erro. Esse é o mecanismo de "devolver a mesma tela com erro". **Os docs não mostram campo `version` na resposta.**

**Resposta final**, que fecha o Flow:
```json
{
"screen": "SUCCESS",
"data": {
"extension_message_response": {
"params": {
"flow_token": "<FLOW_TOKEN>",
"optional_param1": "<value1>",
"optional_param2": "<value2>"
}
}
}
}
```
`params.flow_token` é **Required**. Todos os `params` vão para o webhook de mensagens dentro de `nfm_reply.response_json` (ver 5.4). Os docs recomendam mandar uma mensagem de resumo no chat.

**Notificação de erro**, enviada quando o endpoint respondeu algo inválido:
```json
{
"version": "<VERSION>",
"flow_token": "<FLOW-TOKEN>",
"action": "data_exchange | INIT",
"data": {
"error": "<ERROR-KEY>",
"error_message": "<ERROR-MESSAGE>"
}
}
```
[A tabela dos docs marca `screen` como Required, mas o exemplo não traz esse campo.] Resposta esperada:
```json
{
"data": {
"acknowledged": true
}
}
```

**Health check**, também cifrado:
```json
{
"version": "3.0",
"action": "ping"
}
```
Resposta, também cifrada:
```json
{
"data": {
"status": "active"
}
}
```

### 1.5 Códigos HTTP do endpoint

| HTTP | Situação | Efeito no cliente |
| --- | --- | --- |
| 421 | O payload não pode ser decifrado | Busca a chave pública de novo e reenvia. Se falhar de novo, mostra erro genérico e gera o alerta `business-decryption-error`. |
| 432 | Falha na autenticação da assinatura da requisição | Erro genérico. |
| 427 | O Flow token não é mais válido | Erro genérico e o **CTA fica desabilitado**. Dá para mostrar uma mensagem própria (exemplo abaixo). Para continuar, envie uma nova mensagem com um token novo. |

```text
HTTP/2 427
content-type: application/json
content-length: 51
date: Wed, 06 Jul 2022 14:03:03 GMT

{"error_msg": "The order has already been placed"}
```
Outros tipos de erro, que chegam via alerta de webhook ou pela notificação de erro: `timeout_error` (mais de 10 s), `no_http_response_error`, `unexpected_http_status_code` (por exemplo 500), `response-decryption-error`, `invalid-screen-transition` (a tela retornada não bate com o `routing_model`), `payload-schema-error` (os `data` não batem com o schema da tela), `public-key-missing`, `public-key-signiture-verification`, `cannot_be_served`, `missing_capability`. [A página de error codes escreve `public-key-signiture-verification` e o guia do endpoint escreve `public-key-signature-verification`. Trate as duas grafias.]

### 1.6 Timeout, latência e saúde

- **Timeout: 10 segundos** (bestpractices e error-codes). Meta de latência: menos de 1 s. O alerta de latência dispara no p90 acima de 1s, 5s e 7s, calculado em janelas de 30 min.
- Se as métricas pioram, o Flow passa de `PUBLISHED` para **`THROTTLED`** (no máximo 10 envios do Flow por hora; Cloud API retorna erro `132069`) e depois para **`BLOCKED`** (não envia nem abre; erro `132068`). A volta para PUBLISHED é automática quando o endpoint se recupera.
- Checagens para publicar: número conectado, chave pública assinada, endpoint URI, app vinculado, Flow JSON válido, versões válidas, endpoint respondendo ao ping e WABA inscrito nos webhooks de Flows.
- `flow_token`: os docs recomendam expiração de 2 a 3 dias. Se houver limite de tempo, conte a partir do `INIT`.

---

## 2. Flow JSON

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowjson · …/flows/guides/components · …/flows/reference/error-codes

### 2.1 Topo e tela

```json
{
 "version": "3.1",
 "data_api_version": "3.0",
 "routing_model": {"MY_FIRST_SCREEN": ["MY_SECOND_SCREEN"] },
 "screens": [...]
}
```
```json
"screen" : {
  "id": string,
  "terminal": ?boolean,
  "success": ?boolean,
  "title": ?string,
  "refresh_on_back": ?boolean,
  "data": ?object,
  "layout": object
}
```
- `version` e `screens` são obrigatórios. Com endpoint, o validador exige também `routing_model` e `data_api_version`.
- `id`: `SUCCESS` é reservado. `terminal`: pode haver várias telas terminais, e cada uma **precisa ter Footer**. `success`: default `true`. `sensitive` (>= 5.1): lista de campos mascarados no resumo.
- `data` é declarado em JSON Schema, e o **`__example__` é obrigatório**:
```json
{
  "data": {
    "first_name": {
      "type": "string",
      "__example__": "John"
    }
  }
}
```
- `layout`: `{"type": "SingleColumnLayout", "children": [...]}`. Este é o único layout disponível.
- Tipos seguem a RFC 8927. **`null` não é suportado**: um valor `null` faz a validação falhar. Para indicar ausência, omita a chave ou use `''`.
- Limite do Flow JSON: 10 MB.

### 2.2 Routing model e regras

- O `routing_model` mapeia o id de cada tela para a lista de telas de destino. Só é obrigatório com endpoint.
- Regras, citadas dos docs:
  1. "Route cannot be the current screen, but the route can be "refreshed" for validation purposes."
  2. Se existe aresta A→B, o usuário pode ir e voltar entre A e B com o botão BACK.
  3. Só se declaram rotas para frente. Declarar A→B e também B→A gera erro.
  4. A lista de destinos pode ser vazia.
  5. Tem que existir uma tela de entrada, ou seja, uma tela sem arestas de entrada.
  6. Toda rota termina numa tela terminal.
- O validador também rejeita: loop (`Loop detected in the routing model`), tela desconectada, tela ausente do `routing_model`, e navigate sem rota correspondente.
- Cada tela pode ter **no máximo 10 ramos** de saída: "Number of branches exceeds the max limit of 10 for screen".
- Cada Flow pode ter **no máximo 100 telas** (`MAX_SCREENS_NUMBER`).
- Cada tela pode ter **no máximo 50 componentes**.
- Uma resposta do endpoint que leve a uma tela fora do routing gera o erro `invalid-screen-transition` no cliente.

### 2.3 Referências dinâmicas e Form

- `"${data.campo}"` lê dados da tela (vindos do endpoint ou do payload de `navigate`). `"${form.campo}"` lê o valor de um input, pelo `name`.
- Referência global (>= 4.0): `${screen.<screen_name>.(form | data).<field-name>}`. Funciona em props dinâmicas, payloads de ação, títulos e componentes condicionais. Também pode apontar para telas futuras, desde que o valor vazio seja tratado.
- O componente **`Form` é opcional desde o Flow JSON 4.0**. Sem Form, cada input usa `init-value` e `error-message`. Com Form, usam-se `init-values` e `error-messages` (objeto `{nome: valor}`, que também pode ser dinâmico com `"${data.error_messages}"`).
- Há dois mecanismos de erro: `data.error_message` na resposta do endpoint mostra um **snackbar**; `error-message` no componente (via `${data.x}`) mostra erro **por campo**.

### 2.4 Ações (`on-click-action`, `on-select-action`)

| Ação | Uso |
| --- | --- |
| `navigate` | Vai para `next: {"type":"screen","name":...}`, com `payload` estático. **Não use no Footer de tela terminal**, porque impede o término do Flow. |
| `data_exchange` | Manda o `payload` para o endpoint. Exige `data_api_version`. |
| `complete` | Encerra o Flow. O `payload` chega no webhook (`nfm_reply`). Vale para telas `terminal`. A recomendação é não mandar imagens em base64. |
| `update_data` | (>= 6.0) Atualiza o estado da tela atual sem ida ao servidor. |
| `open_url` | (>= 6.0) Só aceita `url`. |

```json
{
  "type": "Footer",
  "label": "Submit data",
  "on-click-action": {
    "name": "data_exchange",
    "payload": {
      "discount_code": "${data.discount_code}",
      "items": "${form.selected_items}"
    }
  }
}
```

### 2.5 Componentes (props principais e limites)

| Componente | Props | Limites |
| --- | --- | --- |
| `TextHeading` / `TextSubheading` | `text` (req), `visible` | 80 / 80 caracteres; não aceita vazio |
| `TextBody` / `TextCaption` | `text` (req), `font-weight` {'bold','italic','bold_italic','normal'}, `strikethrough`, `visible`, `markdown` (>= 5.1) | 4096 / 409 [sic] caracteres |
| `TextInput` | `label` (req), `name` (req), `input-type` {'text','number','email','password','passcode','phone'}, `pattern` (>= 6.2; nesse caso `helper-text` é obrigatório), `required`, `min-chars`, `max-chars` (default 80), `helper-text`, `visible`, `init-value`, `error-message` (>= 4.0, fora de Form). A 7.0 acrescenta `label-variant`. | **label 20**, helper-text 80, **error 30** caracteres |
| `TextArea` | `label` (req), `name` (req), `required`, `max-length` (default 600), `helper-text`, `enabled`, `visible`, `init-value`, `error-message` | label 20, helper 80 |
| `RadioButtonsGroup` | `name` (req), `data-source` (req; `Array< id: String, title: String, description, metadata, enabled, ...>`), `label` (obrigatório a partir de 4.0), `required`, `enabled`, `visible`, `on-select-action` (`data_exchange`, `update_data`), `description`, `init-value`, `error-message` | label/title 30, description 300, metadata 20; de 1 a 20 opções |
| `CheckboxGroup` | igual ao Radio + `min-selected-items`/`max-selected-items` | igual ao Radio |
| `Dropdown` | `label` (req), `data-source` (req), `required`, `enabled`, `visible`, `on-select-action`, `init-value`, `error-message` | label 20, title 30; até 200 opções (100 se houver imagens) |
| `Footer` | `label` (req), `on-click-action` (req), `left-caption`/`right-caption` ou `center-caption`, `enabled` | label 35, captions 15; **no máximo 1 Footer por tela** |
| `OptIn` | `label` (req), `name` (req), `required`, `on-click-action` ("Read more"), `visible` | 120 caracteres; no máximo 5 por tela |
| `EmbeddedLink` | `text` (req), `on-click-action` (req) | 25 caracteres; no máximo 2 por tela |
| `If` (>= 4.0) | `condition` (req; expressão booleana com pelo menos um valor dinâmico), `then` (req), `else` | Até 3 níveis aninhados. Footer só no primeiro nível e, se existir, nos dois ramos. Componentes aceitos em `then`/`else`: TextHeading, TextSubheading, TextBody, TextCaption, CheckboxGroup, DatePicker, Dropdown, EmbeddedLink, Footer, Image, OptIn, RadioButtonsGroup, Switch, TextArea, TextInput, If (e ChipsSelector a partir de 7.1). **PhotoPicker não está na lista.** |
| `Switch` (>= 4.0) | `value` (req), `cases` (req; não pode ser vazio) | Mesma lista de componentes, sem If/Switch. **Sem PhotoPicker.** |

- Todo componente tem `visible` (boolean ou dinâmico), que serve para renderização condicional sem usar `If`.
- Operadores do `If`: `==`, `!=`, `&&`, `||`, `!`, `>`, `>=`, `<`, `<=`, `()`.
- Em `data-source` dinâmico, declare `type: array` com `items: {type: object, properties: {id: {type: string}, title: {type: string}}}` e coloque um `__example__` concreto.

---

## 3. PhotoPicker e mídia no endpoint

Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/media_upload · …/flows/reference/error-codes

**PhotoPicker** (>= 4.0):
| Prop | Detalhe |
| --- | --- |
| `type` (req) | `PhotoPicker` |
| `name` (req) | único na tela |
| `label` (req) | máx. 80 caracteres |
| `description` | máx. 300 caracteres |
| `photo-source` | `'camera_gallery'` (default), `'camera'`, `'gallery'` |
| `max-file-size-kb` | default 25600 (25 MiB), faixa [1, 25600] |
| `min-uploaded-photos` | default 0 (0 = opcional), faixa [0, 30] |
| `max-uploaded-photos` | default 30, faixa [1, 30] |
| `enabled`, `visible` | boolean ou dinâmico |
| `error-message` | string, ou objeto `{"media_id_1" : "error_message 1", ...}` para erro por foto |

Restrições:
- **1 PhotoPicker por tela**, e PhotoPicker e DocumentPicker não podem estar na mesma tela.
- Não pode ser inicializado com `init-values`.
- **Não pode ir no payload de `navigate`.** Para ler o valor em outra tela, use referência global.
- Só pode ser usado como **valor string de primeiro nível** no payload de `data_exchange` ou `complete`. Válido: `"media": "${form.photo_picker}"`. Inválido: `"media": {"photo": "${form.photo_picker}"}`.
- Em `complete`, só se `max-uploaded-photos` for no máximo 1. Na mensagem de resposta cabem no máximo 10 arquivos, somando até 100 MiB. Os limites de 0 a 30 valem para o envio via `data_exchange`.

**O que o endpoint recebe** em `data` (exemplo copiado como está; o original tem vírgula faltando depois de `file_name` e chaves não fechadas):
```json
"photo_picker":[{
     "media_id": "790aba14-5f4a-4dbd-aa9e-0d75401da14b",
     "cdn_url": "https://mmg.whatsapp.net/v/redacted",
     "file_name": "IMG_5237.jpg"
     "encryption_metadata": {
       "encrypted_hash": "/QvkBvpBED2q2AHPIFuhXfLpkn22zj2kO6ggzjvhHv0=",
       "iv": "5SHjLrrsfPXTSJTcbrVSkg==",
       "encryption_key": "lPa4SXcWbk3sy2so3OxjyXmpV4aE6CcIKd+4byr5hBw=",
       "hmac_key": "15l+E9Z5gcL15WH9OQ8GgK7VVCKkfbVigoSiM9djvGU=",
       "plaintext_hash": "AOF2dHXVEpm9efk9udNy3R1cUJWnpjFwQKGBEdALqXI="
     }]
```
- Os arquivos ficam no CDN do WhatsApp **por até 20 dias**, cifrados com AES256-CBC + HMAC-SHA256 + pkcs7. O endpoint **precisa** baixar, decifrar e validar cada arquivo.
- O arquivo no CDN é `cdn_file = ciphertext & hmac10`, onde `hmac10` são os 10 primeiros bytes do HMAC-SHA256, colados no final.
- Passos, como nos docs:
  1. Baixe `cdn_file` de `cdn_url`.
  2. Confira se SHA256(`cdn_file`) == `enc_hash` [no JSON o campo se chama `encrypted_hash`].
  3. Calcule o HMAC-SHA256 com `hmac_key` sobre `iv` + ciphertext e confira se os 10 primeiros bytes == `hmac10`. [A ordem iv‖ciphertext é dedução minha. O texto diz "Calculate HMAC with `hmac_key`, initialization vector (`encryption_metadata.iv`) and ciphertext".]
  4. Decifre com AES-CBC usando `encryption_key` e `iv`, depois remova o padding pkcs7 (blocos de 16 bytes).
  5. Confira se SHA256(`decrypted_media`) == `plaintext_hash`.
- O decode base64 das chaves e o tamanho de 32 bytes da `encryption_key` não estão escritos nos docs (**NÃO CONFIRMADO**). A descrição "AES256" e as chaves de exemplo, que têm 32 bytes em base64, sugerem isso.
- Por `complete`, o `response_json` do webhook traz `[{"file_name","mime_type","sha256","id"}]`, e o download segue o fluxo normal de mídia (seção 6).

---

## 4. Envio de mensagens — `POST /{phone-number-id}/messages`

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages · …/messages/text-messages · …/messages/interactive-reply-buttons-messages · …/templates/overview · …/templates/utility-templates/utility-templates · …/flows/guides/sendingaflow · …/reference/whatsapp-business-account/message-template-api

Header: `Authorization: Bearer <ACCESS_TOKEN>`. O destino vai em `to` (telefone) ou em `recipient` (BSUID; ver 5.5).

**Texto** (`body` com até 4096 caracteres):
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+16505551234",
  "type": "text",
  "text": {
    "preview_url": true,
    "body": "As requested, here's the link to our latest product: https://www.meta.com/quest/quest-3/"
  }
}
```

**Botões de resposta** (no máximo 3; `id` até 256 caracteres; `title` até **20** caracteres e único; body até 1024; footer até 60):
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<WHATSAPP_USER_PHONE_NUMBER>",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": {<MESSAGE_HEADER>},
    "body": { "text": "<BODY_TEXT>" },
    "footer": { "text": "<FOOTER_TEXT>" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "<BUTTON_ID>", "title": "<BUTTON_LABEL_TEXT>" } }
      ]
    }
  }
}
```

**Template com parâmetros no body.** O exemplo abaixo usa parâmetros posicionais. Com parâmetros nomeados, acrescente `"parameter_name": "first_name"` a cada item.
```json
{
"messaging_product": "whatsapp",
"recipient_type": "individual",
"to": "+16505551234",
"type": "template",
"template": {
  "name": "order_confirmation",
  "language": {
    "code": "en_US"
  },
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Jessica" },
        { "type": "text", "text": "SKBUP2-4CPIG9" }
      ]
    }
  ]
}
}
```
O template só pode ser enviado com status `APPROVED`. Templates utility aceitam: 1 header, 1 body, 1 footer e até 10 botões dos tipos Call request, Copy code, Phone number, Quick-reply e URL. **FLOW não aparece nessa lista** (ver Divergências).

**Mensagem interativa de Flow** (só dentro da janela de 24h):
```json
{
  "recipient_type": "individual",
  "messaging_product": "whatsapp",
  "to": "whatsapp-id",
  "type": "interactive",
  "interactive": {
    "type": "flow",
    "header": { "type": "text", "text": "Flow message header" },
    "body": { "text": "Flow message body" },
    "footer": { "text": "Flow message footer" },
    "action": {
      "name": "flow",
      "parameters": {
        "flow_message_version": "3",
        "flow_token": "AQAAAAACS5FpgQ_cAAAAAD0QI3s.",
        "flow_id": "123456",
        "flow_cta": "Book!",
        "flow_action": "navigate",
        "flow_action_payload": {
          "screen": "<SCREEN_NAME>",
          "data": "{\"product_name\":\"name\",\"product_description\":\"description\",\"product_price\":100}"
        }
      }
    }
  }
}
```
- [O original mostra `"flow_name": "appointment_booking_v1", //or` antes de `flow_id`. Deixei só `flow_id`.]
- Use `flow_id` **ou** `flow_name`, nunca os dois.
- `flow_cta`: recomendação de até 30 caracteres, sem emoji.
- `flow_token`: default `"unused"`.
- `mode`: `draft` ou `published` (default).
- `flow_action`: `navigate` (default) ou `data_exchange`. Com `data_exchange`, o endpoint recebe `INIT` e **`flow_action_payload` deve ser omitido**.
- `flow_action_payload.screen`: precisa ser uma tela de entrada (default `FIRST_ENTRY_SCREEN`).
- `flow_action_payload.data`: os docs se contradizem. Uma tabela dá o tipo `String` e diz "Must be a non-empty object"; outra diz "non-empty JSON object serialized as a string"; o exemplo usa string JSON.

**Template com botão FLOW.** Criação via `POST /<WABA_ID>/message_templates`. O botão tem `type: "FLOW"`, `text` (até 25 caracteres) e um destes: `flow_id`, `flow_name` ou `flow_json`. Opcionais: `flow_action` (`navigate`|`data_exchange`) e `navigate_screen`. Todos os exemplos dos docs usam `"category": "MARKETING"`. Envio:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "PHONE_NUMBER",
  "type": "template",
  "template": {
    "name": "TEMPLATE_NAME",
    "language": { "code": "LANGUAGE_AND_LOCALE_CODE" },
    "components": [
      {
        "type": "button",
        "sub_type": "flow",
        "index": "0",
        "parameters": [
          {
            "type": "action",
            "action": {
              "flow_token": "FLOW_TOKEN",
              "flow_action_data": { }
            }
          }
        ]
      }
    ]
  }
}
```
[Tirei do original os comentários `//optional, default is "unused"` (em `flow_token`) e `// optional, json object with the data payload for the first screen` (em `flow_action_data`, que no original é `{ ... }`).]

**Resposta do envio.** Indica só que a API aceitou a mensagem, não que ela foi entregue:
```json
{
  "messaging_product": "whatsapp",
  "contacts": [ { "input": "+16505551234", "wa_id": "16505551234" } ],
  "messages": [ { "id": "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA" } ]
}
```
`messages[0].message_status` só aparece em template sob pacing. A ordem de entrega não é garantida. O TTL padrão é de 30 dias (10 min para templates de autenticação).

---

## 5. Webhooks

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint · …/webhooks/overview · …/webhooks/reference/messages/{text,image,audio,interactive,button,status} · …/flows/guides/flowswebhooks

### 5.1 Verificação (GET)
`GET <CALLBACK_URL>?hub.mode=subscribe&hub.challenge=<HUB.CHALLENGE>&hub.verify_token=<HUB.VERIFY_TOKEN>`. Se `hub.verify_token` for igual ao token configurado, responda **200 com o valor de `hub.challenge`** no corpo; caso contrário, responda 4xx. O certificado TLS precisa ser válido (self-signed não é aceito).

### 5.2 POST e assinatura
- Header `X-Hub-Signature-256: sha256=<SHA256_PAYLOAD_HASH>`, que é um HMAC-SHA256 do corpo com o **App Secret** como chave. Compare com o que vem depois de `sha256=`.
- Responda 200. Se a resposta não for 200, a Meta tenta de novo com frequência decrescente por até **7 dias**, e podem chegar duplicatas, então deduplique.
- Um lote tem até 1000 updates, mas o envio em lote não é garantido. O payload tem até 3 MB.

### 5.3 Envelope
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "<WHATSAPP_BUSINESS_ACCOUNT_ID>",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "<BUSINESS_DISPLAY_PHONE_NUMBER>",
              "phone_number_id": "<BUSINESS_PHONE_NUMBER_ID>"
            },
            "contacts": [
              {
                "profile": { "name": "<WHATSAPP_USER_PROFILE_NAME>", "username": "<USERNAME>" },
                "wa_id": "<WHATSAPP_USER_ID>",
                "user_id": "<BSUID>"
              }
            ],
            "messages": [ { "from": "<WHATSAPP_USER_PHONE_NUMBER>", "from_user_id": "<BSUID>", "id": "<WHATSAPP_MESSAGE_ID>", "timestamp": "<WEBHOOK_TRIGGER_TIMESTAMP>", "type": "text", "text": { "body": "<MESSAGE_TEXT_BODY>" } } ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```
[Resumido da página de text messages: tirei os comentários `<!-- -->` e os campos opcionais `parent_user_id`, `identity_key_hash`, `context` e `referral`.] Atualizações de status chegam em `value.statuses[]`, no mesmo campo `messages`.

### 5.4 Tipos de mensagem (objeto dentro de `messages[]`)
- `text`: `{"body": "..."}`.
- `image`: `{"caption","mime_type","sha256","id","url"}`.
- `audio`: `{"mime_type","sha256","id","url","voice": <bool>}`. Exemplo de mime: `audio/ogg; codecs=opus`.
  - O campo `url` está sendo liberado aos poucos desde 12/11/2025 e talvez ainda não apareça. O `id` sempre vem.
- `interactive` com `button_reply`: `"interactive": {"type": "button_reply", "button_reply": {"id": "<BUTTON_ID>", "title": "<BUTTON_LABEL_TEXT>"}}`, mais `context: {from, id}` da mensagem original. Existe também `list_reply`.
- `button` (quick reply de template): `"button": {"payload": "<BUTTON_LABEL_TEXT>", "text": "<BUTTON_LABEL_TEXT>"}`, mais `context`.
- Resposta de Flow (`nfm_reply`):
```json
{
  "messages": [{
    "context": { "from": "16315558151", "id": "gBGGEiRVVgBPAgm7FUgc73noXjo" },
    "from": "<USER_ACCOUNT_NUMBER>",
    "from_user_id": "<BSUID>",
    "id": "<MESSAGE_ID>",
    "type": "interactive",
    "interactive": {
      "type": "nfm_reply",
      "nfm_reply": {
        "name": "flow",
        "body": "Sent",
        "response_json": "{\"flow_token\": \"<FLOW_TOKEN>\", \"optional_param1\": \"<value1>\", \"optional_param2\": \"<value2>\"}"
      }
    },
    "timestamp": "<MESSAGE_SEND_TIMESTAMP>"
  }]
}
```
`response_json` é uma **string**, então é preciso fazer `JSON.parse`. **O `flow_id` não vem**: identifique o Flow pelo `flow_token` ou por um campo próprio no payload.

### 5.5 Identificador do usuário (BSUID)
Os docs avisam: "Use `user_id` and `from_user_id` to identify the WhatsApp user. `wa_id` and `from` are omitted when the user has adopted a username and their phone number is unavailable". Para enviar a um BSUID, troque `to` por `recipient`. Um BSUID tem a forma `US.13491208655302741918`.

### 5.6 Status
```json
"statuses": [
  {
    "id": "<WHATSAPP_MESSAGE_ID>",
    "status": "<STATUS>",
    "timestamp": "<WEBHOOK_TRIGGER_TIMESTAMP>",
    "recipient_id": "<USER_PHONE_NUMBER_OR_GROUP_ID>",
    "recipient_user_id": "<BSUID>",
    "conversation": { "id": "<CONVERSATION_ID>", "expiration_timestamp": "<...>", "origin": { "type": "<CONVERSATION_CATEGORY>" } },
    "pricing": {
      "billable": <IS_BILLABLE?>,
      "pricing_model": "<PRICING_MODEL>",
      "type": "<PRICING_TYPE>",
      "category": "<PRICING_CATEGORY>"
    },
    "errors": [ { "code": <ERROR_CODE>, "title": "<ERROR_TITLE>", "message": "<ERROR_MESSAGE>", "error_data": { "details": "<ERROR_DETAILS>" }, "href": "<ERROR_CODES_URL>" } ]
  }
]
```
- `status`: `sent`, `delivered`, `read`, `failed`, `played` (este último para mensagem de voz).
- `pricing` só vem com `sent` e com `delivered` ou `read`. `conversation` é **omitido a partir da v24.0**, exceto em janela de free entry point.
- `pricing_model`: `PMP` (por mensagem). `CBP` só aparece em webhooks anteriores a 01/07/2025.
- `category`: `utility`, `service`, `marketing`, `authentication`, etc.
- `type`: `regular` (cobrado), `free_customer_service`, `free_entry_point`.
- `billable` vai ser descontinuado. Para saber se houve cobrança, use `type` + `category`.

---

## 6. Download de mídia

Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media

1. `GET https://graph.facebook.com/<API_VERSION>/<MEDIA_ID>?phone_number_id=<BUSINESS_PHONE_NUMBER_ID>` (o `phone_number_id` é opcional) retorna:
```json
{
  "messaging_product": "whatsapp",
  "url": "<MEDIA_URL>",
  "mime_type": "<MEDIA_MIME_TYPE>",
  "sha256": "<SHA_256_HASH>",
  "file_size": "<MEDIA_FILE_SIZE>",
  "id": "<MEDIA_ID>"
}
```
2. Faça `GET <MEDIA_URL>` com `Authorization: Bearer <token>`. Sem o token, a chamada falha. A resposta é o binário, com `content-type` igual ao MIME.
- A **URL expira em 5 minutos**. Um media ID vindo de webhook vale **7 dias**; um ID de upload vale 30 dias. Se der `404`, peça uma URL nova e tente de novo.
- Mídia recebida pode ter até 100 MB. Acima disso chega o erro `131052`. Imagens enviadas: JPEG/PNG/WebP de até 5 MB. Áudio: até 16 MB.

---

## 7. Janela de 24h e preços

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows · …/pricing · …/webhooks/reference/messages/status

- **Janela de atendimento (CSW):** uma mensagem ou ligação do usuário abre uma janela de 24h, e cada nova mensagem reinicia o prazo. Com a janela aberta, a empresa pode mandar mensagens não-template (texto, interativo, inclusive Flow interativo). Com a janela fechada, **só template**. Só é permitido mandar mensagem a quem fez opt-in.
- **Modelo de cobrança:** por mensagem **entregue** desde 01/07/2025. O preço depende da categoria (marketing, utility, authentication, service) e do código de país do destinatário. Utility e authentication têm faixas de volume.
- **Desde 01/10/2026, já em vigor hoje:**
  - Utility enviada **dentro** da janela passou a ser cobrada (`pricing.type` mudou de `free_customer_service` para `regular`).
  - Service (não-template) é cobrada a partir da **1.001ª mensagem do mês por número**. As primeiras 1.000 são grátis, sem acúmulo de saldo.
  - Sem forma de pagamento cadastrada, a Meta **para de entregar** service messages quando a cota grátis acaba.
- Não há cobrança por mensagens do usuário para a empresa, nem dentro da janela de free entry point.

---

## 8. Número de teste, Flows e verificação

Fontes: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started · …/business-phone-numbers/phone-numbers · …/flows/guides/sendingaflow · …/flows/guides/testingdebugging · …/flows/guides/flowsapi

- O Get Started gera e registra um número **de teste** automaticamente. No API Setup, escolhe-se o "From" e adiciona-se um "To".
  - Limite de destinatários do número de teste: **NÃO CONFIRMADO**. Nenhuma das páginas consultadas informa.
- Para enviar Flow, o pré-requisito escrito é: "You will need to [verify your business]" e manter boa qualidade de mensagens. Se dá para testar um Flow com endpoint usando o número de teste sem verificar o negócio: **NÃO CONFIRMADO**.
- Testes sem publicar:
  - O "interactive preview" do Builder chama o endpoint de verdade, com requisições cifradas, e tem um teste de health check.
  - Um Flow em `DRAFT` pode ser enviado a um aparelho com `"mode": "draft"` (aparece um banner de aviso). Antes, o aparelho precisa ter mandado uma mensagem, para a janela de 24h estar aberta.
- Pela Flows API, `POST /<WABA_ID>/flows` cria o Flow com `name`, `categories`, `flow_json`, `publish`, `endpoint_uri`. O `application_id` liga o app (obrigatório para Flows com endpoint).
- Edição de Flow publicado: a Flows API diz que um Flow `PUBLISHED` "cannot be deleted or updated afterwards". O changelog de dez/2024 diz que Flows publicados podem ser editados pelo Builder. Para mudar o `routing_model` de um Flow publicado, os docs de erro mandam clonar, editar e publicar de novo.

---

## Divergências com o design

Premissas (a)–(d):
- **(a) Confirmada.** Os docs dizem: "Route cannot be the current screen, but the route can be "refreshed" for validation purposes". A resposta `{screen: <mesma>, data: {..., error_message}}` mostra um snackbar. Para erro por campo, use `error-message` via `${data.x}`.
- **(b) Confirmada, com restrições.** O PhotoPicker funciona em `data_exchange` (até 30 fotos) e em `complete` (só com `max-uploaded-photos` ≤ 1), sempre como string de primeiro nível no payload. Em `navigate` é proibido. Há 1 PhotoPicker por tela, sem DocumentPicker junto.
- **(c) Confirmada.** São no máximo 100 telas (`MAX_SCREENS_NUMBER`). Também valem: 10 ramos por tela, 50 componentes por tela, 10 MB de JSON.
- **(d) Confirmada.** A resposta é `base64(ciphertext || tag16)` com AES-128-GCM, IV com bits invertidos e AAD vazio, enviada como texto puro (`text/plain` no exemplo).

Divergências e pontos novos:
1. **A resposta não tem `version`.** Os docs mostram só `{screen, data}`, `{data:{status:"active"}}` e `{data:{acknowledged:true}}`. Se incluir `version` causa erro: NÃO CONFIRMADO.
2. **Botão FLOW em template UTILITY: NÃO CONFIRMADO.** A página de utility templates não lista FLOW entre os botões aceitos. A Template API aceita `"FLOW"` sem restringir categoria, mas todos os exemplos de Flow usam `MARKETING`. Isso afeta a viabilidade e o custo.
3. **Preços desde 01/10/2026.** Utility dentro da janela **é cobrada**, e service é cobrada depois de 1.000 mensagens por mês por número. A premissa "utility grátis na janela" está desatualizada.
4. **PhotoPicker não pode ficar dentro de `If` nem de `Switch`.** Para mostrar ou esconder, use `visible` dinâmico.
5. **Data API 4.0** é a recomendada e traz `flow_token_signature`, que exige Flow JSON ≥ 7.3. Mas o guia de criptografia e o `version: "3.0"` da requisição só estão documentados para a 3.0. O comportamento na 4.0 é NÃO CONFIRMADO.
6. **`null` é rejeitado** nos dados das telas: omita a chave. O `__example__` é obrigatório em todo campo de `data`.
7. **Limites de texto curtos para português:** TextInput `label` 20 e `error-message` 30; Dropdown `label` 20; Footer 35; título do Radio 30.
8. **Identificar o usuário pelo BSUID** (`from_user_id`/`user_id`). `from`/`wa_id` podem não vir.
9. O webhook do Flow **não traz `flow_id`**. Use o `flow_token`, que também deve servir para responder 427 quando expirar.
10. **Fotos do CDN do Flow ficam até 20 dias.** É preciso baixar e decifrar logo no `data_exchange` e responder em até 10 s; o alvo de latência é < 1 s. Pode valer a pena fazer o processamento pesado de forma assíncrona.
