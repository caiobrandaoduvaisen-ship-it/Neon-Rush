import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { q } from './db.js';
import { config } from './config.js';
import { corsOrigin } from './cors.js';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/game.js';
import socialRoutes from './routes/social.js';
import adminRoutes from './routes/admin.js';
import roomRoutes from './routes/rooms.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
  app.use(express.json({ limit: '20kb' }));

  // Log curto, sem corpo nem cabeçalhos (nada de senha ou token).
  if (!config.isTest) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }

  app.get('/', (req, res) => res.json({ name: 'Neon Rush 3D API', health: '/health' }));
  app.get('/health', async (req, res) => {
    try {
      await q('SELECT 1');
      res.json({ status: 'ok', database: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', database: 'indisponível' });
    }
  });

  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 100000 : 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas requisições. Aguarde um pouco.' } }));
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', gameRoutes);
  app.use('/api', socialRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo grande demais' });
    if (err.expose && err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.ban ? { ban: err.ban } : {}) });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado' });
    console.error('[erro]', req.method, req.path, err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}
