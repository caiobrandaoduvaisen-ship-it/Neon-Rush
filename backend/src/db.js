import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(20, (v) => Number(v));   // BIGINT
pg.types.setTypeParser(1700, (v) => Number(v)); // NUMERIC

function sslFor(url) {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  try {
    const host = new URL(url).hostname;
    // Endereço interno do Render (sem ponto) e localhost não usam SSL.
    if (!host || host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return false;
    return { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

if (!config.databaseUrl) console.warn('[db] DATABASE_URL não definida.');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslFor(config.databaseUrl),
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
});
pool.on('error', (e) => console.error('[db] erro no pool:', e.message));

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
