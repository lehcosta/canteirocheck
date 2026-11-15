/**
 * Flow JSON versionado em código. Restrições da Meta (docs/referencia-meta-whatsapp.md §2–3):
 * rotas só para frente, no máximo 10 ramos por tela e 100 telas, nada de `null` nos dados,
 * `__example__` obrigatório, PhotoPicker fora de If/Switch (usa `visible`) e só como valor de
 * primeiro nível em `data_exchange`/`complete`.
 *
 * O checklist tem uma tela de entrada (INICIO), pares MEDIR_x/CAUSA_x por ponto e RESUMO.
 * INICIO alcança qualquer MEDIR (reabrir no meio continua do ponto pendente), por isso a sessão
 * tem no máximo 9 pontos: 9 MEDIR + RESUMO = 10 ramos.
 */

export const VERSAO_FLOW_JSON = "7.3";
export const VERSAO_DATA_API = "3.0";

export const FLOWS = {
  checklist: "canteiro_checklist_v1",
  anuncio: "canteiro_anuncio_v1",
  justificativa: "canteiro_justificativa_v1",
} as const;
export type NomeFlow = (typeof FLOWS)[keyof typeof FLOWS];

export const MAX_PONTOS_FLOW = 9;
const LETRAS = "ABCDEFGHI";

export const TELAS = {
  inicio: "INICIO",
  resumo: "RESUMO",
  anuncio: "ANUNCIO",
  justificar: "JUSTIFICAR",
  medir: (indice: number) => `MEDIR_${letra(indice)}`,
  causa: (indice: number) => `CAUSA_${letra(indice)}`,
} as const;

function letra(indice: number) {
  const l = LETRAS[indice];
  if (!l) throw new Error(`índice de ponto fora do Flow: ${indice}`);
  return l;
}

/** "MEDIR_C" → { tipo: "medir", indice: 2 }. */
export function lerTelaDoChecklist(tela: string): { tipo: "medir" | "causa"; indice: number } | null {
  const m = /^(MEDIR|CAUSA)_([A-I])$/.exec(tela);
  if (!m?.[1] || !m[2]) return null;
  return { tipo: m[1] === "MEDIR" ? "medir" : "causa", indice: LETRAS.indexOf(m[2]) };
}

// ─────────────────────────── Dados de cada tela (o endpoint preenche) ───────────────────────────

export interface Opcao {
  id: string;
  title: string;
}

export interface DadosInicio {
  titulo: string;
  texto: string;
  aviso: string;
  tem_aviso: boolean;
}

export interface DadosMedir {
  progresso: string;
  descricao: string;
  esperado: string;
  referencia_nivel: string;
  aviso: string;
  tem_aviso: boolean;
  simples: boolean;
  interface: boolean;
  existencia: boolean;
  ajuda_medida: string;
  ajuda_referencia: string;
  ajuda_novo: string;
  foto_descricao: string;
}

export interface DadosCausa {
  progresso: string;
  descricao: string;
  falha: string;
  causas: Opcao[];
}

export interface DadosResumo {
  titulo: string;
  texto: string;
  status: string;
}

export interface DadosAnuncio {
  saudacao: string;
  etapas: Opcao[];
  locais: Opcao[];
  quando: Opcao[];
  aviso: string;
  tem_aviso: boolean;
}

export interface DadosJustificar {
  titulo: string;
  resumo: string;
}

// ─────────────────────────── Builders ───────────────────────────

type Json = Record<string, unknown>;

const SIM_NAO: Opcao[] = [
  { id: "sim", title: "Sim" },
  { id: "nao", title: "Não" },
];

function exemplo<T extends object>(campos: { [K in keyof T]: T[K] }): Json {
  const props: Json = {};
  for (const [k, v] of Object.entries(campos)) {
    if (Array.isArray(v)) {
      props[k] = {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } },
        __example__: v,
      };
    } else {
      props[k] = { type: typeof v === "boolean" ? "boolean" : "string", __example__: v };
    }
  }
  return props;
}

const EX_MEDIR: DadosMedir = {
  progresso: "Ponto 1 de 3 · Laje L4",
  descricao: "Interface L3/L4 — borda da L3 × forma da L4",
  esperado: "Esperado: 6,000 m ± 0,5 cm",
  referencia_nivel: "Referência de nível: RN-01",
  aviso: "❌ Fora da tolerância (+4 cm). Meça de novo.",
  tem_aviso: false,
  simples: false,
  interface: true,
  existencia: false,
  ajuda_medida: "Em metros. Ex.: 6,005",
  ajuda_referencia: "Borda da L3, em metros",
  ajuda_novo: "Forma da L4, em metros",
  foto_descricao: "Obrigatória neste ponto",
};

