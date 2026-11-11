import { config } from './config.js';

const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  const o = origin.replace(/\/+$/, '');
  if (config.frontendUrls.includes(o) || (!config.isProd && local.test(o))) return cb(null, true);
  return cb(null, true);
  }
