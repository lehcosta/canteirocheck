"use client";

import {
  datasDoCheck,
  esperadaValida,
  MAXIMO_DE_PERGUNTAS,
  type Momento,
  proximaSaida,
  type TipoResposta,
  unidadeDaMedida,
} from "@canteirocheck/core";
import type { CheckDaFase, FaseDoCronograma } from "@canteirocheck/servicos";
import { Check, ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarCheckAction } from "@/features/checks/actions";
import { ddmm, diaCurto, esperadaLegivel, MOMENTO, plural, TIPO_NO_EDITOR } from "@/features/checks/textos";
import { cn } from "@/lib/utils";
import { Conta } from "../contas";

const ICONE = { "aria-hidden": true, strokeWidth: 2, strokeLinecap: "square" } as const;
const ROTULO = "text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const ERRO = "text-[13px] leading-[18px] text-destructive";
const TIPOS = Object.keys(TIPO_NO_EDITOR) as TipoResposta[];
const DIA_DA_SEMANA = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

/** As regras que o select oferece, com a do check sempre entre elas. */
function regras(momento: Momento, atual: number): { valor: number; rotulo: string }[] {
  const base =
    momento === "antes"
      ? [1, 2, 3, 5, 7, 10, 14]
      : momento === "durante"
        ? [1, 2, 3, 4, 5, 6, 7]
        : [1, 2, 3, 5, 10, 20];
  return [...new Set([...base, atual])]
    .sort((a, b) => a - b)
    .map((valor) => ({
      valor,
      rotulo:
        momento === "antes"
          ? valor === 0
            ? "No dia do início"
            : `${plural(valor, "dia", "dias")} antes do início`
          : momento === "durante"
            ? `${valor >= 6 ? "Todo" : "Toda"} ${DIA_DA_SEMANA[valor]}`
            : `${valor}º dia útil após o término`,
    }));
}

interface Rascunho {
  /** Chave da linha no formulário (a pergunta nova ainda não tem id). */
  chave: string;
  id?: string;
  texto: string;
  tipo: TipoResposta;
  /** Sem editor de opções no desenho aprovado: as da pergunta voltam intactas. */
  opcoes: string[];
  /**
   * As opções que a pergunta já tinha gravadas (as sugeridas pela IA). Sem elas, "Uma opção" não é
   * oferecida: sem editor de opções, a pergunta não teria como salvar.
   */
  opcoesGravadas: string[];
  esperada: string;
  pedeFoto: boolean;
}

/** Os tipos que o select oferece para a pergunta. */
const tiposDa = (p: Rascunho) => TIPOS.filter((t) => t !== "opcao" || p.opcoesGravadas.length >= 2);

/** O que a esperada pode ser, pelo tipo: Sim ou Não, uma das opções, ou a gravada, se valer para o tipo. */
function esperadas(p: Rascunho): { valor: string; rotulo: string }[] {
  const sem = { valor: "", rotulo: "Sem esperada" };
  if (p.tipo === "sim_nao") return [{ valor: "Sim", rotulo: "Sim" }, { valor: "Não", rotulo: "Não" }, sem];
  if (p.tipo === "opcao") return [...p.opcoes.map((o) => ({ valor: o, rotulo: o })), sem];
  if (p.tipo === "texto") return [sem];
  const valida = p.esperada && esperadaValida(p.tipo, p.esperada);
  return [
    ...(valida ? [{ valor: p.esperada, rotulo: esperadaLegivel(p.tipo, p.esperada, p.opcoes) }] : []),
    sem,
  ];
}

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** "Nao" e "Não", "r01" e "R01": a esperada gravada casa com a opção do select sem caixa nem acento. */
function casar(p: Rascunho, esperada: string): string {
  const achada = esperadas(p).find((o) => o.valor && semAcento(o.valor) === semAcento(esperada));
  return achada ? achada.valor : esperada;
}

