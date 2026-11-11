import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { CHAR_BY_ID, INFLUENCER_REWARD, REPORT_STATUSES } from '../catalog.js';
import {
  isStaff, canKick, canBan, canUnban, canMute, canSetRole, canManageInfluencer,
  canViewReports, canManageCodes, canViewAudit, canViewInfluencers, allowedActions, hasInfiniteCoins,
} from '../permissions.js';
import { audit, notify, addCoins, activeBan, activeMute, findUserByPublicId, publicUser, banInfo } from '../services.js';
import { emitToUser, forceLogout } from '../hub.js';
import { HttpError, wrap, parse, likeEscape } from '../util.js';

const r = Router();
r.use(requireAuth, requirePerm(isStaff));

const reasonSchema = z.string().trim().min(3, 'Informe o motivo').max(300, 'Motivo longo demais');
const deny = () => { throw new HttpError(403, 'Você não tem permissão para esta ação', 'FORBIDDEN'); };
const label = (u) => `${u.username} (${u.public_id})`;

async function lockTarget(db, publicId) {
  const t = await findUserByPublicId(db, publicId, true);
  if (!t) throw new HttpError(404, 'Jogador não encontrado');
  return t;
}

function summary(u, ban, mute) {
  return {
    ...publicUser(u),
    coins: u.coins,
    infiniteCoins: hasInfiniteCoins(u),
    status: ban ? 'BANIDO' : 'ATIVO',
    muted: !!mute,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

// ---------- Jogadores ----------
r.get('/players', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim().slice(0, 30);
  const rows = (await q(
    `SELECT u.*,
       EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned,
       EXISTS (SELECT 1 FROM chat_mutes m WHERE m.user_id = u.id AND m.revoked_at IS NULL AND m.expires_at > now()) AS muted
     FROM users u
     WHERE $1 = '' OR u.public_id ILIKE $2 ESCAPE '\\' OR u.username ILIKE $3 ESCAPE '\\'
     ORDER BY u.created_at DESC LIMIT 40`, [s, likeEscape(s.toUpperCase()) + '%', '%' + likeEscape(s) + '%'])).rows;
  res.json({ players: rows.map((u) => summary(u, u.banned, u.muted)) });
}));

r.get('/players/:publicId', wrap(async (req, res) => {
  const t = await findUserByPublicId(null, req.params.publicId);
  if (!t) throw new HttpError(404, 'Jogador não encontrado');
  const [ban, mute, bans, kicks, roles, infl, best] = await Promise.all([
    activeBan(null, t.id), activeMute(null, t.id),
    q('SELECT b.*, a.username AS by_name, v.username AS revoked_name FROM bans b JOIN users a ON a.id = b.banned_by LEFT JOIN users v ON v.id = b.revoked_by WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 20', [t.id]),
    q('SELECT k.*, a.username AS by_name FROM kicks k JOIN users a ON a.id = k.kicked_by WHERE k.user_id = $1 ORDER BY k.created_at DESC LIMIT 20', [t.id]),
    q('SELECT r.*, a.username AS by_name FROM role_changes r JOIN users a ON a.id = r.changed_by WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 20', [t.id]),
    q('SELECT l.*, a.username AS by_name FROM influencer_log l JOIN users a ON a.id = l.by_user WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 20', [t.id]),
    q('SELECT mode, score FROM best_scores WHERE user_id = $1', [t.id]),
  ]);
  const history = [
    ...bans.rows.map((b) => ({ type: 'BAN', at: b.created_at, by: b.by_name, reason: b.reason, expiresAt: b.expires_at, revokedAt: b.revoked_at, revokedBy: b.revoked_name })),
    ...kicks.rows.map((k) => ({ type: 'KICK', at: k.created_at, by: k.by_name, reason: k.reason })),
    ...roles.rows.map((x) => ({ type: 'CARGO', at: x.created_at, by: x.by_name, reason: `${x.old_role} → ${x.new_role}` })),
    ...infl.rows.map((x) => ({ type: x.action === 'GRANT' ? 'INFLUENCIADOR+' : 'INFLUENCIADOR-', at: x.created_at, by: x.by_name, reason: x.reward_granted ? `+${INFLUENCER_REWARD.toLocaleString('pt-BR')} moedas` : '' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({
    player: { ...summary(t, ban, mute), ban: banInfo(ban), mutedUntil: mute?.expires_at || null, bestScores: Object.fromEntries(best.rows.map((b) => [b.mode, b.score])) },
    history,
    allowed: allowedActions(req.user, t),
  });
}));

r.post('/players/:publicId/kick', wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: reasonSchema }), req.body);
  const t = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canKick(req.user, t)) deny();
    await db.query('INSERT INTO kicks (user_id, kicked_by, reason) VALUES ($1,$2,$3)', [t.id, req.user.id, reason]);
    const s = await db.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'KICK' WHERE user_id = $1 AND revoked_at IS NULL", [t.id]);
    await audit(db, { actorId: req.user.id, action: 'KICK', targetId: t.id, details: { reason, sessions: s.rowCount }, ip: req.ip });
    await notify(db, t.id, 'KICK', `⛔ Você foi expulso da sessão por ${req.user.username}. Motivo: ${reason}`);
    return t;
  });
  forceLogout(t.id, { type: 'KICK', reason, by: req.user.username });
  res.json({ ok: true, message: `${label(t)} foi expulso.` });
}));

