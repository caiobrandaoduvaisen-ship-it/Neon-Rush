import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { CHARACTERS, CHAR_BY_ID, MODES, RUN_LIMITS, ACHIEVEMENTS } from '../catalog.js';
import { hasInfiniteCoins } from '../permissions.js';
import { audit, notify, addCoins, buildAccount, evaluateAchievements, publicUser } from '../services.js';
import { randomPick } from '../security.js';
import { HttpError, wrap, parse, allowAction, likeEscape } from '../util.js';

const r = Router();

r.get('/catalog', (req, res) => {
  res.json({ characters: CHARACTERS.map(({ id, name, type, price }) => ({ id, name, type, price: price || 0 })) });
});

// Loja: preço vem do servidor; OWNER e MOD não pagam (moedas infinitas).
r.post('/shop/buy', requireAuth, wrap(async (req, res) => {
  const { characterId } = parse(z.object({ characterId: z.string().max(32) }), req.body);
  const ch = CHAR_BY_ID.get(characterId);
  if (!ch || ch.type !== 'shop') throw new HttpError(400, 'Este personagem não está à venda', 'NOT_FOR_SALE');

  const out = await tx(async (db) => {
    const u = (await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0];
    const owned = await db.query('SELECT 1 FROM user_characters WHERE user_id = $1 AND character_id = $2', [u.id, ch.id]);
    if (owned.rowCount) throw new HttpError(409, 'Você já tem este personagem', 'ALREADY_OWNED');
    const infinite = hasInfiniteCoins(u);
    if (!infinite && u.coins < ch.price) {
      throw new HttpError(400, `Moedas insuficientes: faltam ${ch.price - u.coins}`, 'INSUFFICIENT_COINS');
    }
    const p = await db.query(
      'INSERT INTO purchases (user_id, character_id, price, paid, infinite) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
      [u.id, ch.id, ch.price, infinite ? 0 : ch.price, infinite]);
    if (!p.rowCount) throw new HttpError(409, 'Você já tem este personagem', 'ALREADY_OWNED');
    if (!infinite) await addCoins(db, u.id, -ch.price, 'PURCHASE', ch.id);
    await db.query("INSERT INTO user_characters (user_id, character_id, source) VALUES ($1,$2,'shop')", [u.id, ch.id]);
    await db.query('UPDATE users SET selected_character = $2 WHERE id = $1', [u.id, ch.id]);
    await notify(db, u.id, 'PURCHASE', infinite ? `🛒 ${ch.name} desbloqueado (moedas infinitas).` : `🛒 Você comprou ${ch.name} por ${ch.price} moedas.`, { characterId: ch.id });
    await audit(db, { actorId: u.id, action: 'PURCHASE', targetId: u.id, details: { characterId: ch.id, paid: infinite ? 0 : ch.price }, ip: req.ip });
    return evaluateAchievements(db, u.id);
  });
  res.json({ ok: true, achievements: out, user: await buildAccount(null, req.user.id) });
}));

r.post('/characters/select', requireAuth, wrap(async (req, res) => {
  const { characterId } = parse(z.object({ characterId: z.string().max(32) }), req.body);
  const ch = CHAR_BY_ID.get(characterId);
  if (!ch) throw new HttpError(400, 'Personagem inválido');
  const u = req.user;
  let allowed = ch.type === 'free';
  if (ch.type === 'influencer') allowed = !!u.is_influencer;
  else if (!allowed) allowed = (await q('SELECT 1 FROM user_characters WHERE user_id = $1 AND character_id = $2', [u.id, ch.id])).rowCount > 0;
  if (!allowed) throw new HttpError(403, ch.type === 'influencer' ? 'Personagem exclusivo de influenciadores' : 'Você ainda não desbloqueou este personagem', 'LOCKED');
  await q('UPDATE users SET selected_character = $2 WHERE id = $1', [u.id, ch.id]);
  res.json({ ok: true, user: await buildAccount(null, u.id) });
}));

