import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { REPORT_CATEGORIES } from '../catalog.js';
import { canDeleteChatMessage, canViewReports } from '../permissions.js';
import { recentGlobal, sendGlobal, notifyDeleted } from '../chat.js';
import { emitToUser } from '../hub.js';
import { audit, notify, formatNotification, findUserByPublicId, publicUser } from '../services.js';
import { HttpError, wrap, parse, cleanText, allowAction } from '../util.js';

const r = Router();
r.use(requireAuth);

// ---------- Chat global ----------
r.get('/chat/global', wrap(async (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  res.json({ messages: await recentGlobal(Number(req.query.limit) || 50, Number.isFinite(before) ? before : null) });
}));

r.post('/chat/global', wrap(async (req, res) => {
  res.status(201).json({ message: await sendGlobal(req.user, req.body?.body) });
}));

r.delete('/chat/global/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const m = (await q('SELECT m.id, m.body, u.id AS uid, u.role, u.is_original_owner FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1 AND m.deleted_at IS NULL', [id])).rows[0];
  if (!m) throw new HttpError(404, 'Mensagem não encontrada');
  if (!canDeleteChatMessage(req.user, { id: m.uid, role: m.role, is_original_owner: m.is_original_owner })) throw new HttpError(403, 'Você não pode apagar esta mensagem');
  await q('UPDATE chat_messages SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, req.user.id]);
  if (m.uid !== req.user.id) await audit(null, { actorId: req.user.id, action: 'CHAT_DELETE', targetId: m.uid, details: { messageId: id, body: m.body }, ip: req.ip });
  notifyDeleted(id);
  res.json({ ok: true });
}));

// ---------- Mensagens privadas ----------
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

