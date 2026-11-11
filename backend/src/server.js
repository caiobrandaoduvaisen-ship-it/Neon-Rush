import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { config } from './config.js';

export function createServer() {
  const server = http.createServer(createApp());
  attachRealtime(server);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(config.port, () => {
    console.log(`[neon-rush] API ouvindo na porta ${config.port} (${config.nodeEnv})`);
    console.log(`[neon-rush] CORS liberado para: ${config.frontendUrls.join(', ')}`);
    if (!config.ownerCode) console.log('[neon-rush] OWNER_ACTIVATION_CODE não definido: ativação de OWNER desligada.');
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