function telaMedir(indice: number): Json {
  const id = TELAS.medir(indice);
  return {
    id,
    title: "Conferência",
    data: exemplo(EX_MEDIR),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextSubheading", text: "${data.progresso}" },
        { type: "TextBody", text: "${data.descricao}" },
        { type: "TextBody", text: "${data.esperado}", "font-weight": "bold" },
        { type: "TextCaption", text: "${data.referencia_nivel}" },
        { type: "TextBody", text: "${data.aviso}", "font-weight": "bold", visible: "${data.tem_aviso}" },
        {
          type: "TextInput",
          name: "medida",
          label: "Medida",
          "input-type": "number",
          required: false,
          "helper-text": "${data.ajuda_medida}",
          visible: "${data.simples}",
        },
        {
          type: "TextInput",
          name: "referencia",
          label: "Lado executado",
          "input-type": "number",
          required: false,
          "helper-text": "${data.ajuda_referencia}",
          visible: "${data.interface}",
        },
        {
          type: "TextInput",
          name: "novo",
          label: "Lado novo",
          "input-type": "number",
          required: false,
          "helper-text": "${data.ajuda_novo}",
          visible: "${data.interface}",
        },
        {
          type: "RadioButtonsGroup",
          name: "mesma_rn",
          label: "Mesma referência de nível?",
          "data-source": SIM_NAO,
          required: false,
          visible: "${data.interface}",
        },
        {
          type: "RadioButtonsGroup",
          name: "existe",
          label: "Está executado?",
          "data-source": SIM_NAO,
          required: false,
          visible: "${data.existencia}",
        },
        {
          type: "PhotoPicker",
          name: "foto",
          label: "Foto",
          description: "${data.foto_descricao}",
          "photo-source": "camera_gallery",
          "min-uploaded-photos": 0,
          "max-uploaded-photos": 1,
          "max-file-size-kb": 10240,
        },
        { type: "TextArea", name: "obs", label: "Observação", required: false, "max-length": 300 },
        {
          type: "Footer",
          label: "Enviar medida",
          "on-click-action": {
            name: "data_exchange",
            payload: {
              acao: "medir",
              medida: "${form.medida}",
              referencia: "${form.referencia}",
              novo: "${form.novo}",
              mesma_rn: "${form.mesma_rn}",
              existe: "${form.existe}",
              foto: "${form.foto}",
              obs: "${form.obs}",
            },
          },
        },
      ],
    },
  };
}

const EX_CAUSA: DadosCausa = {
  progresso: "Ponto 1 de 3 · Laje L4",
  descricao: "Interface L3/L4 — borda da L3 × forma da L4",
  falha: "❌ Confirmado: L4 6,040 m × L3 6,000 m (+4 cm; tolerância ± 0,5 cm)",
  causas: [
    { id: "forma_fora_do_nivel", title: "Forma montada fora do nível" },
    { id: "outro", title: "Outro" },
  ],
};

function telaCausa(indice: number): Json {
  return {
    id: TELAS.causa(indice),
    title: "Divergência",
    data: exemplo(EX_CAUSA),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextSubheading", text: "${data.progresso}" },
        { type: "TextBody", text: "${data.descricao}" },
        { type: "TextBody", text: "${data.falha}", "font-weight": "bold" },
        {
          type: "RadioButtonsGroup",
          name: "causa",
          label: "Causa provável",
          "data-source": "${data.causas}",
          required: true,
        },
        { type: "TextArea", name: "detalhe", label: "Detalhe", required: false, "max-length": 500 },
        {
          type: "PhotoPicker",
          name: "foto",
          label: "Foto da situação",
          description: "Mostre o ponto medido",
          "photo-source": "camera_gallery",
          "min-uploaded-photos": 1,
          "max-uploaded-photos": 1,
          "max-file-size-kb": 10240,
        },
        {
          type: "Footer",
          label: "Registrar e continuar",
          "on-click-action": {
            name: "data_exchange",
            payload: {
              acao: "causa",
              causa: "${form.causa}",
              detalhe: "${form.detalhe}",
              foto: "${form.foto}",
            },
          },
        },
      ],
    },
  };
}