async function isBlockedEither(a, b) {
  return (await q('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [a, b])).rowCount > 0;
}

const fmtDm = (m, me) => ({ id: m.id, body: m.body, createdAt: m.created_at, read: !!m.read_at, mine: m.sender_id === me });

r.get('/dm/conversations', wrap(async (req, res) => {
  const me = req.user.id;
  const rows = (await q(
    `SELECT c.id, c.last_message_at, u.public_id, u.username, u.role, u.is_influencer, u.is_original_owner,
       (SELECT body FROM dm_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
       (SELECT count(*)::int FROM dm_messages WHERE conversation_id = c.id AND sender_id <> $1 AND read_at IS NULL) AS unread,
       EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id) AS blocked
     FROM conversations c JOIN users u ON u.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
     WHERE c.user_a = $1 OR c.user_b = $1
     ORDER BY c.last_message_at DESC LIMIT 100`, [me])).rows;
  res.json({ conversations: rows.map((x) => ({ user: publicUser(x), lastMessage: x.last_body, lastAt: x.last_message_at, unread: x.unread, blocked: x.blocked })) });
}));

r.get('/dm/:publicId/messages', wrap(async (req, res) => {
  const other = await findUserByPublicId(null, req.params.publicId);
  if (!other) throw new HttpError(404, 'Jogador não encontrado');
  const [a, b] = pair(req.user.id, other.id);
  const conv = (await q('SELECT id FROM conversations WHERE user_a = $1 AND user_b = $2', [a, b])).rows[0];
  const blocked = (await q('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, other.id])).rowCount > 0;
  if (!conv) return res.json({ user: publicUser(other), messages: [], blocked });
  const before = Number(req.query.before) || null;
  const rows = (await q(
    'SELECT * FROM dm_messages WHERE conversation_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT 60', [conv.id, before])).rows.reverse();
  const upd = await q('UPDATE dm_messages SET read_at = now() WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL RETURNING id', [conv.id, req.user.id]);
  if (upd.rowCount) emitToUser(other.id, 'dm:read', { by: req.user.public_id });
  res.json({ user: publicUser(other), messages: rows.map((m) => fmtDm(m, req.user.id)), blocked });
}));

r.post('/dm/:publicId', wrap(async (req, res) => {
  const { body, nonce } = parse(z.object({ body: z.string(), nonce: z.string().min(6).max(64) }), req.body);
  const text = cleanText(body, 500);
  const other = await findUserByPublicId(null, req.params.publicId);
  if (!other) throw new HttpError(404, 'Jogador não encontrado');
  if (other.id === req.user.id) throw new HttpError(400, 'Você não pode enviar mensagem para si mesmo');
  if (await isBlockedEither(req.user.id, other.id)) throw new HttpError(403, 'Não é possível enviar mensagens para este jogador', 'BLOCKED');
  // Reenvio com o mesmo nonce devolve a mensagem original (sem duplicar e sem contar como flood).
  const prior = (await q('SELECT * FROM dm_messages WHERE sender_id = $1 AND client_nonce = $2', [req.user.id, nonce])).rows[0];
  if (prior) return res.json({ message: fmtDm(prior, req.user.id), duplicate: true });
  if (!allowAction('dm:' + req.user.id, { max: 10, windowMs: 30000, minIntervalMs: 500 })) throw new HttpError(429, 'Você está enviando mensagens rápido demais', 'FLOOD');

  const out = await tx(async (db) => {
    const [a, b] = pair(req.user.id, other.id);
    const conv = (await db.query(
      `INSERT INTO conversations (user_a, user_b) VALUES ($1,$2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = now() RETURNING id`, [a, b])).rows[0];
    const ins = await db.query(
      'INSERT INTO dm_messages (conversation_id, sender_id, body, client_nonce) VALUES ($1,$2,$3,$4) ON CONFLICT (sender_id, client_nonce) DO NOTHING RETURNING *',
      [conv.id, req.user.id, text, nonce]);
    if (!ins.rowCount) {
      // Reenvio do mesmo pedido: devolve a mensagem original sem duplicar.
      const dup = (await db.query('SELECT * FROM dm_messages WHERE sender_id = $1 AND client_nonce = $2', [req.user.id, nonce])).rows[0];
      return { message: dup, duplicate: true };
    }
    const m = ins.rows[0];
    await notify(db, other.id, 'DM', `✉️ Nova mensagem de ${req.user.username}`, { from: req.user.public_id });
    return { message: m, duplicate: false };
  });
  if (!out.duplicate) {
    emitToUser(other.id, 'dm:new', { from: publicUser(req.user), message: fmtDm(out.message, other.id) });
  }
  res.status(out.duplicate ? 200 : 201).json({ message: fmtDm(out.message, req.user.id), duplicate: out.duplicate });
}));

// ---------- Bloqueios ----------
r.get('/blocks', wrap(async (req, res) => {
  const rows = (await q('SELECT u.public_id, u.username, u.role, u.is_influencer, u.is_original_owner FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC', [req.user.id])).rows;
  res.json({ blocked: rows.map(publicUser) });
}));
r.post('/blocks/:publicId', wrap(async (req, res) => {
  const other = await findUserByPublicId(null, req.params.publicId);
  if (!other || other.id === req.user.id) throw new HttpError(404, 'Jogador não encontrado');
  await q('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, other.id]);
  res.json({ ok: true });
}));
r.delete('/blocks/:publicId', wrap(async (req, res) => {
  const other = await findUserByPublicId(null, req.params.publicId);
  if (!other) throw new HttpError(404, 'Jogador não encontrado');
  await q('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, other.id]);
  res.json({ ok: true });
}));

// ---------- Notificações ----------
r.get('/notifications', wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 60', [req.user.id])).rows;
  const unread = (await q('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n;
  res.json({ notifications: rows.map(formatNotification), unread });
}));
r.post('/notifications/read', wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 200) : null;
  if (ids && ids.length) await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [req.user.id, ids]);
  else await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

// ---------- Denúncias ----------
r.post('/reports', wrap(async (req, res) => {
  const b = parse(z.object({
    targetId: z.string().max(20),
    category: z.enum(REPORT_CATEGORIES, { errorMap: () => ({ message: 'Escolha uma categoria' }) }),
    description: z.string().trim().min(3, 'Descreva o que aconteceu').max(1000, 'Descrição longa demais'),
    chatMessageId: z.number().int().positive().optional(),
    dmMessageId: z.number().int().positive().optional(),
  }), req.body);
  if (!allowAction('report:' + req.user.id, { max: 5, windowMs: 10 * 60 * 1000 })) throw new HttpError(429, 'Muitas denúncias em pouco tempo. Aguarde.', 'RATE_LIMIT');
  const target = await findUserByPublicId(null, b.targetId);
  if (!target) throw new HttpError(404, 'Jogador não encontrado');
  if (target.id === req.user.id) throw new HttpError(400, 'Você não pode denunciar a si mesmo');

  let context = 'player', evidence = {};
  if (b.chatMessageId) {
    const m = (await q('SELECT id, user_id, body, created_at FROM chat_messages WHERE id = $1', [b.chatMessageId])).rows[0];
    if (!m || m.user_id !== target.id) throw new HttpError(400, 'Mensagem não pertence a este jogador');
    context = 'chat';
    evidence = { messageId: m.id, body: m.body, createdAt: m.created_at };
  } else if (b.dmMessageId) {
    const m = (await q(
      `SELECT m.id, m.sender_id, m.body, m.created_at, c.user_a, c.user_b FROM dm_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1`, [b.dmMessageId])).rows[0];
    // Só quem participa da conversa pode anexar a mensagem.
    if (!m || m.sender_id !== target.id || ![m.user_a, m.user_b].includes(req.user.id)) throw new HttpError(400, 'Mensagem inválida para denúncia');
    context = 'dm';
    evidence = { messageId: m.id, body: m.body, createdAt: m.created_at };
  }
  const id = await tx(async (db) => {
    const rep = (await db.query(
      `INSERT INTO reports (reporter_id, reported_id, category, description, context_type, chat_message_id, dm_message_id, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, target.id, b.category, b.description, context, b.chatMessageId || null, b.dmMessageId || null, JSON.stringify(evidence)])).rows[0].id;
    await audit(db, { actorId: req.user.id, action: 'REPORT_CREATE', targetId: target.id, details: { reportId: rep, category: b.category }, ip: req.ip });
    await notify(db, req.user.id, 'REPORT', `🚩 Denúncia #${rep} recebida. A equipe vai analisar.`, { reportId: rep });
    const staff = (await db.query("SELECT id, role, is_original_owner FROM users WHERE role IN ('OWNER','MOD')")).rows;
    for (const s of staff) if (canViewReports(s) && s.id !== target.id) await notify(db, s.id, 'REPORT', `🚩 Nova denúncia #${rep} (${b.category}).`, { reportId: rep });
    return rep;
  });
  res.status(201).json({ ok: true, reportId: id });
}));

export default r;
