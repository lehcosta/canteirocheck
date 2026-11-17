# Famílias de estados

Cada família é uma pergunta para fazer ao código da tela e ao domínio. Toda família entra no inventário com pelo menos um estado ou com "não se aplica" e o motivo.

## Dados

- **Vazio de primeira vez:** a construtora acabou de entrar e ainda não tem obra, ponto ou projeto. A tela ensina o primeiro passo?
- **Vazio por filtro ou busca:** existe dado, mas nada passa no filtro. Dá para desfazer o filtro?
- **Vazio porque está tudo resolvido:** nenhuma pendência, nenhuma decisão esperando. É um sucesso, e a tela deve dizer isso.
- **Um item só:** a lista com um elemento ainda parece uma lista?
- **Muitos itens:** cem obras, quinhentos pontos. Rola, pagina ou resume?
- **Conteúdo longo:** nome de obra, de local ou de etapa que não cabe. Quebra ou corta, e como se lê o resto?
- **Dado faltando:** campo opcional nulo, sem foto, sem projeto, sem tolerância cadastrada.
- **Números nas pontas:** zero, um, mil; medida no limite exato da tolerância.

## Tempo

- **Carregando a primeira vez:** o que aparece antes do dado (`loading.tsx`, esqueleto)?
- **Ação pendente:** o botão que foi clicado e o servidor ainda não respondeu.
- **Processando ao fundo:** extração do DWG, geração do PDF. Como a pessoa sabe que ainda não acabou?
- **Desatualizado:** o dado mudou desde que a tela abriu (o encarregado mediu enquanto o engenheiro olhava).

## Erro

- **Erro de validação:** campo a campo, dizendo o que corrigir.
- **Falha da ação:** a server action falhou. O que foi preenchido continua lá?
- **Erro do servidor:** a página não carregou (`error.tsx`).
- **Não encontrado:** id inválido ou registro apagado (`not-found.tsx`).
- **Sem permissão:** o papel não vê esta tela ou esta ação.
- **Link ou sessão vencidos:** o link mágico já usado, a sessão que expirou.

## Pessoa

- **Cada papel:** os valores do enum `papel` (admin, engenheiro). O que cada um vê e pode fazer? O encarregado não entra no painel; o mundo dele é o WhatsApp.
- **Primeira vez da pessoa:** a pessoa recém-convidada, que ainda não sabe onde está.

## Domínio do Prumo

Os status do domínio são os `pgEnum` de `packages/db/src/schema/comum.ts`: obra, execução, extração do projeto, revisão do ponto de controle, pendência, etapa no local. Cada valor que a tela pode mostrar é um estado; leia o enum na hora do inventário. Além deles:

- **Medida:** dentro e fora da tolerância, e exatamente no limite.
- **WhatsApp:** mensagem não entregue, encarregado sem número cadastrado, resposta fora do esperado.

## Depois da ação

- **Sucesso:** o que a tela mostra logo depois de liberar, salvar ou convidar.
- **Desfazer:** dá para voltar atrás, e até quando?

## Superfície

- **Celular:** a tela em 390px, se a pessoa a usa no celular (landing, login, links que chegam pelo WhatsApp).