export function flowChecklist(): Json {
  const routing: Record<string, string[]> = {
    [TELAS.inicio]: [...Array.from({ length: MAX_PONTOS_FLOW }, (_, i) => TELAS.medir(i)), TELAS.resumo],
  };
  for (let i = 0; i < MAX_PONTOS_FLOW; i++) {
    const proximo = i + 1 < MAX_PONTOS_FLOW ? [TELAS.medir(i + 1)] : [];
    routing[TELAS.medir(i)] = [TELAS.causa(i), ...proximo, TELAS.resumo];
    routing[TELAS.causa(i)] = [...proximo, TELAS.resumo];
  }
  routing[TELAS.resumo] = [];

  const inicio = {
    id: TELAS.inicio,
    title: "Conferência",
    data: exemplo<DadosInicio>({
      titulo: "Concretagem · Laje L4",
      texto: "3 pontos para medir. Interfaces primeiro.",
      aviso: "",
      tem_aviso: false,
    }),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: "${data.titulo}" },
        { type: "TextBody", text: "${data.texto}" },
        { type: "TextBody", text: "${data.aviso}", "font-weight": "bold", visible: "${data.tem_aviso}" },
        {
          type: "Footer",
          label: "Começar",
          "on-click-action": { name: "data_exchange", payload: { acao: "comecar" } },
        },
      ],
    },
  };
  const resumo = {
    id: TELAS.resumo,
    title: "Resumo",
    terminal: true,
    data: exemplo<DadosResumo>({
      titulo: "Concretagem · Laje L4",
      texto: "✅ Eixo A: 6,005 m\n❌ Interface L3/L4: +4 cm",
      status: "Execução bloqueada. A engenheira será avisada.",
    }),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: "${data.titulo}" },
        { type: "TextBody", text: "${data.texto}", markdown: true },
        { type: "TextBody", text: "${data.status}", "font-weight": "bold" },
        {
          type: "Footer",
          label: "Enviar conferência",
          "on-click-action": { name: "data_exchange", payload: { acao: "concluir" } },
        },
      ],
    },
  };

  return {
    version: VERSAO_FLOW_JSON,
    data_api_version: VERSAO_DATA_API,
    routing_model: routing,
    screens: [
      inicio,
      ...Array.from({ length: MAX_PONTOS_FLOW }, (_, i) => [telaMedir(i), telaCausa(i)]).flat(),
      resumo,
    ],
  };
}

export function flowAnuncio(): Json {
  return {
    version: VERSAO_FLOW_JSON,
    data_api_version: VERSAO_DATA_API,
    routing_model: { [TELAS.anuncio]: [] },
    screens: [
      {
        id: TELAS.anuncio,
        title: "O que vai ser executado?",
        terminal: true,
        data: exemplo<DadosAnuncio>({
          saudacao: "Edifício Teste",
          etapas: [{ id: "3", title: "Concretagem" }],
          locais: [{ id: "l4", title: "Laje L4" }],
          quando: [
            { id: "hoje", title: "Hoje" },
            { id: "amanha", title: "Amanhã" },
          ],
          aviso: "",
          tem_aviso: false,
        }),
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextBody", text: "${data.saudacao}" },
            {
              type: "Dropdown",
              name: "etapa",
              label: "Etapa",
              "data-source": "${data.etapas}",
              required: true,
            },
            {
              type: "CheckboxGroup",
              name: "locais",
              label: "Locais",
              "data-source": "${data.locais}",
              required: true,
              "min-selected-items": 1,
            },
            {
              type: "RadioButtonsGroup",
              name: "quando",
              label: "Quando?",
              "data-source": "${data.quando}",
              required: true,
              "init-value": "amanha",
            },
            { type: "TextBody", text: "${data.aviso}", "font-weight": "bold", visible: "${data.tem_aviso}" },
            {
              type: "Footer",
              label: "Anunciar",
              "on-click-action": {
                name: "data_exchange",
                payload: {
                  acao: "anunciar",
                  etapa: "${form.etapa}",
                  locais: "${form.locais}",
                  quando: "${form.quando}",
                },
              },
            },
          ],
        },
      },
    ],
  };
}

export function flowJustificativa(): Json {
  return {
    version: VERSAO_FLOW_JSON,
    data_api_version: VERSAO_DATA_API,
    routing_model: { [TELAS.justificar]: [] },
    screens: [
      {
        id: TELAS.justificar,
        title: "Decisão",
        terminal: true,
        data: exemplo<DadosJustificar>({
          titulo: "Recusar concretagem · L4",
          resumo: "❌ Interface L3/L4: +4 cm (forma montada fora do nível)",
        }),
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextHeading", text: "${data.titulo}" },
            { type: "TextBody", text: "${data.resumo}", markdown: true },
            {
              type: "TextArea",
              name: "justificativa",
              label: "Justificativa",
              required: true,
              "max-length": 1000,
            },
            {
              type: "Footer",
              label: "Confirmar",
              "on-click-action": {
                name: "data_exchange",
                payload: { acao: "justificar", justificativa: "${form.justificativa}" },
              },
            },
          ],
        },
      },
    ],
  };
}

export function jsonDoFlow(nome: NomeFlow): Json {
  switch (nome) {
    case FLOWS.checklist:
      return flowChecklist();
    case FLOWS.anuncio:
      return flowAnuncio();
    case FLOWS.justificativa:
      return flowJustificativa();
  }
}
