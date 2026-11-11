// Testes reais contra PostgreSQL. Use um banco descartável:
//   TEST_DATABASE_URL=postgres://.../neonrush_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const TEST_DB = process.env.TEST_DATABASE_URL || '';
const skip = !TEST_DB ? 'defina TEST_DATABASE_URL para rodar os testes de integração' : false;
const CODE = 'TESTE77'; // código só de teste — o real fica apenas na variável do Render

let base, server, pool, ioc, hub;
const sockets = [];

before(async () => {
  if (skip) return;
  if (!/test/i.test(TEST_DB)) throw new Error('TEST_DATABASE_URL precisa apontar para um banco de TESTE (o nome deve conter "test")');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: TEST_DB, OWNER_ACTIVATION_CODE: CODE, SESSION_SECRET: 'segredo-de-teste' });
  const pg = (await import('pg')).default;
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  ({ pool } = await import('../src/db.js'));
  await (await import('../src/migrate.js')).migrate();
  hub = await import('../src/hub.js');
  const { createServer } = await import('../src/server.js');
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  ioc = (await import('socket.io-client')).io;
});

after(async () => {
  if (skip) return;
  sockets.forEach((s) => s.disconnect());
  hub.getIo()?.close();
  await new Promise((r) => server.close(r));
  await pool.end();
});

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
let n = 0;
async function reg(prefix = 'p', ownerCode) {
  const username = `${prefix}${Date.now() % 100000}${n++}`.slice(0, 20);
  const r = await call('POST', '/api/auth/register', { username, password: 'senha123', ownerCode });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { username, token: r.data.token, user: r.data.user };
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const waitFor = (s, ev, pred = () => true, ms = 3000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout ' + ev)), ms);
  const h = (p) => { if (pred(p)) { clearTimeout(t); s.off(ev, h); resolve(p); } };
  s.on(ev, h);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function earn(token, coins) {
  const s = await call('POST', '/api/runs/start', { mode: 'classic' }, token);
  return call('POST', '/api/runs/finish', { runId: s.data.runId, distance: 100, coins, duration: 3 }, token);
}

let OWNER, MOD, ADMIN;

test('3/5. Ativação OWNER: só a primeira conta com o código vira OWNER (corrida simultânea)', { skip }, async () => {
  const users = await Promise.all([1, 2, 3, 4, 5].map(() => reg('own', CODE)));
  const owners = users.filter((u) => u.user.role === 'OWNER');
  assert.equal(owners.length, 1);
  assert.equal(owners[0].user.isOriginalOwner, true);
  assert.equal(users.filter((u) => u.user.role === 'PLAYER').length, 4);
  const row = (await pool.query('SELECT count(*)::int AS n FROM owner_bootstrap')).rows[0];
  assert.equal(row.n, 1);
  OWNER = owners[0];
  const again = await reg('late', CODE);
  assert.equal(again.user.role, 'PLAYER');
});

test('4. Código OWNER inválido cadastra como PLAYER', { skip }, async () => {
  const u = await reg('inv', 'ERRADO1');
  assert.equal(u.user.role, 'PLAYER');
  assert.equal(u.user.isOriginalOwner, false);
});

test('1/22. Cadastro, login, sessão recuperada e logout', { skip }, async () => {
  const u = await reg('login');
  const me = await call('GET', '/api/auth/me', null, u.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, u.username);
  const bad = await call('POST', '/api/auth/login', { username: u.username, password: 'errada' });
  assert.equal(bad.status, 401);
  const dup = await call('POST', '/api/auth/register', { username: u.username.toUpperCase(), password: 'senha123' });
  assert.equal(dup.status, 409);
  const lo = await call('POST', '/api/auth/logout', null, u.token);
  assert.equal(lo.status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, u.token)).status, 401);
  const li = await call('POST', '/api/auth/login', { username: u.username, password: 'senha123' });
  assert.equal(li.status, 200);
  assert.equal(li.data.user.id, u.user.id, 'ID permanece igual após logout/login');
  const pw = (await pool.query('SELECT password_hash FROM users WHERE public_id = $1', [u.user.id])).rows[0].password_hash;
  assert.ok(pw.startsWith('scrypt$') && !pw.includes('senha123'), 'senha guardada com hash');
});

