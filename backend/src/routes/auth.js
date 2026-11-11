import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { hashPassword, verifyPassword, DUMMY_HASH, newToken, hashToken, newPublicId, safeEqual } from '../security.js';
import { audit, notify, buildAccount, activeBan, banInfo } from '../services.js';
import { closeSession } from '../hub.js';
import { HttpError, wrap, parse, allowAction } from '../util.js';

const r = Router();
const mult = config.isTest ? 100 : 1;
const msg = { message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } };
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 * mult, standardHeaders: true, legacyHeaders: false, ...msg });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15 * mult, standardHeaders: true, legacyHeaders: false, ...msg });

const usernameSchema = z.string({ required_error: 'Informe o nome de usuário' }).trim()
  .regex(/^[A-Za-z0-9_.]{3,20}$/, 'Nome de usuário: 3 a 20 letras, números, _ ou .');
const passwordSchema = z.string({ required_error: 'Informe a senha' })
  .min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72, 'A senha pode ter no máximo 72 caracteres');

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  ownerCode: z.string().max(32).optional().nullable(),
});
const loginSchema = z.object({ username: z.string().trim().min(1, 'Informe o nome de usuário').max(20), password: z.string().min(1, 'Informe a senha').max(72) });

async function createSession(db, userId, req) {
  const token = newToken();
  const s = await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5) RETURNING id`,
    [userId, hashToken(token), String(config.sessionTtlDays), String(req.headers['user-agent'] || '').slice(0, 200), req.ip]);
  return { token, sessionId: s.rows[0].id };
}

r.post('/register', registerLimiter, wrap(async (req, res) => {
  const { username, password, ownerCode } = parse(registerSchema, req.body);
  const code = (ownerCode || '').trim().toUpperCase();
  if (code && !allowAction('owner-code:' + req.ip, { max: config.isTest ? 50 : 5, windowMs: 60 * 60 * 1000 })) {
    await audit(null, { action: 'OWNER_CODE_RATE_LIMITED', ip: req.ip });
    throw new HttpError(429, 'Muitas tentativas de código. Aguarde uma hora.', 'RATE_LIMIT');
  }
  const passwordHash = await hashPassword(password);

  const result = await tx(async (db) => {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
    if (exists.rowCount) throw new HttpError(409, 'Esse nome de usuário já está em uso', 'USERNAME_TAKEN');

    let user = null;
    for (let i = 0; i < 8 && !user; i++) {
      const pid = newPublicId();
      const reserved = await db.query('INSERT INTO public_ids (public_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING public_id', [pid]);
      if (!reserved.rowCount) continue;
      user = (await db.query('INSERT INTO users (public_id, username, password_hash) VALUES ($1,$2,$3) RETURNING *', [pid, username, passwordHash])).rows[0];
    }
    if (!user) throw new HttpError(500, 'Não foi possível gerar o ID. Tente novamente.');

    let becameOwner = false;
    if (code) {
      const valid = !!config.ownerCode && safeEqual(code, config.ownerCode);
      if (valid) {
        // Operação atômica: só a primeira transação consegue inserir a linha id=1.
        const ins = await db.query('INSERT INTO owner_bootstrap (id, user_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING RETURNING user_id', [user.id]);
        if (ins.rowCount) {
          await db.query("UPDATE users SET role = 'OWNER', is_original_owner = true WHERE id = $1", [user.id]);
          await audit(db, { actorId: user.id, action: 'OWNER_BOOTSTRAP', targetId: user.id, details: { username }, ip: req.ip });
          await notify(db, user.id, 'ROLE_CHANGE', '👑 Você é o OWNER original do Neon Rush 3D.');
          becameOwner = true;
        } else {
          await audit(db, { actorId: user.id, action: 'OWNER_CODE_REUSE_ATTEMPT', targetId: user.id, ip: req.ip });
        }
      } else {
        await audit(db, { actorId: user.id, action: 'OWNER_CODE_INVALID', targetId: user.id, ip: req.ip });
      }
    }
    await audit(db, { actorId: user.id, action: 'REGISTER', targetId: user.id, details: { username }, ip: req.ip });
    await notify(db, user.id, 'WELCOME', `Bem-vindo ao Neon Rush 3D, ${username}! Seu ID é ${user.public_id}.`);
    const session = await createSession(db, user.id, req);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return { token: session.token, userId: user.id, becameOwner };
  });

  res.status(201).json({ token: result.token, user: await buildAccount(null, result.userId) });
}));

r.post('/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const u = (await q('SELECT * FROM users WHERE lower(username) = lower($1)', [username])).rows[0];
  const ok = await verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) {
    await audit(null, { action: 'LOGIN_FAILED', targetId: u ? u.id : null, ip: req.ip });
    throw new HttpError(401, 'Usuário ou senha incorretos', 'BAD_CREDENTIALS');
  }
  const ban = await activeBan(null, u.id);
  if (ban) {
    const e = new HttpError(403, ban.expires_at ? 'Esta conta está banida temporariamente' : 'Esta conta foi banida permanentemente', 'BANNED');
    e.ban = banInfo(ban);
    throw e;
  }
  const session = await tx(async (db) => {
    const s = await createSession(db, u.id, req);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
    await audit(db, { actorId: u.id, action: 'LOGIN', targetId: u.id, ip: req.ip });
    return s;
  });
  res.json({ token: session.token, user: await buildAccount(null, u.id) });
}));

r.post('/logout', requireAuth, wrap(async (req, res) => {
  await q("UPDATE sessions SET revoked_at = now(), revoked_reason = 'LOGOUT' WHERE id = $1", [req.sessionId]);
  closeSession(req.sessionId);
  res.json({ ok: true });
}));

r.get('/me', requireAuth, wrap(async (req, res) => {
  res.json({ user: await buildAccount(null, req.user.id) });
}));

export default r;
