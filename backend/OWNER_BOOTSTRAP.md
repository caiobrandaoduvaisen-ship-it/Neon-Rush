# Ativação do OWNER original

O primeiro jogador que se cadastrar com o código OWNER correto vira o **OWNER original** — uma única vez, para sempre.

## Como funciona
1. O código fica **só** na variável `OWNER_ACTIVATION_CODE` do Render. Ele não está no jogo, no GitHub nem nas respostas do servidor.
2. Na tela **CONTA** do jogo há o campo **Código de ativação OWNER**.
3. No cadastro, o servidor compara o código e, na mesma transação do PostgreSQL, tenta gravar a linha única da tabela `owner_bootstrap` (`id = 1`). Só uma conta consegue — mesmo com dois cadastros ao mesmo tempo.
4. Código errado, ou código já usado: a conta é criada normalmente como **PLAYER**.
5. Tentativas são limitadas (5 por hora por endereço) e registradas na auditoria (`OWNER_BOOTSTRAP`, `OWNER_CODE_INVALID`, `OWNER_CODE_REUSE_ATTEMPT`). O código digitado nunca é gravado.

## Passo a passo
1. Cadastre `OWNER_ACTIVATION_CODE` no Render com o código combinado.
2. Faça o deploy e confira `/health`.
3. No jogo: **👤 ENTRAR** → nome, senha, confirmar senha e o código no campo OWNER → **CRIAR CONTA**.
4. O jogo mostra "👑 Você é o OWNER original" e o botão **🛡️ GERENCIAR JOGADORES** aparece.

## Depois da ativação
1. Confirme que o OWNER foi salvo: no painel → **AUDITORIA** deve aparecer `OWNER_BOOTSTRAP`.
2. Só então apague a variável `OWNER_ACTIVATION_CODE` no Render (**Environment → remover → Save**). Sem ela, a ativação fica desligada de vez.

## Proteções do OWNER original
- Não pode ser expulso, banido, rebaixado ou ter o cargo alterado por nenhuma outra conta (incluindo outros OWNER).
- O banco impede que o OWNER original deixe de ser OWNER (`original_owner_keeps_owner`) e que exista mais de um (`users_one_original_owner`).
- Só o OWNER original pode criar ou rebaixar outros OWNER.

## ADMINs Davi e Enzo
Quando Davi e Enzo criarem as contas deles, o OWNER abre **GERENCIAR JOGADORES**, pesquisa pelo nome ou ID, escolhe **ADMIN** e confirma. Nenhum ID foi inventado: as contas só existem depois que eles se cadastrarem.
