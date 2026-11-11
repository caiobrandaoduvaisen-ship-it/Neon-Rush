// Ponte entre as rotas HTTP e o Socket.IO.
let io = null;
export const setIo = (instance) => { io = instance; };
export const getIo = () => io;

export function emitToUser(userId, event, payload) {
  if (io) io.to('user:' + userId).emit(event, payload);
}
export function broadcastGlobal(event, payload) {
  if (io) io.to('global').emit(event, payload);
}
export function forceLogout(userId, payload) {
  if (!io) return;
  io.to('user:' + userId).emit('session:revoked', payload);
  setTimeout(() => io.in('user:' + userId).disconnectSockets(true), 250);
}
export function closeSession(sessionId) {
  if (io) io.in('session:' + sessionId).disconnectSockets(true);
}