r.post('/players/:publicId/ban', wrap(async (req, res) => {
  const { reason, hours } = parse(z.object({ reason: reasonSchema, hours: z.number().int().min(1).max(24 * 365 * 5).nullable().optional() }), req.body);
  const out = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canBan(req.user, t)) deny();
    if (await activeBan(db, t.id)) throw new HttpError(409, 'Este jogador já está banido');
    const b = (await db.query(
      `INSERT INTO bans (user_id, banned_by, reason, expires_at) VALUES ($1,$2,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4::int * interval '1 hour') END) RETURNING *`,
      [t.id, req.user.id, reason, hours ?? null])).rows[0];
    await db.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'BAN' WHERE user_id = $1 AND revoked_at IS NULL", [t.id]);
    await audit(db, { actorId: req.user.id, action: 'BAN', targetId: t.id, details: { reason, hours: hours ?? 'permanente' }, ip: req.ip });
    await notify(db, t.id, 'BAN', `🚫 Sua conta foi banida ${b.expires_at ? 'até ' + new Date(b.expires_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'permanentemente'}. Motivo: ${reason}`);
    return { t, b };
  });
  forceLogout(out.t.id, { type: 'BAN', reason, expiresAt: out.b.expires_at });
  res.json({ ok: true, message: `${label(out.t)} foi banido.` });
}));

r.post('/players/:publicId/unban', wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  const t = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canUnban(req.user, t)) deny();
    const ban = await activeBan(db, t.id);
    if (!ban) throw new HttpError(409, 'Este jogador não está banido');
    await db.query('UPDATE bans SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1', [ban.id, req.user.id, reason || null]);
    await audit(db, { actorId: req.user.id, action: 'UNBAN', targetId: t.id, details: { banId: ban.id, reason }, ip: req.ip });
    await notify(db, t.id, 'UNBAN', '✅ Seu banimento foi removido. Bem-vindo de volta!');
    return t;
  });
  res.json({ ok: true, message: `${label(t)} foi desbanido.` });
}));

r.post('/players/:publicId/mute', wrap(async (req, res) => {
  const { reason, minutes } = parse(z.object({ reason: reasonSchema, minutes: z.number().int().min(1).max(7 * 24 * 60) }), req.body);
  const t = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canMute(req.user, t)) deny();
    await db.query("INSERT INTO chat_mutes (user_id, muted_by, reason, expires_at) VALUES ($1,$2,$3, now() + ($4::int * interval '1 minute'))", [t.id, req.user.id, reason, minutes]);
    await audit(db, { actorId: req.user.id, action: 'MUTE', targetId: t.id, details: { reason, minutes }, ip: req.ip });
    await notify(db, t.id, 'CHAT_MUTE', `🔇 Você foi silenciado no chat global por ${minutes} min. Motivo: ${reason}`);
    return t;
  });
  emitToUser(t.id, 'account:update', {});
  res.json({ ok: true, message: `${label(t)} foi silenciado por ${minutes} min.` });
}));

