import crypto from 'node:crypto';
const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า APP_SECRET (อย่างน้อย 16 ตัวอักษร) ใน Vercel'), { status: 500 });
  return s;
};
const key = () => crypto.createHash('sha256').update('enc:' + secret()).digest();
export function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
export function sign(data) { return crypto.createHmac('sha256', 'sess:' + secret()).update(data).digest('base64url'); }
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  const [, salt, h] = String(stored).split('$'); if (!salt) return false;
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 32), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const rid = (n = 10) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n) || crypto.randomUUID().slice(0, n);
