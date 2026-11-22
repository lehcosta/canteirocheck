---
name: paper-critique
description: Critica uma tela do Prumo como a pessoa vai vê-la, em oito lentes (hierarquia e contenção, espaço, estabilidade, interação, contraste e cor, texto, consistência, movimento), cada achado com prova e correção.
disable-model-invocation: true
---

# Criticar uma tela

A crítica olha a tela pelos olhos de quem vai usá-la, no estado em que essa pessoa a encontra. Todo achado tem **prova**: um código da medição (`COR-2`), um recorte ou uma coordenada na foto. Achado sem prova vira pergunta, não achado.

Cada achado leva uma gravidade, no vocabulário da obra:

- **quebra**: a pessoa erra, não consegue ou fica de fora. Exemplos: contraste abaixo do AA, sem foco visível, controle sem nome, layout shift que leva ao clique errado, texto vazando ou cortado sem acesso.
- **atrito**: a pessoa consegue, mas gasta atenção. Exemplos: hierarquia que disputa, alvo pequeno, controle que não responde, movimento lento, inconsistência que faz duvidar.
- **acabamento**: polimento. Exemplos: fora da grade, quase alinhado, raio fora do token, `transition: all`.

O veredito de cada lente é a pior gravidade dos achados dela; uma lente sem achado está **no prumo**.

## Passos

1. **Alvo.** Escreva:
   - a tela: uma rota do app ou o HTML de uma variação do `paper-explorer`;
   - a largura: 1440 para o painel; 390 para conferir a landing no celular;
   - quem a vê e o que veio fazer ali, numa frase.

   Para o atual de uma exploração, critique a rota viva, porque o HTML convertido carrega artefatos da conversão.
   _Pronto quando_ as três coisas estão escritas.

2. **Medir.** Rode da raiz do repositório:

   ```bash
   node .claude/skills/paper-critique/scripts/medir.mjs --rota '/obras/[obraId]' [--largura 1440]
   node .claude/skills/paper-critique/scripts/medir.mjs --html <arquivo.html>
   ```

   A rota abre como a pessoa a vê: anônima quando é pública, como admin quando pede login, com os dados do banco da worktree. O script imprime a pasta da medição, que tem:
   - `medidas.md`: achados por lente, com código, mais o inventário;
   - `tela.png`: a foto da tela;
   - `semicerrado.png`: a tela desfocada;
   - `estados.png`: cada tipo de controle em repouso, sob o mouse, com foco pelo teclado e pressionado;
   - `achados/<código>.png`: o elemento do achado, circulado.

   Leia o `medidas.md` inteiro e as imagens da pasta.
   _Pronto quando_ as imagens foram lidas e cada código do `medidas.md` foi visto no recorte dele.

3. **Julgar, lente por lente.** Siga a ordem: hierarquia e contenção, espaço, estabilidade, interação, contraste e cor, texto, consistência, movimento. Em cada lente, use as perguntas de [LENTES.md](LENTES.md).
   - Confirme no recorte cada código medido. Ele vira achado ou é descartado com o motivo, como "ilustração decorativa da landing".
   - Acrescente o que só o olho vê, com a coordenada na `tela.png` como prova.
   - Cada achado diz o que a pessoa sente e traz a correção concreta: a classe, o token ou o componente a trocar, com `arquivo:linha`. Ache a linha com grep pelo texto, pelo `data-slot` ou pela classe em `apps/web/src`.

   _Pronto quando_ as oito lentes têm veredito, nenhum código do `medidas.md` ficou sem destino e todo achado tem prova e correção.

4. **Relatar.** No chat, nesta ordem:
   - as três correções que a pessoa sentiria primeiro;
   - as oito lentes, cada uma com veredito e achados (gravidade, o que a pessoa sente, prova, correção);
   - os descartes, uma linha cada;
   - o caminho da pasta de medição.

   Corrija só se o usuário pedir.

## O que a medição não vê

A tela é medida no estado que o banco produz. Estado vazio, erro, carregamento lento e outro papel de usuário (engenheira em vez de admin) são outras telas: para criticá-las, ponha o app nesse estado ou critique pelo código, dizendo que a prova é o código. Na tela estática (`--html`), estabilidade no carregamento, estados forçados e "reduzir movimento" não se aplicam.