function Seletor({
  ref,
  id,
  valor,
  opcoes,
  onChange,
  erro,
  disabled,
  className,
}: {
  ref?: React.Ref<HTMLSelectElement>;
  id: string;
  valor: string;
  opcoes: { valor: string; rotulo: string }[];
  onChange: (valor: string) => void;
  erro?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        ref={ref}
        id={id}
        value={valor}
        disabled={disabled}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-11 w-full appearance-none truncate rounded-sm border border-input bg-card pr-9 pl-3 text-[15px] leading-[22px] text-foreground disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <ChevronDown
        {...ICONE}
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function MensagemDeErro({ id, texto }: { id: string; texto?: string }) {
  if (!texto) return null;
  return (
    <p id={`${id}-erro`} role="alert" className={ERRO}>
      {texto}
    </p>
  );
}

/**
 * O check em edição: quando sai, quem responde e as perguntas. O erro de validação volta preso ao
 * campo (`ErroDeCampo`), e o que foi digitado fica onde estava.
 */
export function EditorDoCheck({
  check: k,
  fase,
  obraId,
  hoje,
  sair,
  onSalvo,
}: {
  check: CheckDaFase;
  fase: FaseDoCronograma;
  obraId: string;
  hoje: string;
  /** O endereço da página sem o editor aberto (os outros parâmetros ficam). */
  sair: string;
  /** O recado de sucesso, que a página mostra quando o editor fecha. */
  onSalvo: (recado: string) => void;
}) {
  const router = useRouter();
  const base = useId();
  const novas = useRef(0);
  const primeiroCampo = useRef<HTMLSelectElement>(null);
  const botaoMais = useRef<HTMLButtonElement>(null);
  const [dias, setDias] = useState(k.dias);
  const [hora, setHora] = useState(k.hora);
  // quem saiu da equipe não aparece nas opções: o campo começa vazio, e o salvar pede a escolha
  const [responsavelId, setResponsavelId] = useState(
    fase.responsaveis.some((u) => u.id === k.responsavel?.id) ? (k.responsavel?.id ?? "") : "",
  );
  const [perguntas, setPerguntas] = useState<Rascunho[]>(() =>
    k.perguntas.map((p) => {
      const r: Rascunho = {
        chave: p.id,
        id: p.id,
        texto: p.texto,
        tipo: p.tipo,
        opcoes: p.opcoes,
        opcoesGravadas: p.tipo === "opcao" ? p.opcoes : [],
        esperada: p.esperada ?? "",
        pedeFoto: p.pedeFoto,
      };
      return { ...r, esperada: casar(r, r.esperada) };
    }),
  );
  const [erro, setErro] = useState<{ campo?: string; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  /** Para onde o foco vai depois de tirar uma pergunta: o tirar da seguinte, ou o Adicionar. */
  const [focarDepois, setFocarDepois] = useState<string | null>(null);
  // check aprovado que ainda não saiu: o backend tira a aprovação ao salvar
  const tiraAprovacao = k.aprovadoEm !== null && !k.envios.some((e) => e.enviadoEm !== null);

  // ao abrir, o foco vai para o primeiro campo do editor
  useEffect(() => {
    primeiroCampo.current?.focus();
  }, []);
  useEffect(() => {
    if (!focarDepois) return;
    const alvo =
      focarDepois === "mais" ? botaoMais.current : document.getElementById(`${base}-p-${focarDepois}-tirar`);
    alvo?.focus();
    setFocarDepois(null);
  }, [focarDepois, base]);

  const datas = datasDoCheck({ momento: k.momento, dias }, fase);
  const proxima = proximaSaida(datas, hoje);
  const cai =
    datas.length === 0
      ? "a fase não tem a data de que esta regra precisa."
      : k.momento === "durante"
        ? `sai ${plural(datas.length, "vez", "vezes")}, de ${ddmm(datas[0] ?? "")} a ${ddmm(datas.at(-1) ?? "")}.`
        : `cai em ${proxima ? diaCurto(proxima) : "—"}.`;

  /** A mensagem do erro, se ele é deste campo ("perguntas.3.texto", "hora"…). */
  const erroDe = (...campos: string[]) =>
    erro?.campo && campos.some((c) => erro.campo === c || erro.campo?.startsWith(`${c}.`))
      ? erro.texto
      : undefined;
  const indice = (chave: string) => perguntas.findIndex((p) => p.chave === chave);
  const erroDaPergunta = (i: number, ...campos: string[]) =>
    erroDe(...campos.map((c) => `perguntas.${i}.${c}`));
  const erroSoltoDaPergunta = (i: number) => (erro?.campo === `perguntas.${i}` ? erro.texto : undefined);
  const conhecidos = ["dias", "hora", "responsavelId", "perguntas"];
  const erroGeral =
    erro && (!erro.campo || !conhecidos.some((c) => erro.campo?.startsWith(c))) ? erro.texto : null;

  const mudar = (chave: string, troca: Partial<Rascunho>) => {
    setErro(null);
    setPerguntas((atual) => atual.map((p) => (p.chave === chave ? { ...p, ...troca } : p)));
  };
  const mudarTipo = (p: Rascunho, tipo: TipoResposta) => {
    const opcoes =
      tipo === "medida" ? [unidadeDaMedida(p.opcoes) ?? "m"] : tipo === "opcao" ? p.opcoesGravadas : [];
    const novo = { ...p, tipo, opcoes };
    // a esperada só fica se vale para o tipo novo (e, na opção, se é uma das opções)
    const fica =
      p.esperada !== "" &&
      esperadaValida(tipo, p.esperada) &&
      esperadas(novo).some((o) => o.valor === p.esperada);
    mudar(p.chave, { tipo, opcoes, esperada: fica ? p.esperada : "" });
  };

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!responsavelId) return setErro({ campo: "responsavelId", texto: "Escolha quem responde na obra." });
    setErro(null);
    iniciar(async () => {
      const r = await salvarCheckAction(obraId, fase.uid, k.id, {
        dias,
        hora,
        responsavelId: responsavelId || null,
        perguntas: perguntas.map((p) => ({
          id: p.id,
          texto: p.texto,
          tipo: p.tipo,
          opcoes: p.opcoes,
          esperada: p.esperada || null,
          pedeFoto: p.pedeFoto,
        })),
      });
      if (r?.erro) return setErro({ campo: r.campo, texto: r.erro });
      onSalvo(tiraAprovacao ? "Perguntas salvas. O check voltou para aprovação." : "Perguntas salvas.");
      router.replace(sair, { scroll: false });
    });
  }

  const idTitulo = `${base}-titulo`;
  const idRegra = `${base}-regra`;
  const idHora = `${base}-hora`;
  const idQuem = `${base}-quem`;
  const idMais = `${base}-mais`;

  return (
    <section aria-labelledby={idTitulo} className="flex flex-col rounded-md border bg-card">
      <form onSubmit={salvar} className="flex flex-1 flex-col">
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <h3
              id={idTitulo}
              className="flex items-center gap-2 text-[13px] leading-[18px] font-semibold tracking-[0.06em] uppercase"
            >
              <Conta estado={k.estado} />
              {MOMENTO[k.momento]}
            </h3>
            <Badge variant="secondary">Editando</Badge>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={idRegra}>Quando sai</Label>
            <div className="flex gap-2">
              <Seletor
                ref={primeiroCampo}
                id={idRegra}
                className="flex-1"
                valor={String(dias)}
                opcoes={regras(k.momento, k.dias).map((o) => ({ valor: String(o.valor), rotulo: o.rotulo }))}
                onChange={(v) => {
                  setErro(null);
                  setDias(Number(v));
                }}
                erro={erroDe("dias")}
              />
              <Input
                id={idHora}
                aria-label="Hora do envio"
                inputMode="numeric"
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                title="Use a hora no formato HH:MM, ex.: 07:00."
                value={hora}
                maxLength={5}
                aria-invalid={erroDe("hora") ? true : undefined}
                aria-describedby={erroDe("hora") ? `${idHora}-erro` : undefined}
                onChange={(e) => {
                  setErro(null);
                  setHora(e.currentTarget.value);
                }}
                className="w-[84px] shrink-0 font-mono text-[15px] leading-[22px] font-medium"
              />
            </div>
            <MensagemDeErro id={idRegra} texto={erroDe("dias")} />
            <MensagemDeErro id={idHora} texto={erroDe("hora")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={idQuem}>Quem responde</Label>
            <Seletor
              id={idQuem}
              valor={responsavelId}
              opcoes={[
                ...(responsavelId ? [] : [{ valor: "", rotulo: "Escolha quem responde" }]),
                ...fase.responsaveis.map((u) => ({ valor: u.id, rotulo: `${u.nome}, ${u.papel}` })),
              ]}
              onChange={(v) => {
                setErro(null);
                setResponsavelId(v);
              }}
              erro={erroDe("responsavelId")}
            />
            <MensagemDeErro id={idQuem} texto={erroDe("responsavelId")} />
          </div>
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            Com o cronograma v{fase.versaoNumero}, {cai}
          </p>
        </div>

        <ul className="divide-y">
          {perguntas.map((p) => {
            const i = indice(p.chave);
            const id = `${base}-p-${p.chave}`;
            const erroTexto = erroDaPergunta(i, "texto", "id") ?? erroSoltoDaPergunta(i);
            const erroTipo = erroDaPergunta(i, "tipo");
            // sem editor de opções, o erro delas fica sob a esperada, o campo mais perto
            const erroEsperada = erroDaPergunta(i, "esperada", "opcoes");
            return (
              <li key={p.chave} className="space-y-2 px-4 py-3.5">
                <div className="flex items-start gap-2">
                  {/* 1 px de folga à direita: a quebra de linha do texto é a mesma do parágrafo de leitura */}
                  <textarea
                    id={`${id}-texto`}
                    aria-label={`Pergunta ${i + 1}`}
                    rows={1}
                    value={p.texto}
                    placeholder="Escreva a pergunta"
                    aria-invalid={erroTexto ? true : undefined}
                    aria-describedby={erroTexto ? `${id}-texto-erro` : undefined}
                    onChange={(e) => mudar(p.chave, { texto: e.currentTarget.value })}
                    className="field-sizing-content min-h-11 min-w-0 flex-1 resize-none rounded-sm border border-input bg-card py-[11px] pr-[13px] pl-3 text-sm leading-5 text-foreground placeholder:text-muted-foreground aria-invalid:border-destructive"
                  />
                  <Button
                    type="button"
                    id={`${id}-tirar`}
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Tirar a pergunta ${i + 1}`}
                    onClick={() => {
                      setErro(null);
                      setFocarDepois(perguntas[i + 1]?.chave ?? "mais");
                      setPerguntas((atual) => atual.filter((x) => x.chave !== p.chave));
                    }}
                  >
                    <X {...ICONE} />
                  </Button>
                </div>
                <MensagemDeErro id={`${id}-texto`} texto={erroTexto} />
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor={`${id}-tipo`} className={cn(ROTULO, "block")}>
                      Resposta
                    </label>
                    <Seletor
                      id={`${id}-tipo`}
                      valor={p.tipo}
                      opcoes={tiposDa(p).map((t) => ({ valor: t, rotulo: TIPO_NO_EDITOR[t] }))}
                      onChange={(v) => mudarTipo(p, v as TipoResposta)}
                      erro={erroTipo}
                    />
                    <MensagemDeErro id={`${id}-tipo`} texto={erroTipo} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor={`${id}-esperada`} className={cn(ROTULO, "block")}>
                      Esperada
                    </label>
                    <Seletor
                      id={`${id}-esperada`}
                      valor={p.esperada}
                      opcoes={esperadas(p)}
                      disabled={p.tipo === "texto"}
                      onChange={(v) => mudar(p.chave, { esperada: v })}
                      erro={erroEsperada}
                    />
                    <MensagemDeErro id={`${id}-esperada`} texto={erroEsperada} />
                  </div>
                </div>
                {(p.tipo === "sim_nao" || p.pedeFoto) && (
                  <label className="flex w-fit items-center gap-2 text-sm leading-5">
                    <span className="relative flex size-5 shrink-0">
                      <input
                        type="checkbox"
                        checked={p.pedeFoto}
                        onChange={(e) => mudar(p.chave, { pedeFoto: e.currentTarget.checked })}
                        className="peer size-5 appearance-none rounded-sm border border-concreto bg-card checked:border-foreground checked:bg-foreground"
                      />
                      <Check
                        {...ICONE}
                        strokeWidth={3}
                        className="pointer-events-none absolute top-[3px] left-[3px] size-3.5 text-card opacity-0 peer-checked:opacity-100"
                      />
                    </span>
                    Pedir foto
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-2 border-t px-4 py-3.5">
          <Button
            ref={botaoMais}
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={perguntas.length >= MAXIMO_DE_PERGUNTAS}
            aria-describedby={idMais}
            onClick={() => {
              setErro(null);
              novas.current += 1;
              setPerguntas((atual) => [
                ...atual,
                {
                  chave: `nova-${novas.current}`,
                  texto: "",
                  tipo: "sim_nao",
                  opcoes: [],
                  opcoesGravadas: [],
                  esperada: "",
                  pedeFoto: false,
                },
              ]);
            }}
          >
            Adicionar pergunta
          </Button>
          {/* a frase passa menos de 1 px da coluna de 360: ganha 1 px do respiro para não quebrar */}
          <p id={idMais} className="-mr-px text-[13px] leading-[18px] text-muted-foreground">
            {perguntas.length} de {MAXIMO_DE_PERGUNTAS} perguntas: é o que cabe num envio do WhatsApp.
          </p>
          <MensagemDeErro id={idMais} texto={erro?.campo === "perguntas" ? erro.texto : undefined} />
        </div>
        <div className="flex-1" />
        {tiraAprovacao && (
          <p className="px-4 pb-3 text-[13px] leading-[18px] text-muted-foreground">
            Salvar tira a aprovação deste check: aprove de novo depois.
          </p>
        )}
        {erroGeral && (
          <p role="alert" className={cn(ERRO, "px-4 pb-3")}>
            {erroGeral}
          </p>
        )}
        <div className="flex gap-2 border-t px-4 pt-3.5 pb-4">
          <Link href={sair} scroll={false} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Cancelar
          </Link>
          {pendente ? (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled
              className="flex-1 border-line disabled:opacity-100"
            >
              <span className="text-muted-foreground">Salvando…</span>
            </Button>
          ) : (
            <Button type="submit" size="sm" className="flex-1">
              Salvar perguntas
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
