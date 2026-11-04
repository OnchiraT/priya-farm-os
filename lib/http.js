export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const bad = (msg, s = 400) => { throw new HttpError(s, msg); };
export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (Buffer.isBuffer(body)) { res.end(body); return; }
  if (typeof body === 'string') { if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end(body); return; }
  res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body ?? null));
}
export async function readRaw(req) {
  if (req.__raw) return req.__raw;
  const chunks = []; for await (const c of req) chunks.push(c);
  let raw = Buffer.concat(chunks);
  if (!raw.length && req.body != null) raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  req.__raw = raw; return raw;
}
export async function readJson(req) {
  const raw = await readRaw(req); if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { bad('JSON ไม่ถูกต้อง'); }
}
export function cookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