test('2. IDs únicos no formato NR3D-XXXXXXXX', { skip }, async () => {
  const us = await Promise.all(Array.from({ length: 15 }, () => reg('id')));
  const ids = us.map((u) => u.user.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.match(id, /^NR3D-[A-Z0-9]{8}$/));
});

test('7. Permissões de cargos no servidor', { skip }, async () => {
  MOD = await reg('mod');
  ADMIN = await reg('adm');
  const p1 = await reg('pl');
  assert.equal((await call('POST', `/api/admin/players/${MOD.user.id}/role`, { role: 'MOD' }, OWNER.token)).status, 200);
  assert.equal((await call('POST', `/api/admin/players/${ADMIN.user.id}/role`, { role: 'ADMIN' }, OWNER.token)).status, 200);
  // PLAYER não acessa o painel
  assert.equal((await call('GET', '/api/admin/players', null, p1.token)).status, 403);
  // MOD promove PLAYER → MOD e rebaixa de volta
  assert.equal((await call('POST', `/api/admin/players/${p1.user.id}/role`, { role: 'MOD' }, MOD.token)).status, 200);
  assert.equal((await call('POST', `/api/admin/players/${p1.user.id}/role`, { role: 'PLAYER' }, MOD.token)).status, 200);
  // MOD não mexe em ADMIN nem no próprio cargo; ADMIN não muda cargos
  assert.equal((await call('POST', `/api/admin/players/${ADMIN.user.id}/role`, { role: 'PLAYER' }, MOD.token)).status, 403);
  assert.equal((await call('POST', `/api/admin/players/${MOD.user.id}/role`, { role: 'PLAYER' }, MOD.token)).status, 403);
  assert.equal((await call('POST', `/api/admin/players/${p1.user.id}/role`, { role: 'MOD' }, ADMIN.token)).status, 403);
  // ADMIN não bane
  assert.equal((await call('POST', `/api/admin/players/${p1.user.id}/ban`, { reason: 'teste ban' }, ADMIN.token)).status, 403);
  // MOD não concede influenciador nem mexe em moedas
  assert.equal((await call('POST', `/api/admin/players/${p1.user.id}/influencer`, { grant: true }, MOD.token)).status, 403);
  // Ninguém consegue se dar cargo pelo cadastro
  const fake = await call('POST', '/api/auth/register', { username: 'fake' + n++, password: 'senha123', role: 'OWNER' });
  assert.equal(fake.data.user.role, 'PLAYER');
});

test('6. OWNER original protegido contra outro OWNER e MOD', { skip }, async () => {
  const o2 = await reg('own2');
  assert.equal((await call('POST', `/api/admin/players/${o2.user.id}/role`, { role: 'OWNER' }, OWNER.token)).status, 200);
  for (const t of [o2.token, MOD.token, ADMIN.token]) {
    assert.equal((await call('POST', `/api/admin/players/${OWNER.user.id}/kick`, { reason: 'tentativa' }, t)).status, 403);
    assert.equal((await call('POST', `/api/admin/players/${OWNER.user.id}/ban`, { reason: 'tentativa' }, t)).status, 403);
    assert.equal((await call('POST', `/api/admin/players/${OWNER.user.id}/role`, { role: 'PLAYER' }, t)).status, 403);
  }
  const me = await call('GET', '/api/auth/me', null, OWNER.token);
  assert.equal(me.data.user.role, 'OWNER');
});

test('8. Moedas infinitas: MOD compra sem saldo e sem desconto', { skip }, async () => {
  const before = (await call('GET', '/api/auth/me', null, MOD.token)).data.user;
  assert.equal(before.infiniteCoins, true);
  const r = await call('POST', '/api/shop/buy', { characterId: 'astro' }, MOD.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.coins, before.coins);
  assert.ok(r.data.user.ownedCharacters.includes('astro'));
  const adm = await call('POST', '/api/shop/buy', { characterId: 'astro' }, ADMIN.token);
  assert.equal(adm.status, 400, 'ADMIN usa economia normal');
});