r.post('/players/:publicId/unmute', wrap(async (req, res) => {
  const t = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canMute(req.user, t)) deny();
    const u = await db.query('UPDATE chat_mutes SET revoked_at = now(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()', [t.id, req.user.id]);
    if (!u.rowCount) throw new HttpError(409, 'Este jogador não está silenciado');
    await audit(db, { actorId: req.user.id, action: 'UNMUTE', targetId: t.id, ip: req.ip });
    await notify(db, t.id, 'CHAT_MUTE', '🔊 Você pode voltar a falar no chat global.');
    return t;
  });
  emitToUser(t.id, 'account:update', {});
  res.json({ ok: true, message: `${label(t)} pode falar no chat novamente.` });
}));

r.post('/players/:publicId/role', wrap(async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['OWNER', 'ADMIN', 'MOD', 'PLAYER']) }), req.body);
  const t = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canSetRole(req.user, t, role)) deny();
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [t.id, role]);
    await db.query('INSERT INTO role_changes (user_id, old_role, new_role, changed_by) VALUES ($1,$2,$3,$4)', [t.id, t.role, role, req.user.id]);
    await audit(db, { actorId: req.user.id, action: 'ROLE_CHANGE', targetId: t.id, details: { from: t.role, to: role }, ip: req.ip });
    await notify(db, t.id, 'ROLE_CHANGE', `🎖️ Seu cargo mudou: ${t.role} → ${role}.`, { from: t.role, to: role });
    return t;
  });
  emitToUser(t.id, 'account:update', {});
  res.json({ ok: true, message: `${label(t)} agora é ${role}.` });
}));

r.post('/players/:publicId/influencer', wrap(async (req, res) => {
  const { grant } = parse(z.object({ grant: z.boolean() }), req.body);
  const out = await tx(async (db) => {
    const t = await lockTarget(db, req.params.publicId);
    if (!canManageInfluencer(req.user, t)) deny();
    if (grant === t.is_influencer) throw new HttpError(409, grant ? 'Já é influenciador' : 'Não é influenciador');
    let rewardGiven = false;
    if (grant) {
      await db.query('UPDATE users SET is_influencer = true WHERE id = $1', [t.id]);
      // Recompensa única por conta: a coluna só é preenchida uma vez.
      const first = await db.query('UPDATE users SET influencer_reward_granted_at = now() WHERE id = $1 AND influencer_reward_granted_at IS NULL RETURNING id', [t.id]);
      if (first.rowCount) {
        rewardGiven = true;
        await addCoins(db, t.id, INFLUENCER_REWARD, 'INFLUENCER_REWARD');
      }
      await notify(db, t.id, 'INFLUENCER_GRANT', '⭐ Você agora é INFLUENCIADOR! O personagem CRIADOR foi liberado.');
      if (rewardGiven) await notify(db, t.id, 'INFLUENCER_REWARD', `🪙 Você recebeu ${INFLUENCER_REWARD.toLocaleString('pt-BR')} moedas de influenciador!`);
    } else {
      await db.query("UPDATE users SET is_influencer = false, selected_character = CASE WHEN selected_character = 'criador' THEN 'runner' ELSE selected_character END WHERE id = $1", [t.id]);
      await notify(db, t.id, 'INFLUENCER_REVOKE', 'Sua designação de influenciador foi removida.');
    }
    await db.query('INSERT INTO influencer_log (user_id, action, by_user, reward_granted) VALUES ($1,$2,$3,$4)', [t.id, grant ? 'GRANT' : 'REVOKE', req.user.id, rewardGiven]);
    await audit(db, { actorId: req.user.id, action: grant ? 'INFLUENCER_GRANT' : 'INFLUENCER_REVOKE', targetId: t.id, details: { rewardGiven }, ip: req.ip });
    return { t, rewardGiven };
  });
  emitToUser(out.t.id, 'account:update', {});
  res.json({ ok: true, rewardGiven: out.rewardGiven, message: grant ? `${label(out.t)} agora é influenciador${out.rewardGiven ? ' (+999.000 moedas)' : ' (recompensa já recebida antes)'}.` : `${label(out.t)} não é mais influenciador.` });
}));