// Resgate de códigos promocionais.
r.post('/codes/redeem', requireAuth, wrap(async (req, res) => {
  if (!allowAction('redeem:' + req.user.id, { max: 10, windowMs: 10 * 60 * 1000 })) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.', 'RATE_LIMIT');
  const { code } = parse(z.object({ code: z.string().trim().min(1, 'Digite um código').max(16) }), req.body);
  const c = code.toUpperCase();

  const result = await tx(async (db) => {
    const pc = (await db.query('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [c])).rows[0];
    if (!pc || !pc.active || (pc.expires_at && new Date(pc.expires_at) < new Date())) throw new HttpError(400, 'Código inválido.', 'INVALID_CODE');
    if (pc.max_uses && pc.uses >= pc.max_uses) throw new HttpError(400, 'Este código já atingiu o limite de usos.', 'CODE_EXHAUSTED');
    const used = await db.query('SELECT 1 FROM code_redemptions WHERE code = $1 AND user_id = $2', [c, req.user.id]);
    if (used.rowCount) throw new HttpError(409, 'Código já resgatado.', 'ALREADY_REDEEMED');
    const u = (await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0];
    const owned = new Set((await db.query('SELECT character_id FROM user_characters WHERE user_id = $1', [u.id])).rows.map((x) => x.character_id));

    let type = pc.reward_type, value = pc.reward_value;
    if (type === 'surprise') {
      const pool = CHARACTERS.filter((x) => x.type === 'code' && !owned.has(x.id)).map((x) => 'character:' + x.id);
      if (!u.has_cape) pool.push('cape');
      if (!pool.length) throw new HttpError(409, 'Você já tem tudo! O código não foi gasto.', 'NOTHING_LEFT');
      const pick = randomPick(pool);
      [type, value] = pick === 'cape' ? ['cape', null] : ['character', pick.split(':')[1]];
    }
    let message;
    if (type === 'character') {
      const ch = CHAR_BY_ID.get(value);
      if (!ch || ch.type === 'influencer' || ch.type === 'free') throw new HttpError(500, 'Código mal configurado');
      if (owned.has(ch.id)) throw new HttpError(409, `Você já tem ${ch.name}. O código não foi gasto.`, 'ALREADY_OWNED');
      await db.query("INSERT INTO user_characters (user_id, character_id, source) VALUES ($1,$2,'code')", [u.id, ch.id]);
      message = `🎉 Você ganhou: ${ch.name}!`;
    } else if (type === 'cape') {
      if (u.has_cape) throw new HttpError(409, 'Você já tem a CAPA. O código não foi gasto.', 'ALREADY_OWNED');
      await db.query('UPDATE users SET has_cape = true WHERE id = $1', [u.id]);
      message = '🦸 Você ganhou a CAPA!';
    } else if (type === 'coins') {
      const n = parseInt(value, 10);
      if (!(n > 0)) throw new HttpError(500, 'Código mal configurado');
      await addCoins(db, u.id, n, 'CODE', c);
      message = `🪙 Você ganhou ${n.toLocaleString('pt-BR')} moedas!`;
    } else {
      throw new HttpError(500, 'Código mal configurado');
    }
    await db.query('INSERT INTO code_redemptions (code, user_id, reward_type, reward_value) VALUES ($1,$2,$3,$4)', [c, u.id, type, value]);
    await db.query('UPDATE promo_codes SET uses = uses + 1 WHERE code = $1', [c]);
    await notify(db, u.id, 'REWARD', message.replace(/!$/, '') + ` (código ${c}).`, { code: c, type, value });
    await audit(db, { actorId: u.id, action: 'CODE_REDEEM', targetId: u.id, details: { code: c, type, value }, ip: req.ip });
    await evaluateAchievements(db, u.id);
    return { message, reward: { type, value } };
  });
  res.json({ ...result, user: await buildAccount(null, req.user.id) });
}));

// Partidas: o servidor marca o início e valida o resultado.
r.post('/runs/start', requireAuth, wrap(async (req, res) => {
  const { mode } = parse(z.object({ mode: z.enum(MODES, { errorMap: () => ({ message: 'Modo inválido' }) }) }), req.body);
  if (!allowAction('run-start:' + req.user.id, { max: 30, windowMs: 60 * 1000 })) throw new HttpError(429, 'Muitas partidas em pouco tempo', 'RATE_LIMIT');
  await q("UPDATE game_runs SET status = 'rejected', reject_reason = 'expired' WHERE user_id = $1 AND status = 'started' AND started_at < now() - interval '5 hours'", [req.user.id]);
  const run = (await q('INSERT INTO game_runs (user_id, mode) VALUES ($1,$2) RETURNING id', [req.user.id, mode])).rows[0];
  res.json({ runId: run.id });
}));

export function validateRun({ mode, distance, coins, duration, elapsed }) {
  const L = RUN_LIMITS;
  if (!(duration > 0)) return 'duração inválida';
  if (duration > L.maxDurationSeconds) return 'duração longa demais';
  if (duration > elapsed + L.durationSlackSeconds) return 'duração maior que o tempo real';
  if (distance < 0 || distance > duration * L.maxDistancePerSecond + 10) return 'distância impossível';
  if (coins < 0 || coins > duration * L.maxCoinsPerSecond + 15) return 'moedas impossíveis';
  if (mode === 'nocoin' && coins !== 0) return 'moedas no modo NO COIN';
  return null;
}

r.post('/runs/finish', requireAuth, wrap(async (req, res) => {
  const body = parse(z.object({
    runId: z.string().uuid('Partida inválida'),
    distance: z.number().finite().min(0).max(1e7),
    coins: z.number().int().min(0).max(1e6),
    duration: z.number().finite().min(0).max(1e6),
  }), req.body);

  const out = await tx(async (db) => {
    const run = (await db.query(
      "SELECT *, extract(epoch FROM now() - started_at)::float AS elapsed FROM game_runs WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [body.runId, req.user.id])).rows[0];
    if (!run) throw new HttpError(404, 'Partida não encontrada');
    if (run.status !== 'started') throw new HttpError(409, 'Esta partida já foi registrada', 'RUN_DONE');
    const reason = validateRun({ mode: run.mode, ...body, elapsed: run.elapsed });
    if (reason) {
      await db.query("UPDATE game_runs SET status = 'rejected', reject_reason = $2, finished_at = now(), distance = $3, coins = $4, duration = $5 WHERE id = $1",
        [run.id, reason, body.distance, body.coins, body.duration]);
      await audit(db, { actorId: req.user.id, action: 'RUN_REJECTED', targetId: req.user.id, details: { runId: run.id, reason, ...body }, ip: req.ip });
      return { accepted: false, reason };
    }
    const score = run.mode === 'nocoin' ? Math.round(body.duration * 10) / 10 : Math.floor(body.distance);
    const coins = run.mode === 'nocoin' ? 0 : body.coins;
    await db.query("UPDATE game_runs SET status = 'finished', finished_at = now(), distance = $2, coins = $3, duration = $4, score = $5 WHERE id = $1",
      [run.id, body.distance, coins, body.duration, score]);
    if (coins > 0) await addCoins(db, req.user.id, coins, 'RUN', run.id);
    const prev = (await db.query('SELECT score FROM best_scores WHERE user_id = $1 AND mode = $2', [req.user.id, run.mode])).rows[0];
    let record = false;
    if (score > 0 && (!prev || score > prev.score)) {
      record = true;
      await db.query(
        `INSERT INTO best_scores (user_id, mode, score, run_id, updated_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (user_id, mode) DO UPDATE SET score = EXCLUDED.score, run_id = EXCLUDED.run_id, updated_at = now()`,
        [req.user.id, run.mode, score, run.id]);
    }
    const achievements = await evaluateAchievements(db, req.user.id);
    return { accepted: true, score, best: record ? score : prev ? prev.score : score, record, coinsAdded: coins, achievements };
  });
  res.json({ ...out, user: await buildAccount(null, req.user.id) });
}));

r.get('/leaderboards/:mode', wrap(async (req, res) => {
  const mode = req.params.mode;
  if (!MODES.includes(mode)) throw new HttpError(400, 'Modo inválido');
  const rows = (await q(
    `SELECT u.public_id, u.username, u.role, u.is_influencer, u.is_original_owner, b.score
     FROM best_scores b JOIN users u ON u.id = b.user_id
     WHERE b.mode = $1 AND NOT EXISTS (
       SELECT 1 FROM bans x WHERE x.user_id = u.id AND x.revoked_at IS NULL AND (x.expires_at IS NULL OR x.expires_at > now()))
     ORDER BY b.score DESC, b.updated_at ASC LIMIT 50`, [mode])).rows;
  res.json({ mode, entries: rows.map((x, i) => ({ rank: i + 1, ...publicUser(x), score: x.score })) });
}));

r.get('/profile', requireAuth, wrap(async (req, res) => {
  const id = req.user.id;
  const [account, purchases, bests, ach, stats] = await Promise.all([
    buildAccount(null, id),
    q('SELECT character_id, price, paid, infinite, created_at FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
    q('SELECT mode, score FROM best_scores WHERE user_id = $1', [id]),
    q('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1', [id]),
    q("SELECT count(*)::int AS runs, coalesce(sum(coins),0)::int AS coins FROM game_runs WHERE user_id = $1 AND status = 'finished'", [id]),
  ]);
  const got = new Map(ach.rows.map((a) => [a.achievement_id, a.unlocked_at]));
  res.json({
    user: account,
    purchases: purchases.rows.map((p) => ({ characterId: p.character_id, name: CHAR_BY_ID.get(p.character_id)?.name || p.character_id, price: p.price, paid: p.paid, infinite: p.infinite, createdAt: p.created_at })),
    bestScores: Object.fromEntries(bests.rows.map((b) => [b.mode, b.score])),
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: got.has(a.id), unlockedAt: got.get(a.id) || null })),
    stats: stats.rows[0],
  });
}));

r.get('/players/search', requireAuth, wrap(async (req, res) => {
  const s = String(req.query.q || '').trim().slice(0, 20);
  if (s.length < 2) return res.json({ players: [] });
  const rows = (await q(
    `SELECT public_id, username, role, is_influencer, is_original_owner FROM users
     WHERE (public_id = upper($1) OR username ILIKE $2 ESCAPE '\\') AND id <> $3
     ORDER BY (lower(username) = lower($1)) DESC, username LIMIT 10`, [s, likeEscape(s) + '%', req.user.id])).rows;
  res.json({ players: rows.map(publicUser) });
}));

export default r;
