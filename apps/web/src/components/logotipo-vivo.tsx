"use client";

import { useEffect, useRef } from "react";
import { Logotipo } from "./marca";

/** Quanto a bolha anda para cada lado, em unidades do SVG: sem encostar nas pontas arredondadas da régua. */
const CURSO = 8;
/** Centro da régua no logotipo (x = 156 de 181). */
const CENTRO_DA_REGUA = 156 / 181;
/** Componente lateral da gravidade (m/s²) que leva a bolha até a ponta: ≈ 20° de inclinação. */
const GRAVIDADE_ATE_A_PONTA = 3.4;

type PermissaoMovimento = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Logotipo com a bolha da régua viva, como num nível de verdade.
 * - Computador: a bolha acompanha o mouse para a esquerda e para a direita; volta ao centro quando o mouse sai da janela.
 * - Celular: a bolha corre para o lado mais alto, pelo acelerômetro (gravidade). O sensor é ouvido desde o início
 *   (Android entrega sem perguntar); se nada chegar e o navegador exigir permissão (iPhone), ela é pedida no
 *   primeiro toque na página, uma vez só.
 * - Com "reduzir movimento" ligado no sistema, a bolha fica parada no centro.
 */
export function LogotipoVivo({ className, titulo }: { className?: string; titulo?: string }) {
  const bolha = useRef<SVGGElement>(null);

  useEffect(() => {
    const g = bolha.current;
    const svg = g?.ownerSVGElement;
    if (!g || !svg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let alvo = 0;
    let x = 0;
    let velocidade = 0;
    let quadro = 0;

    // mola com um pouco de balanço: a bolha passa do ponto e volta, como líquido
    const passo = () => {
      velocidade = velocidade * 0.8 + (alvo - x) * 0.08;
      x += velocidade;
      if (Math.abs(alvo - x) < 0.02 && Math.abs(velocidade) < 0.02) {
        x = alvo;
        quadro = 0;
      } else {
        quadro = requestAnimationFrame(passo);
      }
      g.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
    };
    const mirar = (inclinacao: number) => {
      alvo = Math.max(-1, Math.min(1, inclinacao)) * CURSO;
      if (!quadro) quadro = requestAnimationFrame(passo);
    };

    const aoMoverMouse = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = svg.getBoundingClientRect();
      const centro = r.left + r.width * CENTRO_DA_REGUA;
      // cada lado da janela vale o curso inteiro: o logotipo fica perto da borda esquerda
      const lado = e.clientX < centro ? centro : window.innerWidth - centro;
      mirar((e.clientX - centro) / Math.max(lado, 1));
    };
    const aoSairDaJanela = (e: MouseEvent) => {
      if (!e.relatedTarget) mirar(0);
    };

    let recebeuMovimento = false;
    // gravidade no eixo horizontal da tela, conforme a rotação da tela
    const aoInclinar = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null) return;
      recebeuMovimento = true;
      const angulo =
        (screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0)) % 360;
      const lateral =
        angulo === 90 ? -a.y : angulo === 180 ? -a.x : angulo === 270 || angulo === -90 ? a.y : a.x;
      mirar(lateral / GRAVIDADE_ATE_A_PONTA);
    };
    const Movimento = (window as { DeviceMotionEvent?: PermissaoMovimento }).DeviceMotionEvent;
    // só em tela de toque: no computador o mouse já basta e não há por que pedir nada
    const pedirPermissao = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || recebeuMovimento) return;
      document.removeEventListener("pointerup", pedirPermissao);
      Movimento?.requestPermission?.().catch(() => {});
    };

    window.addEventListener("pointermove", aoMoverMouse, { passive: true });
    document.addEventListener("mouseout", aoSairDaJanela);
    window.addEventListener("devicemotion", aoInclinar);
    if (typeof Movimento?.requestPermission === "function")
      document.addEventListener("pointerup", pedirPermissao);

    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("pointermove", aoMoverMouse);
      document.removeEventListener("mouseout", aoSairDaJanela);
      window.removeEventListener("devicemotion", aoInclinar);
      document.removeEventListener("pointerup", pedirPermissao);
    };
  }, []);

  return <Logotipo className={className} titulo={titulo} refBolha={bolha} />;
}