test('9. Compra dos cinco personagens novos por exatamente 50 moedas', { skip }, async () => {
  const p = await reg('shop');
  const poor = await call('POST', '/api/shop/buy', { characterId: 'robo' }, p.token);
  assert.equal(poor.status, 400);
  assert.equal(poor.data.code, 'INSUFFICIENT_COINS');
  for (let i = 0; i < 3; i++) { const e = await earn(p.token, 90); assert.equal(e.data.accepted, true); }
  let coins = (await call('GET', '/api/auth/me', null, p.token)).data.user.coins;
  assert.equal(coins, 270);
  for (const id of ['astro', 'robo', 'pirata', 'zumbi', 'chef']) {
    const r = await call('POST', '/api/shop/buy', { characterId: id }, p.token);
    assert.equal(r.status, 200, id + ' ' + JSON.stringify(r.data));
    assert.equal(r.data.user.coins, coins - 50);
    coins -= 50;
  }
  assert.equal(coins, 20);
  const dup = await call('POST', '/api/shop/buy', { characterId: 'chef' }, p.token);
  assert.equal(dup.status, 409);
  const sel = await call('POST', '/api/characters/select', { characterId: 'pirata' }, p.token);
  assert.equal(sel.data.user.selectedCharacter, 'pirata');
  const li = await call('POST', '/api/auth/login', { username: p.username, password: 'senha123' });
  assert.equal(li.data.user.selectedCharacter, 'pirata');
  assert.equal(li.data.user.ownedCharacters.length, 5);
  assert.equal(li.data.user.coins, 20);
});

test('10/11/12. Influenciador: 999.000 uma única vez e personagem exclusivo', { skip }, async () => {
  const p = await reg('infl');
  assert.equal((await call('POST', '/api/characters/select', { characterId: 'criador' }, p.token)).status, 403);
  assert.equal((await call('POST', '/api/shop/buy', { characterId: 'criador' }, p.token)).status, 400);
  const g = await call('POST', `/api/admin/players/${p.user.id}/influencer`, { grant: true }, OWNER.token);
  assert.equal(g.status, 200);
  assert.equal(g.data.rewardGiven, true);
  let me = (await call('GET', '/api/auth/me', null, p.token)).data.user;
  assert.equal(me.coins, 999000);
  assert.equal(me.isInfluencer, true);
  assert.equal((await call('POST', '/api/characters/select', { characterId: 'criador' }, p.token)).status, 200);
  assert.equal((await call('POST', `/api/admin/players/${p.user.id}/influencer`, { grant: false }, OWNER.token)).status, 200);
  me = (await call('GET', '/api/auth/me', null, p.token)).data.user;
  assert.equal(me.selectedCharacter, 'runner', 'perde acesso ao personagem');
  assert.equal((await call('POST', '/api/characters/select', { characterId: 'criador' }, p.token)).status, 403);
  const g2 = await call('POST', `/api/admin/players/${p.user.id}/influencer`, { grant: true }, OWNER.token);
  assert.equal(g2.data.rewardGiven, false);
  me = (await call('GET', '/api/auth/me', null, p.token)).data.user;
  assert.equal(me.coins, 999000, 'sem segunda recompensa');
  const log = await call('GET', '/api/admin/influencers', null, OWNER.token);
  assert.equal(log.data.log.filter((x) => x.user.id === p.user.id).length, 3);
  const bad = await call('POST', '/api/admin/codes', { code: 'CRIA99', rewardType: 'character', rewardValue: 'criador' }, OWNER.token);
  assert.equal(bad.status, 400, 'código não pode dar o personagem de influenciador');
});

test('20. Códigos promocionais', { skip }, async () => {
  const p = await reg('code');
  const t = await call('POST', '/api/codes/redeem', { code: 'traveso' }, p.token);
  assert.equal(t.status, 200);
  assert.equal(t.data.reward.value, 'menino');
  assert.equal((await call('POST', '/api/codes/redeem', { code: 'TRAVESO' }, p.token)).status, 409);
  assert.equal((await call('POST', '/api/codes/redeem', { code: 'XXXXXXX' }, p.token)).status, 400);
  const s = await call('POST', '/api/codes/redeem', { code: 'NEONRUN' }, p.token);
  assert.equal(s.status, 200);
  assert.ok(['character', 'cape'].includes(s.data.reward.type));
  const c = await call('POST', '/api/admin/codes', { code: 'BONUS50', rewardType: 'coins', rewardValue: '50', maxUses: 1 }, OWNER.token);
  assert.equal(c.status, 201);
  assert.equal((await call('POST', '/api/admin/codes', { code: 'VIRAOWNER', rewardType: 'role', rewardValue: 'OWNER' }, OWNER.token)).status, 400);
  assert.equal((await call('POST', '/api/admin/codes', { code: 'MODCODE', rewardType: 'coins', rewardValue: '5' }, MOD.token)).status, 403);
  const r1 = await call('POST', '/api/codes/redeem', { code: 'BONUS50' }, p.token);
  assert.equal(r1.data.user.coins, 50);
  const p2 = await reg('code2');
  assert.equal((await call('POST', '/api/codes/redeem', { code: 'BONUS50' }, p2.token)).status, 400);
});

