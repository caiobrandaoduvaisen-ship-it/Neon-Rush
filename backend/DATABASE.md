# Banco de dados (PostgreSQL)

As tabelas são criadas por `migrations/001_init.sql`, aplicadas automaticamente pelo `npm start` (controle em `schema_migrations`, com trava para não rodar duas vezes ao mesmo tempo).

## Tabelas
| Tabela | Guarda |
| --- | --- |
| `users` | conta, ID público `NR3D-XXXXXXXX`, hash da senha (scrypt), cargo, OWNER original, influenciador, moedas, personagem selecionado, capa |
| `public_ids` | todo ID já emitido — nunca é reutilizado |
| `owner_bootstrap` | linha única (`id = 1`) com o OWNER original |
| `sessions` | sessões (só o hash do token), expiração e revogação |
| `coin_ledger` | cada entrada e saída de moedas com saldo final |
| `user_characters` / `purchases` | personagens liberados e compras (sem duplicar) |
| `game_runs` / `best_scores` | partidas validadas e recordes por modo (ranking) |
| `promo_codes` / `code_redemptions` | códigos, limites, validade e resgates (1 por conta) |
| `chat_messages` / `chat_mutes` | chat global e silenciamentos |
| `conversations` / `dm_messages` / `blocks` | mensagens privadas e bloqueios |
| `notifications` | notificações com estado de leitura |
| `reports` | denúncias, status, responsável, observações, evidência |
| `bans` / `kicks` / `role_changes` / `influencer_log` | histórico de moderação |
| `user_achievements` | conquistas |
| `audit_log` | auditoria de ações importantes |

Permissões ficam no código (`src/permissions.js`), testadas em `test/permissions.test.js`.

## Regras garantidas pelo próprio banco
- Saldo nunca negativo (`coins >= 0`).
- Um único OWNER original, que sempre é OWNER.
- Nome de usuário único sem diferenciar maiúsculas.
- Compra e resgate únicos por conta (`UNIQUE`).
- Mensagens com limite de tamanho; DM sem duplicar (`sender_id + client_nonce`).
- Códigos só dão `character`, `cape`, `coins` ou `surprise` — nunca cargos.
- A recompensa de influenciador usa `influencer_reward_granted_at`, preenchido uma única vez.

Operações com dinheiro, cargos e recompensas rodam em transação com `SELECT … FOR UPDATE`. Todas as consultas usam parâmetros (`$1`), sem montar SQL com texto do jogador.

## Backup
```bash
# use a External Database URL (Render → banco → Connect)
DATABASE_URL="postgres://..." ./scripts/backup.sh       # gera backups/neonrush3d-AAAAMMDD-HHMMSS.dump
```
Planos pagos do Render também fazem backups diários automáticos (**banco → Recovery**).

## Recuperação
```bash
DATABASE_URL="postgres://..." ./scripts/restore.sh backups/arquivo.dump
```
O script pede confirmação, pois substitui os dados atuais.