// ---------- Denúncias ----------
r.get('/reports', requirePerm(canViewReports), wrap(async (req, res) => {
  const status = REPORT_STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = (await q(
    `SELECT r.id, r.category, r.status, r.context_type, r.created_at, r.updated_at,
       t.public_id AS t_id, t.username AS t_name, a.username AS assigned_name
     FROM reports r JOIN users t ON t.id = r.reported_id LEFT JOIN users a ON a.id = r.assigned_to
     WHERE $1::text IS NULL OR r.status = $1 ORDER BY r.created_at DESC LIMIT 100`, [status])).rows;
  res.json({ reports: rows.map((x) => ({ id: x.id, category: x.category, status: x.status, context: x.context_type, createdAt: x.created_at, updatedAt: x.updated_at, reported: { id: x.t_id, username: x.t_name }, assignedTo: x.assigned_name })) });
}));

r.get('/reports/:id', requirePerm(canViewReports), wrap(async (req, res) => {
  const x = (await q(
    `SELECT r.*, t.public_id AS t_id, t.username AS t_name, t.role AS t_role, p.public_id AS p_id, p.username AS p_name, a.username AS assigned_name
     FROM reports r JOIN users t ON t.id = r.reported_id JOIN users p ON p.id = r.reporter_id LEFT JOIN users a ON a.id = r.assigned_to WHERE r.id = $1`, [Number(req.params.id)])).rows[0];
  if (!x) throw new HttpError(404, 'Denúncia não encontrada');
  // Leitura de mensagem privada só acontece aqui, e fica registrada na auditoria.
  if (x.context_type === 'dm') await audit(null, { actorId: req.user.id, action: 'REPORT_DM_VIEWED', targetId: x.reported_id, details: { reportId: x.id }, ip: req.ip });
  res.json({ report: {
    id: x.id, category: x.category, description: x.description, status: x.status, notes: x.notes, context: x.context_type, evidence: x.evidence,
    createdAt: x.created_at, updatedAt: x.updated_at, assignedTo: x.assigned_name,
    reported: { id: x.t_id, username: x.t_name, role: x.t_role },
    reporter: { id: x.p_id, username: x.p_name }, // visível só para a equipe
  } });
}));

r.patch('/reports/:id', requirePerm(canViewReports), wrap(async (req, res) => {
  const b = parse(z.object({ status: z.enum(REPORT_STATUSES), notes: z.string().max(2000).optional() }), req.body);
  const out = await tx(async (db) => {
    const x = (await db.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!x) throw new HttpError(404, 'Denúncia não encontrada');
    await db.query('UPDATE reports SET status = $2, notes = coalesce($3, notes), assigned_to = $4, updated_at = now() WHERE id = $1', [x.id, b.status, b.notes ?? null, req.user.id]);
    await audit(db, { actorId: req.user.id, action: 'REPORT_UPDATE', targetId: x.reported_id, details: { reportId: x.id, from: x.status, to: b.status }, ip: req.ip });
    if (x.status !== b.status && ['PROCEDENTE', 'NAO_PROCEDENTE', 'ENCERRADA'].includes(b.status)) {
      await notify(db, x.reporter_id, 'REPORT', `🚩 Sua denúncia #${x.id} foi analisada: ${b.status.replace('_', ' ')}.`, { reportId: x.id });
    }
    return x.id;
  });
  res.json({ ok: true, id: out });
}));

// ---------- Códigos promocionais (OWNER) ----------
const codeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,16}$/, 'Código: 4 a 16 letras ou números'),
  rewardType: z.enum(['character', 'cape', 'coins', 'surprise']),
  rewardValue: z.string().max(32).nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  active: z.boolean().optional(),
});
function checkReward(type, value) {
  if (type === 'character') {
    const ch = CHAR_BY_ID.get(value);
    if (!ch || !['code', 'shop'].includes(ch.type)) throw new HttpError(400, 'Escolha um personagem válido (o de influenciador não pode ser dado por código)');
  }
  if (type === 'coins' && !(parseInt(value, 10) > 0 && parseInt(value, 10) <= 1000000)) throw new HttpError(400, 'Quantidade de moedas inválida (1 a 1.000.000)');
}

