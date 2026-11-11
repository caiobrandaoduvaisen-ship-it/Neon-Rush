import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createRoom, joinRoom, leaveRoom } from '../rooms.js';
import { getIo } from '../hub.js';
import { HttpError, wrap } from '../util.js';

const r = Router();
r.use(requireAuth);
const push = (room) => { const io = getIo(); if (io && room) io.to('room:' + room.code).emit('room:players', room.players); };

r.post('/', wrap(async (req, res) => res.status(201).json({ room: createRoom(req.user) })));
r.post('/join', wrap(async (req, res) => {
  const room = joinRoom(req.body?.code, req.user);
  if (!room) throw new HttpError(404, 'Sala não encontrada');
  if (room === 'FULL') throw new HttpError(409, 'Sala cheia (máximo 8 jogadores)');
  push(room);
  res.json({ room });
}));
r.post('/leave', wrap(async (req, res) => {
  const room = leaveRoom(req.body?.code, req.user.id);
  push(room);
  res.json({ ok: true });
}));
export default r;
