# Publicar o servidor no Render

> O servidor só está publicado depois que você fizer estes passos e o endereço `/health` responder `ok`.

## 1. Enviar o código para o GitHub
1. Crie um repositório novo (ex.: `neonrush3d-backend`) em github.com → **New repository**.
2. Envie o conteúdo deste ZIP (sem `node_modules` e sem `.env`): **Add file → Upload files** → arraste as pastas e arquivos → **Commit changes**.

## 2. Criar tudo com o Blueprint (recomendado)
1. Em dashboard.render.com clique **New → Blueprint**.
2. Conecte o GitHub e escolha o repositório. O Render lê o `render.yaml` e cria:
   - o banco **neonrush3d-db** (PostgreSQL);
   - o Web Service **neonrush3d-api**.
3. Ele vai pedir o valor de **OWNER_ACTIVATION_CODE**: digite o código OWNER combinado (veja `OWNER_BOOTSTRAP.md`).
4. Clique **Apply**.

### Ou manualmente
1. **New → PostgreSQL** → nome `neonrush3d-db` → **Create**. Copie a **Internal Database URL**.
2. **New → Web Service** → escolha o repositório.
   - Runtime: **Node**
   - Build Command: `npm ci`
   - Start Command: `npm start` (aplica as migrations e liga o servidor)
   - Health Check Path: `/health`
3. Em **Environment** cadastre:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | Internal Database URL do banco |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://thriving-profiterole-1bafbe.netlify.app` |
| `SESSION_SECRET` | um texto longo e aleatório (ou use **Generate**) |
| `OWNER_ACTIVATION_CODE` | o código OWNER combinado |

`PORT` é definido pelo próprio Render.

## 3. Migrations
Rodam sozinhas a cada deploy (`npm start` executa `node src/migrate.js` antes). Para rodar à mão: **Shell** do serviço → `npm run migrate`.

## 4. CORS
O servidor só aceita o jogo vindo de `FRONTEND_URL`. Para mais de um endereço, separe por vírgula:
`https://thriving-profiterole-1bafbe.netlify.app,https://meudominio.com`

## 5. Verificar
Abra `https://SEU-SERVICO.onrender.com/health`. Esperado:
```json
{"status":"ok","database":"ok"}
```

## 6. Ligar o jogo ao servidor
Siga `DEPLOY_NETLIFY.md` e coloque o endereço do serviço em `config.js`.

## Avisos importantes
- **Plano gratuito do Render:** o serviço "dorme" após ~15 min sem uso; a primeira abertura pode levar até 1 minuto (o jogo tenta reconectar sozinho). O **PostgreSQL gratuito expira** após o período de teste do Render — para guardar contas e moedas de vez, use um plano pago do banco e faça backups (`DATABASE.md`).
- O servidor roda em **uma instância**. Limites de flood e salas ficam na memória; se um dia usar várias instâncias, será preciso um adaptador Redis para o Socket.IO.
