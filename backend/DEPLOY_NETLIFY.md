# Atualizar o jogo no Netlify

O jogo continua sendo um site estático: `index.html` + `config.js`.

## 1. Configurar o endereço do servidor
Abra `config.js` e coloque o endereço do Web Service do Render (sem barra no final):
```js
window.NRD_API_URL = 'https://neonrush3d-api.onrender.com';
```
Sem esse endereço o jogo funciona offline, igual ao original.

## 2. Publicar
### Opção A — arrastar e soltar (mais simples)
1. app.netlify.com → site **thriving-profiterole-1bafbe** → **Deploys**.
2. Arraste a pasta do frontend (com `index.html`, `config.js` e `netlify.toml`) para a área **"Drag and drop your site output folder here"**.

### Opção B — pelo GitHub
1. Crie um repositório (ex.: `neonrush3d-frontend`) e envie os arquivos do ZIP do frontend.
2. No Netlify: **Site configuration → Build & deploy → Link repository** → escolha o repositório.
3. Build command: *(vazio)* · Publish directory: `.` → **Deploy**.
Cada alteração enviada ao GitHub publica de novo.

## 3. Testar
1. Abra https://thriving-profiterole-1bafbe.netlify.app
2. Toque em **👤 ENTRAR**, crie uma conta e veja seu ID `NR3D-…` no PERFIL.
3. Abra o **💬 CHAT** em dois aparelhos com contas diferentes e troque mensagens.
4. Se aparecer "Sem conexão com o servidor", confira o `/health` do Render e o endereço em `config.js`.

## Backup do jogo original
A pasta `backup/` do ZIP tem o `index.html` original intacto.
