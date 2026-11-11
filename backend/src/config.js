import crypto from 'node:crypto';

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';

let sessionSecret = env.SESSION_SECRET || '';
if (!sessionSecret) {
  if (nodeEnv === 'production') throw new Error('SESSION_SECRET é obrigatório em produção');
  sessionSecret = crypto.randomBytes(32).toString('hex');
  if (nodeEnv !== 'test') console.warn('[config] SESSION_SECRET ausente: usando valor temporário (as sessões somem ao reiniciar).');
}

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL || '',
  frontendUrls: (env.FRONTEND_URL || 'https://thriving-profiterole-1bafbe.netlify.app')
    .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  sessionSecret,
  // Lido só no servidor. Nunca é enviado ao navegador nem gravado em logs.
  ownerCode: (env.OWNER_ACTIVATION_CODE || '').trim().toUpperCase(),
  sessionTtlDays: Number(env.SESSION_TTL_DAYS) || 30,
};
