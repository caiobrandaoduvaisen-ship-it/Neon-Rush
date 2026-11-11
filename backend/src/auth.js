import { q } from './db.js';
import { hashToken } from './security.js';
import { activeBan, banInfo } from './services.js';
import { HttpError } from './util.js';

export async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const r = await q(
    `SELECT s.id AS session_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [hashToken(token)]);
  const row = r.rows[0];
  if (!row) return null;
  const { session_id, ...user } = row;
  const ban = await activeBan(null, user.id);
  if (ban) {
    await q("UPDATE sessions SET revoked_at = now(), revoked_reason = 'BAN' WHERE id = $1", [session_id]);
    return { banned: true, ban };
  }
  return { sessionId: session_id, user };
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

export async function requireAuth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Entre na sua conta para continuar', 'NO_SESSION');
    const s = await resolveSession(token);
    if (!s) throw new HttpError(401, 'Sua sessão terminou. Entre novamente.', 'SESSION_INVALID');
    if (s.banned) {
      const e = new HttpError(403, 'Esta conta está banida', 'BANNED');
      e.ban = banInfo(s.ban);
      throw e;
    }
    req.user = s.user;
    req.sessionId = s.sessionId;
    next();
  } catch (e) {
    next(e);
  }
}

export const requirePerm = (check) => (req, res, next) =>
  check(req.user) ? next() : next(new HttpError(403, 'Você não tem permissão para isso', 'FORBIDDEN'));