test('21. Ranking global com validação no servidor', { skip }, async () => {
  const p = await reg('rank');
  const s = await call('POST', '/api/runs/start', { mode: 'easy' }, p.token);
  const ok = await call('POST', '/api/runs/finish', { runId: s.data.runId, distance: 120.5, coins: 10, duration: 3 }, p.token);
  assert.equal(ok.data.accepted, true);
  assert.equal(ok.data.score, 120);
  const again = await call('POST', '/api/runs/finish', { runId: s.data.runId, distance: 120.5, coins: 10, duration: 3 }, p.token);
  assert.equal(again.status, 409, 'mesma partida não conta duas vezes');
  const s2 = await call('POST', '/api/runs/start', { mode: 'easy' }, p.token);
  const cheat = await call('POST', '/api/runs/finish', { runId: s2.data.runId, distance: 999999, coins: 5000, duration: 2 }, p.token);
  assert.equal(cheat.data.accepted, false);
  const lb = await call('GET', '/api/leaderboards/easy');
  const me = lb.data.entries.find((e) => e.id === p.user.id);
  assert.equal(me.score, 120);
  assert.equal(me.rank >= 1, true);
});

test('13. Mensagens privadas: entrega em tempo real, privacidade, duplicação e bloqueio', { skip }, async () => {
  const a = await reg('dma'), b = await reg('dmb'), c = await reg('dmc');
  const sb = await connect(b.token);
  const got = waitFor(sb, 'dm:new');
  const send = await call('POST', `/api/dm/${b.user.id}`, { body: 'oi B', nonce: 'nonce-001' }, a.token);
  assert.equal(send.status, 201);
  const ev = await got;
  assert.equal(ev.message.body, 'oi B');
  assert.equal(ev.from.id, a.user.id);
  const dup = await call('POST', `/api/dm/${b.user.id}`, { body: 'oi B', nonce: 'nonce-001' }, a.token);
  assert.equal(dup.data.duplicate, true);
  const convs = await call('GET', '/api/dm/conversations', null, b.token);
  assert.equal(convs.data.conversations[0].unread, 1);
  const msgs = await call('GET', `/api/dm/${a.user.id}/messages`, null, b.token);
  assert.equal(msgs.data.messages.length, 1);
  const cView = await call('GET', `/api/dm/${a.user.id}/messages`, null, c.token);
  assert.equal(cView.data.messages.length, 0, 'terceiro não vê a conversa');
  assert.equal((await call('POST', `/api/dm/${b.user.id}`, { body: 'x'.repeat(501), nonce: 'nonce-002' }, a.token)).status, 400);
  await call('POST', `/api/blocks/${a.user.id}`, null, b.token);
  assert.equal((await call('POST', `/api/dm/${b.user.id}`, { body: 'oi?', nonce: 'nonce-003' }, a.token)).status, 403);
});

