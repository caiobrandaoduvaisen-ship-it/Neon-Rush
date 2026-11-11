# Neon Rush 3D — Servidor (Backend)

Servidor do Neon Rush 3D: contas, cargos, moedas, loja, códigos, partidas, ranking, chat global, mensagens privadas, notificações, denúncias, KICK/BAN e painel administrativo.

**Tecnologias:** Node.js 20+, Express, Socket.IO, PostgreSQL.

## Rodar no seu computador

```bash
npm install
cp .env.example .env        # preencha DATABASE_URL e SESSION_SECRET
npm run migrate             # cria as tabelas
npm run dev                 # sobe em http://localhost:3000
```

Teste: abra `http://localhost:3000/health` — deve responder `{"status":"ok","database":"ok"}`.

## Testes

```bash
npm test                                         # regras de permissão
TEST_DATABASE_URL=postgres://.../neonrush_test npm test   # tudo, com um banco de TESTE descartável
```

O teste de integração apaga o banco informado. Use sempre um banco cujo nome contenha `test`.

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| `DEPLOY_RENDER.md` | Publicar o servidor e o PostgreSQL no Render |
| `DEPLOY_NETLIFY.md` | Atualizar o jogo no Netlify e ligar ao servidor |
| `OWNER_BOOTSTRAP.md` | Como ativar o OWNER original com segurança |
| `API_DOCUMENTATION.md` | Todas as rotas e eventos em tempo real |
| `DATABASE.md` | Tabelas, regras, backup e recuperação |
| `MODERATION.md` | Cargos, permissões, KICK, BAN, denúncias |
| `MESSAGING.md` | Chat global, mensagens privadas e notificações |

## Estrutura

```
src/
  server.js       servidor HTTP + Socket.IO
  app.js          rotas, CORS, segurança, /health
  permissions.js  regras de cargos (fonte única)
  catalog.js      personagens, preços, conquistas, limites
  routes/         auth, game (loja, códigos, partidas, ranking), social (chat, DM, notificações, denúncias), admin, rooms
  realtime.js     chat global, presença, salas, expulsão em tempo real
migrations/       SQL do PostgreSQL (aplicado automaticamente no start)
scripts/          backup.sh e restore.sh
test/             testes reais
```