r.get('/codes', requirePerm(canManageCodes), wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM promo_codes ORDER BY is_builtin DESC, created_at DESC')).rows;
  res.json({ codes: rows.map((c) => ({ code: c.code, rewardType: c.reward_type, rewardValue: c.reward_value, maxUses: c.max_uses, uses: c.uses, expiresAt: c.expires_at, active: c.active, builtin: c.is_builtin, createdAt: c.created_at })) });
}));

r.post('/codes', requirePerm(canManageCodes), wrap(async (req, res) => {
  const b = parse(codeSchema, req.body);
  checkReward(b.rewardType, b.rewardValue);
  const ins = await q(
    `INSERT INTO promo_codes (code, reward_type, reward_value, max_uses, expires_at, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING code`,
    [b.code, b.rewardType, ['character', 'coins'].includes(b.rewardType) ? b.rewardValue : null, b.maxUses ?? null, b.expiresAt ?? null, b.active ?? true, req.user.id]);
  if (!ins.rowCount) throw new HttpError(409, 'Este código já existe');
  await audit(null, { actorId: req.user.id, action: 'CODE_CREATE', details: b, ip: req.ip });
  res.status(201).json({ ok: true });
}));

r.patch('/codes/:code', requirePerm(canManageCodes), wrap(async (req, res) => {
  const b = parse(codeSchema.partial().omit({ code: true }), req.body);
  const c = (await q('SELECT * FROM promo_codes WHERE code = $1', [String(req.params.code).toUpperCase()])).rows[0];
  if (!c) throw new HttpError(404, 'Código não encontrado');
  if (c.is_builtin && (b.rewardType || b.rewardValue !== undefined)) throw new HttpError(400, 'A recompensa dos códigos originais não pode ser alterada');
  const type = b.rewardType || c.reward_type, value = b.rewardValue !== undefined ? b.rewardValue : c.reward_value;
  checkReward(type, value);
  await q(
    `UPDATE promo_codes SET reward_type = $2, reward_value = $3,
       max_uses = CASE WHEN $4 THEN $5::int ELSE max_uses END,
       expires_at = CASE WHEN $6 THEN $7::timestamptz ELSE expires_at END,
       active = coalesce($8, active) WHERE code = $1`,
    [c.code, type, ['character', 'coins'].includes(type) ? value : null, b.maxUses !== undefined, b.maxUses ?? null, b.expiresAt !== undefined, b.expiresAt ?? null, b.active ?? null]);
  await audit(null, { actorId: req.user.id, action: 'CODE_UPDATE', details: { code: c.code, ...b }, ip: req.ip });
  res.json({ ok: true });
}));

// ---------- Auditoria e influenciadores (OWNER) ----------
r.get('/audit', requirePerm(canViewAudit), wrap(async (req, res) => {
  const action = String(req.query.action || '').toUpperCase().slice(0, 40) || null;
  const rows = (await q(
    `SELECT l.id, l.action, l.details, l.created_at, a.username AS actor, a.public_id AS actor_id, t.username AS target, t.public_id AS target_id
     FROM audit_log l LEFT JOIN users a ON a.id = l.actor_id LEFT JOIN users t ON t.id = l.target_id
     WHERE $1::text IS NULL OR l.action = $1 ORDER BY l.id DESC LIMIT 150`, [action])).rows;
  res.json({ entries: rows.map((x) => ({ id: x.id, action: x.action, details: x.details, createdAt: x.created_at, actor: x.actor && { username: x.actor, id: x.actor_id }, target: x.target && { username: x.target, id: x.target_id } })) });
}));

r.get('/influencers', requirePerm(canViewInfluencers), wrap(async (req, res) => {
  const [cur, log] = await Promise.all([
    q('SELECT * FROM users WHERE is_influencer ORDER BY username'),
    q('SELECT l.*, u.username, u.public_id, a.username AS by_name FROM influencer_log l JOIN users u ON u.id = l.user_id JOIN users a ON a.id = l.by_user ORDER BY l.created_at DESC LIMIT 100'),
  ]);
  res.json({
    influencers: cur.rows.map((u) => ({ ...publicUser(u), rewardGrantedAt: u.influencer_reward_granted_at })),
    log: log.rows.map((x) => ({ action: x.action, at: x.created_at, user: { username: x.username, id: x.public_id }, by: x.by_name, rewardGranted: x.reward_granted })),
  });
}));

export default r;