test('14. Chat global entre contas, anti-flood, repetição e silenciamento', { skip }, async () => {
  const a = await reg('cha'), b = await reg('chb');
  const sa = await connect(a.token), sb = await connect(b.token);
  const recv = waitFor(sb, 'chat:message', (m) => m.body === 'olá pessoal');
  const ack = await new Promise((r) => sa.emit('chat:send', { body: 'olá pessoal' }, r));
  assert.equal(ack.ok, true);
  const m = await recv;
  assert.equal(m.user.id, a.user.id);
  assert.equal(m.user.role, 'PLAYER');
  const dupAck = await new Promise((r) => { setTimeout(() => sa.emit('chat:send', { body: 'olá pessoal' }, r), 900); });
  assert.equal(dupAck.ok, false);
  const hist = await call('GET', '/api/chat/global', null, b.token);
  assert.ok(hist.data.messages.some((x) => x.body === 'olá pessoal'), 'mensagem salva no PostgreSQL');
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await new Promise((r) => sb.emit('chat:send', { body: 'spam ' + i }, r)));
  assert.ok(results.some((r) => !r.ok), 'flood bloqueado');
  await call('POST', `/api/admin/players/${a.user.id}/mute`, { minutes: 5, reason: 'teste de silêncio' }, MOD.token);
  await sleep(1000);
  const muted = await new Promise((r) => sa.emit('chat:send', { body: 'posso falar?' }, r));
  assert.equal(muted.ok, false);
  assert.equal(muted.code, 'MUTED');
});

test('15/16. Notificações e denúncias', { skip }, async () => {
  const rep = await reg('rep'), bad = await reg('bad');
  const sent = await call('POST', '/api/chat/global', { body: 'mensagem ofensiva' }, bad.token);
  const r = await call('POST', '/api/reports', { targetId: bad.user.id, category: 'OFENSAS', description: 'ofendeu no chat', chatMessageId: sent.data.message.id }, rep.token);
  assert.equal(r.status, 201);
  assert.equal((await call('GET', '/api/admin/reports', null, rep.token)).status, 403);
  assert.equal((await call('GET', '/api/admin/reports', null, ADMIN.token)).status, 403);
  const list = await call('GET', '/api/admin/reports', null, MOD.token);
  assert.ok(list.data.reports.some((x) => x.id === r.data.reportId));
  const det = await call('GET', `/api/admin/reports/${r.data.reportId}`, null, MOD.token);
  assert.equal(det.data.report.evidence.body, 'mensagem ofensiva');
  assert.equal((await call('PATCH', `/api/admin/reports/${r.data.reportId}`, { status: 'PROCEDENTE', notes: 'confirmado' }, MOD.token)).status, 200);
  const notes = await call('GET', '/api/notifications', null, rep.token);
  assert.ok(notes.data.notifications.some((x) => x.type === 'REPORT' && /PROCEDENTE/.test(x.content)));
  assert.ok(notes.data.unread > 0);
  await call('POST', '/api/notifications/read', {}, rep.token);
  assert.equal((await call('GET', '/api/notifications', null, rep.token)).data.unread, 0);
});

test('17. KICK encerra a sessão ativa e permite voltar', { skip }, async () => {
  const p = await reg('kick');
  const s = await connect(p.token);
  const revoked = waitFor(s, 'session:revoked');
  assert.equal((await call('POST', `/api/admin/players/${MOD.user.id}/kick`, { reason: 'admin não expulsa mod' }, ADMIN.token)).status, 403);
  const k = await call('POST', `/api/admin/players/${p.user.id}/kick`, { reason: 'teste de kick' }, ADMIN.token);
  assert.equal(k.status, 200);
  assert.equal((await revoked).type, 'KICK');
  assert.equal((await call('GET', '/api/auth/me', null, p.token)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: p.username, password: 'senha123' })).status, 200);
});

test('18/19. BAN bloqueia login; UNBAN restaura sem perder dados', { skip }, async () => {
  const p = await reg('ban');
  await earn(p.token, 40);
  const b = await call('POST', `/api/admin/players/${p.user.id}/ban`, { reason: 'trapaça', hours: 1 }, MOD.token);
  assert.equal(b.status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, p.token)).status, 401);
  const li = await call('POST', '/api/auth/login', { username: p.username, password: 'senha123' });
  assert.equal(li.status, 403);
  assert.equal(li.data.code, 'BANNED');
  assert.ok(li.data.ban.expiresAt);
  assert.equal((await call('POST', `/api/admin/players/${p.user.id}/unban`, { reason: 'ok' }, MOD.token)).status, 200);
  const li2 = await call('POST', '/api/auth/login', { username: p.username, password: 'senha123' });
  assert.equal(li2.status, 200);
  assert.equal(li2.data.user.coins, 40);
});

test('23. /health confirma PostgreSQL', { skip }, async () => {
  const h = await call('GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.database, 'ok');
});
