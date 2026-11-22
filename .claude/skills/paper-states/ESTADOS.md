# Famílias de estados

Cada família é uma pergunta para fazer ao código da tela e ao domínio. Toda família entra no inventário com pelo menos um estado ou com "não se aplica" e o motivo. Os exemplos de cada família no domínio deste app, e as famílias que só ele tem, estão na seção "Domínio" do `.claude/paper/PROJETO.md`.

## Dados

- **Vazio de primeira vez:** a conta acabou de entrar e ainda não tem nenhum registro. A tela ensina o primeiro passo?
- **Vazio por filtro ou busca:** existe dado, mas nada passa no filtro. Dá para desfazer o filtro?
- **Vazio porque está tudo resolvido:** nenhuma pendência, nenhuma decisão esperando. É um sucesso, e a tela deve dizer isso.
- **Um item só:** a lista com um elemento ainda parece uma lista?
- **Muitos itens:** cem, quinhentos registros. Rola, pagina ou resume?
- **Conteúdo longo:** um nome que não cabe. Quebra ou corta, e como se lê o resto?
- **Dado faltando:** campo opcional nulo, sem foto, sem anexo, sem configuração cadastrada.
- **Números nas pontas:** zero, um, mil; valor no limite exato de uma regra.

## Tempo

- **Carregando a primeira vez:** o que aparece antes do dado (`loading.tsx`, esqueleto)?
- **Ação pendente:** o botão que foi clicado e o servidor ainda não respondeu.
- **Processando ao fundo:** importação, leitura de arquivo, geração de PDF. Como a pessoa sabe que ainda não acabou?
- **Desatualizado:** o dado mudou desde que a tela abriu (outra pessoa mexeu enquanto esta olhava).

## Erro

- **Erro de validação:** campo a campo, dizendo o que corrigir.
- **Falha da ação:** a server action falhou. O que foi preenchido continua lá?
- **Erro do servidor:** a página não carregou (`error.tsx`).
- **Não encontrado:** id inválido ou registro apagado (`not-found.tsx`).
- **Sem permissão:** o papel não vê esta tela ou esta ação.
- **Link ou sessão vencidos:** o link de acesso já usado, a sessão que expirou.

## Pessoa

- **Cada papel:** os papéis de usuário do `PROJETO.md`. O que cada um vê e pode fazer?
- **Primeira vez da pessoa:** a pessoa recém-convidada, que ainda não sabe onde está.

## Domínio

Os status do domínio (onde estão, no `PROJETO.md`): cada valor que a tela pode mostrar é um estado; leia-os na hora do inventário. Além deles, as famílias que só o domínio tem, listadas lá.

## Depois da ação

- **Sucesso:** o que a tela mostra logo depois de liberar, salvar ou convidar.
- **Desfazer:** dá para voltar atrás, e até quando?

## Superfície

- **Celular:** a tela em 390px, se a pessoa a usa no celular (landing, login, links que chegam por mensagem).
