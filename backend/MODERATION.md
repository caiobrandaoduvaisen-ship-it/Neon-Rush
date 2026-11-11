# Cargos e moderação

## Cargos
| | OWNER | MOD | ADMIN | PLAYER |
| --- | --- | --- | --- | --- |
| Moedas infinitas (∞) | ✅ | ✅ | ❌ | ❌ |
| Abrir GERENCIAR JOGADORES | ✅ | ✅ | ✅ | ❌ |
| KICK | todos, menos o OWNER original | só PLAYER | só PLAYER | ❌ |
| BAN / UNBAN | todos, menos o OWNER original | só PLAYER | ❌ | ❌ |
| Silenciar no chat | todos, menos o OWNER original | só PLAYER | ❌ | ❌ |
| Mudar cargos | ADMIN, MOD, PLAYER (OWNER: só o original) | PLAYER ↔ MOD | ❌ | ❌ |
| Conceder/remover INFLUENCIADOR | ✅ | ❌ | ❌ | ❌ |
| Denúncias | ✅ | ✅ | ❌ | ❌ |
| Códigos promocionais | ✅ | ❌ | ❌ | ❌ |
| Auditoria | ✅ | ❌ | ❌ | ❌ |

Ninguém altera o próprio cargo. Ninguém mexe nas moedas de outra conta. Tudo é conferido no servidor — o jogo só mostra os botões permitidos.

**INFLUENCIADOR** é uma designação, não um cargo: dá a estrela acima do personagem, o personagem CRIADOR e 999.000 moedas **uma única vez por conta**. Não dá poderes administrativos.

## KICK
Encerra todas as sessões ativas na hora (o jogo mostra "Você foi expulso" com o motivo). O jogador pode entrar de novo se não estiver banido.

## BAN e UNBAN
Temporário (1 h, 24 h, 7 dias, 30 dias) ou permanente, com motivo, responsável e data. Revoga as sessões e bloqueia login e todas as rotas. UNBAN restaura o acesso sem apagar nada.

## Denúncias
Categorias: Ofensas, Assédio, Trapaças, Exploits, Manipulação de pontuação, Comportamento inadequado, Spam, Abuso de bugs, Outros.
Status: NOVA → EM ANÁLISE → PROCEDENTE / NÃO PROCEDENTE → ENCERRADA.

- O denunciado nunca sabe quem denunciou; só a equipe (OWNER e MOD) vê.
- Não existe banimento automático por quantidade de denúncias.
- Mensagem privada só é lida pela equipe quando foi anexada a uma denúncia, e cada leitura fica na auditoria (`REPORT_DM_VIEWED`).
- O denunciante recebe notificação quando a análise termina.

## Confirmações
Toda ação importante do painel abre uma confirmação com nome e ID do jogador.

## Auditoria
Registra: cadastro, login, tentativas de código OWNER, ativação do OWNER, compras, resgates, partidas rejeitadas, KICK, BAN, UNBAN, silenciamentos, cargos, influenciadores, denúncias, códigos e mensagens apagadas. Senhas e tokens nunca entram nos logs.
