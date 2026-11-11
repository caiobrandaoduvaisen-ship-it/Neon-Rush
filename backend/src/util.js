export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || 'Dados inválidos', 'VALIDATION');
  return r.data;
}

// Remove caracteres de controle e espaços repetidos. Rejeita textos acima do limite.
export function cleanText(raw, max) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Mensagem inválida', 'VALIDATION');
  const s = raw.replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
  if (!s) throw new HttpError(400, 'A mensagem está vazia', 'EMPTY');
  if (s.length > max) throw new HttpError(400, `A mensagem passou do limite de ${max} caracteres`, 'TOO_LONG');
  return s;
}

const buckets = new Map();
// Controle de flood em memória: no máximo `max` ações por janela e intervalo mínimo entre elas.
export function allowAction(key, { max, windowMs, minIntervalMs = 0 }) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length && now - arr[arr.length - 1] < minIntervalMs) { buckets.set(key, arr); return false; }
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || now - arr[arr.length - 1] > 3600000) buckets.delete(k);
}, 600000).unref();

export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
