// Salas do painel ONLINE original (lista de jogadores na sala). Ficam em memória.
import crypto from 'node:crypto';
import { publicUser } from './services.js';

const rooms = new Map(); // code -> { code, members: Map<userId, user> }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRoom(user) {
  let code;
  do { code = Array.from({ length: 6 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); } while (rooms.has(code));
  const room = { code, members: new Map() };
  rooms.set(code, room);
  room.members.set(user.id, user);
  return view(room);
}
export function joinRoom(code, user) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return null;
  if (room.members.size >= 8 && !room.members.has(user.id)) return 'FULL';
  room.members.set(user.id, user);
  return view(room);
}
export function leaveRoom(code, userId) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return null;
  room.members.delete(userId);
  if (!room.members.size) rooms.delete(room.code);
  return view(room);
}
export function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  return room ? view(room) : null;
}
const view = (room) => ({ code: room.code, players: [...room.members.values()].map(publicUser) });
