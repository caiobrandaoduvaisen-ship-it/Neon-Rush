import { Server } from 'socket.io';
import { resolveSession } from './auth.js';
import { q } from './db.js';
import { sendGlobal } from './chat.js';
import { setIo } from './hub.js';
import { publicUser } from './services.js';
import { getRoom, leaveRoom } from './rooms.js';
import { corsOrigin } from './cors.js';

const presence = new Map(); // userId -> { user, sockets }

function onlineList() {
  return [...presence.values()].map((p) => publicUser(p.user)).sort((a, b) => a.username.localeCompare(b.username));
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 16 * 1024,
  });

  io.use(async (socket, next) => {
    try {
      const s = await resolveSession(socket.handshake.auth?.token);
      if (!s) return next(new Error('SESSION_INVALID'));
      if (s.banned) return next(new Error('BANNED'));
      socket.data.user = s.user;
      socket.data.sessionId = s.sessionId;
      next();
    } catch {
      next(new Error('SERVER_ERROR'));
    }
  });

  const emitOnline = () => io.to('global').emit('chat:online', onlineList());

  io.on('connection', (socket) => {
    const u = socket.data.user;
    socket.join('user:' + u.id);
    socket.join('session:' + socket.data.sessionId);
    socket.join('global');
    const p = presence.get(u.id) || { user: u, sockets: 0 };
    p.sockets++;
    p.user = u;
    presence.set(u.id, p);
    emitOnline();

    socket.on('chat:send', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const fresh = (await q('SELECT * FROM users WHERE id = $1', [u.id])).rows[0];
        const s = await resolveSession(socket.handshake.auth?.token);
        if (!s || s.banned) { reply({ ok: false, error: 'Sessão encerrada' }); return socket.disconnect(true); }
        reply({ ok: true, message: await sendGlobal(fresh, payload?.body) });
      } catch (e) {
        reply({ ok: false, error: e.expose ? e.message : 'Não foi possível enviar', code: e.code });
      }
    });

    socket.on('chat:online', (ack) => typeof ack === 'function' && ack(onlineList()));

    socket.on('room:join', ({ code } = {}) => {
      const room = getRoom(code);
      if (!room || !room.players.some((x) => x.id === u.public_id)) return;
      socket.data.room = room.code;
      socket.join('room:' + room.code);
      io.to('room:' + room.code).emit('room:players', room.players);
    });
    socket.on('room:leave', () => {
      if (!socket.data.room) return;
      const room = leaveRoom(socket.data.room, u.id);
      socket.leave('room:' + socket.data.room);
      if (room) io.to('room:' + room.code).emit('room:players', room.players);
      socket.data.room = null;
    });
    socket.on('player:state', (state) => {
      if (socket.data.room && state && typeof state === 'object') socket.to('room:' + socket.data.room).emit('player:state', { ...state, id: u.public_id });
    });

    socket.on('disconnect', () => {
      const pr = presence.get(u.id);
      if (pr && --pr.sockets <= 0) presence.delete(u.id);
      emitOnline();
    });
  });

  setIo(io);
  return io;
}
