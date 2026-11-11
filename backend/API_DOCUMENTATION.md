# API do Neon Rush 3D

Base: `https://SEU-SERVICO.onrender.com`. Corpo e respostas em JSON.
Autenticação: `Authorization: Bearer <token>` (o token vem do cadastro/login e fica salvo no jogo).
Erros: `{ "error": "mensagem", "code": "CODIGO" }`.

## Geral
| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | Estado do servidor e do PostgreSQL |
| GET | `/api/catalog` | Personagens e preços oficiais |
| GET | `/api/leaderboards/:mode` | Top 50 (`classic`, `easy`, `nocoin`) |

## Conta
| Método | Rota | Corpo | Notas |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `username, password, ownerCode?` | Retorna `token` e `user`. Limite: 10/h por IP |
| POST | `/api/auth/login` | `username, password` | `403 BANNED` com `ban.reason`, `ban.expiresAt` |
| POST | `/api/auth/logout` | — | Encerra a sessão atual |
| GET | `/api/auth/me` | — | Conta completa (saldo, cargo, personagens, não lidas, permissões) |
| GET | `/api/profile` | — | Perfil + recordes, conquistas, compras, partidas |

## Jogo e economia
| Método | Rota | Corpo | Notas |
| --- | --- | --- | --- |
| POST | `/api/shop/buy` | `characterId` | Preço do servidor; OWNER/MOD não pagam; impede compra repetida |
| POST | `/api/characters/select` | `characterId` | Só personagens liberados; CRIADOR só para influenciadores |
| POST | `/api/codes/redeem` | `code` | 10 tentativas / 10 min |
| POST | `/api/runs/start` | `mode` | Retorna `runId`; o servidor marca a hora de início |
| POST | `/api/runs/finish` | `runId, distance, coins, duration` | Valida tempo real, distância e moedas; credita moedas e atualiza ranking |
| GET | `/api/players/search?q=` | — | Busca por nome ou ID (para mensagens) |

## Chat, mensagens, notificações e denúncias (precisa de login)
| Método | Rota | Corpo |
| --- | --- | --- |
| GET | `/api/chat/global?limit=&before=` | — |
| POST | `/api/chat/global` | `body` (alternativa ao Socket.IO) |
| DELETE | `/api/chat/global/:id` | — (autor, OWNER, ou MOD sobre PLAYER) |
| GET | `/api/dm/conversations` | — |
| GET | `/api/dm/:publicId/messages?before=` | — (marca como lidas) |
| POST | `/api/dm/:publicId` | `body, nonce` (nonce evita duplicar) |
| GET / POST / DELETE | `/api/blocks[/:publicId]` | — |
| GET | `/api/notifications` | — |
| POST | `/api/notifications/read` | `ids?` (vazio = todas) |
| POST | `/api/reports` | `targetId, category, description, chatMessageId?, dmMessageId?` |

## Painel (OWNER, ADMIN, MOD — cada ação confere o cargo)
| Método | Rota | Corpo | Quem |
| --- | --- | --- | --- |
| GET | `/api/admin/players?q=` | — | OWNER, ADMIN, MOD |
| GET | `/api/admin/players/:id` | — | detalhes, histórico e `allowed` (ações permitidas) |
| POST | `/api/admin/players/:id/kick` | `reason` | OWNER; ADMIN/MOD só PLAYER |
| POST | `/api/admin/players/:id/ban` | `reason, hours` (`null` = permanente) | OWNER; MOD só PLAYER |
| POST | `/api/admin/players/:id/unban` | `reason?` | OWNER; MOD só PLAYER |
| POST | `/api/admin/players/:id/mute` | `reason, minutes` | OWNER; MOD só PLAYER |
| POST | `/api/admin/players/:id/unmute` | — | idem |
| POST | `/api/admin/players/:id/role` | `role` | OWNER; MOD só PLAYER↔MOD |
| POST | `/api/admin/players/:id/influencer` | `grant` | só OWNER |
| GET / PATCH | `/api/admin/reports[/:id]` | `status, notes` | OWNER, MOD |
| GET / POST / PATCH | `/api/admin/codes[/:code]` | `code, rewardType, rewardValue, maxUses, expiresAt, active` | só OWNER |
| GET | `/api/admin/audit?action=` | — | só OWNER |
| GET | `/api/admin/influencers` | — | só OWNER |

## Salas (painel ONLINE original)
`POST /api/rooms` · `POST /api/rooms/join {code}` · `POST /api/rooms/leave {code}` — até 8 jogadores, em memória.

## Tempo real (Socket.IO)
Conectar com `io(URL, { auth: { token } })`.

| Evento | Direção | Dados |
| --- | --- | --- |
| `chat:send` | jogo → servidor | `{ body }` + resposta `{ ok, message | error, code }` |
| `chat:message` | servidor → todos | mensagem com nome, ID, cargo, horário |
| `chat:deleted` | servidor → todos | `{ id }` |
| `chat:online` | servidor → todos | lista de jogadores conectados |
| `dm:new` / `dm:read` | servidor → destinatário | nova mensagem / mensagens lidas |
| `notification` | servidor → jogador | `{ id, type, content, createdAt, read }` |
| `account:update` | servidor → jogador | cargo, saldo ou designação mudou |
| `session:revoked` | servidor → jogador | `{ type: 'KICK' | 'BAN', reason }` — sessão encerrada |
| `room:join` / `room:leave` / `room:players` | ambos | salas |
