import { q } from './db.js';
import { broadcastGlobal, emitToUser } from './hub.js';
import { activeMute, notify, publicUser } from './services.js';
import { HttpError, cleanText, allowAction } from './util.js';

const lastBody = new Map();

export const formatChat = (m) => ({
  id: m.id, body: m.body, createdAt: m.created_at,
  user: publicUser(m),
});

export async function recentGlobal(limit = 50, before = null) {
  const rows = (await q(
    `SELECT m.id, m.body, m.created_at, u.public_id, u.username, u.role, u.is_influencer, u.is_original_owner
     FROM chat_messages m JOIN users u ON u.id = m.user_id
     WHERE m.deleted_at IS NULL AND ($2::bigint IS NULL OR m.id < $2)
     ORDER BY m.id DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 100), before])).rows;
  return rows.reverse().map(formatChat);
}

export async function sendGlobal(user, raw) {
  const body = cleanText(raw, 300);
  const mute = await activeMute(null, user.id);
  if (mute) throw new HttpError(403, `Você está silenciado no chat até ${new Date(mute.expires_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 'MUTED');
  if (!allowAction('chat:' + user.id, { max: 5, windowMs: 10000, minIntervalMs: 800 })) throw new HttpError(429, 'Calma! Você está enviando mensagens rápido demais.', 'FLOOD');
  const last = lastBody.get(user.id);
  if (last && last.body === body.toLowerCase() && Date.now() - last.t < 30000) throw new HttpError(429, 'Você já enviou essa mesma mensagem.', 'DUPLICATE');
  lastBody.set(user.id, { body: body.toLowerCase(), t: Date.now() });

  const row = (await q('INSERT INTO chat_messages (user_id, body) VALUES ($1,$2) RETURNING id, body, created_at', [user.id, body])).rows[0];
  const msg = formatChat({ ...row, ...user, id: row.id, created_at: row.created_at, body: row.body });
  broadcastGlobal('chat:message', msg);

  // Menções com @nome geram notificação.
  const names = [...new Set((body.match(/@([A-Za-z0-9_.]{3,20})/g) || []).map((s) => s.slice(1).toLowerCase()))].slice(0, 3);
  for (const n of names) {
    const t = (await q('SELECT id FROM users WHERE lower(username) = $1 AND id <> $2', [n, user.id])).rows[0];
    if (t) await notify(null, t.id, 'CHAT_MENTION', `💬 ${user.username} mencionou você no chat global.`, { messageId: row.id });
  }
  return msg;
}

export function notifyDeleted(id) {
  broadcastGlobal('chat:deleted', { id });
}

export { emitToUser };
