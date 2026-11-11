import { q } from './db.js';
import { emitToUser } from './hub.js';
import { ACHIEVEMENTS } from './catalog.js';
import { hasInfiniteCoins, isStaff, canViewReports, canManageCodes, canViewAudit, canViewInfluencers } from './permissions.js';

export async function audit(db, { actorId = null, action, targetId = null, details = {}, ip = null }) {
  await (db || { query: q }).query(
    'INSERT INTO audit_log (actor_id, action, target_id, details, ip) VALUES ($1,$2,$3,$4,$5)',
    [actorId, action, targetId, JSON.stringify(details), ip],
  );
}

export async function notify(db, userId, type, content, data = {}) {
  const r = await (db || { query: q }).query(
    'INSERT INTO notifications (user_id, type, content, data) VALUES ($1,$2,$3,$4) RETURNING id, type, content, data, created_at, read_at',
    [userId, type, content, JSON.stringify(data)],
  );
  const n = r.rows[0];
  // Envia depois do commit da transação atual (próximo ciclo).
  setImmediate(() => emitToUser(userId, 'notification', formatNotification(n)));
  return n;
}

export const formatNotification = (n) => ({ id: n.id, type: n.type, content: n.content, data: n.data, createdAt: n.created_at, read: !!n.read_at });

export async function addCoins(db, userId, delta, reason, ref = null) {
  const r = await db.query('UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins', [userId, delta]);
  const balance = r.rows[0].coins;
  await db.query('INSERT INTO coin_ledger (user_id, delta, balance_after, reason, ref) VALUES ($1,$2,$3,$4,$5)', [userId, delta, balance, reason, ref]);
  return balance;
}

export async function activeBan(db, userId) {
  const r = await (db || { query: q }).query(
    `SELECT id, reason, created_at, expires_at FROM bans
     WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

export async function activeMute(db, userId) {
  const r = await (db || { query: q }).query(
    `SELECT id, reason, expires_at FROM chat_mutes
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY expires_at DESC LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

export const banInfo = (b) => b && { reason: b.reason, since: b.created_at, expiresAt: b.expires_at, permanent: !b.expires_at };

export function publicUser(u) {
  return { id: u.public_id, username: u.username, role: u.role, isInfluencer: !!u.is_influencer, isOriginalOwner: !!u.is_original_owner };
}

export async function buildAccount(db, userId) {
  db = db || { query: q };
  const u = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!u) return null;
  const [owned, unreadN, unreadM, ban, mute] = await Promise.all([
    db.query('SELECT character_id FROM user_characters WHERE user_id = $1 ORDER BY acquired_at', [userId]),
    db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
    db.query(`SELECT count(*)::int AS n FROM dm_messages m JOIN conversations c ON c.id = m.conversation_id
              WHERE (c.user_a = $1 OR c.user_b = $1) AND m.sender_id <> $1 AND m.read_at IS NULL`, [userId]),
    activeBan(db, userId),
    activeMute(db, userId),
  ]);
  return {
    ...publicUser(u),
    coins: u.coins,
    infiniteCoins: hasInfiniteCoins(u),
    selectedCharacter: u.selected_character,
    ownedCharacters: owned.rows.map((r) => r.character_id),
    hasCape: u.has_cape,
    createdAt: u.created_at,
    status: ban ? 'BANIDO' : 'ATIVO',
    mutedUntil: mute ? mute.expires_at : null,
    unreadNotifications: unreadN.rows[0].n,
    unreadMessages: unreadM.rows[0].n,
    permissions: {
      panel: isStaff(u),
      reports: canViewReports(u),
      codes: canManageCodes(u),
      audit: canViewAudit(u),
      influencers: canViewInfluencers(u),
    },
  };
}

const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

// Avalia conquistas no servidor a partir dos dados gravados.
export async function evaluateAchievements(db, userId) {
  const s = (await db.query(
    `SELECT
       (SELECT count(*) FROM game_runs WHERE user_id = $1 AND status = 'finished')::int AS runs,
       (SELECT coalesce(max(distance), 0) FROM game_runs WHERE user_id = $1 AND status = 'finished' AND mode <> 'nocoin') AS best_distance,
       (SELECT coalesce(max(duration), 0) FROM game_runs WHERE user_id = $1 AND status = 'finished' AND mode = 'nocoin') AS best_nocoin,
       (SELECT count(*) FROM best_scores WHERE user_id = $1 AND score > 0)::int AS scores,
       (SELECT count(*) FROM purchases WHERE user_id = $1)::int AS purchases,
       (SELECT count(*) FROM user_characters WHERE user_id = $1)::int AS unlocks`, [userId])).rows[0];
  const earned = [];
  if (s.runs >= 1) earned.push('FIRST_RUN');
  if (s.runs >= 10) earned.push('RUNS_10');
  if (s.runs >= 50) earned.push('RUNS_50');
  if (s.scores >= 1) earned.push('FIRST_SCORE');
  if (s.best_distance >= 1000) earned.push('DIST_1000');
  if (s.best_distance >= 5000) earned.push('DIST_5000');
  if (s.best_nocoin >= 30) earned.push('NOCOIN_30');
  if (s.purchases >= 1) earned.push('FIRST_PURCHASE');
  if (s.unlocks >= 1) earned.push('FIRST_UNLOCK');
  const unlocked = [];
  for (const id of earned) {
    const r = await db.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING achievement_id', [userId, id]);
    if (r.rowCount) {
      const a = ACH_BY_ID.get(id);
      unlocked.push(a);
      await notify(db, userId, 'ACHIEVEMENT', `🏅 Conquista desbloqueada: ${a.name}`, { achievement: id });
    }
  }
  return unlocked;
}

export async function findUserByPublicId(db, publicId, forUpdate = false) {
  const r = await (db || { query: q }).query(`SELECT * FROM users WHERE public_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [String(publicId || '').toUpperCase()]);
  return r.rows[0] || null;
}
