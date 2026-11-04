import { q, one } from './db.js';
import { sign, hashPassword, checkPassword, rid } from './crypto.js';
import { cookies, bad } from './http.js';
import { ROLES, isAdmin, isStaff } from './roles.js';
const COOKIE = 'pf_s', DAYS = 30;
export const FARM = 'main';
export function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ u: user.id, e: Date.now() + DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function sessionCookie(user, req) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `${COOKIE}=${user ? makeSession(user) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${user ? DAYS * 86400 : 0}${secure}`;
}
export async function currentUser(req) {
  if (req.__user !== undefined) return req.__user;
  const c = cookies(req)[COOKIE]; req.__user = null;
  if (!c) return null;
  const [p, s] = c.split('.'); if (!p || sign(p) !== s) return null;
  let d; try { d = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!d.u || d.e < Date.now()) return null;
  const u = await one('select id, farm_id, username, display_name, role, buyer_id, houses, line_user_id, active from users where id=$1', [d.u]);
  req.__user = u && u.active ? u : null; return req.__user;
}
export async function requireUser(req, check) {
  const u = await currentUser(req); if (!u) bad('กรุณาเข้าสู่ระบบ', 401);
  if (check === 'admin' && !isAdmin(u)) bad('ต้องเป็นเจ้าของฟาร์มหรือผู้บริหาร', 403);
  if (check === 'staff' && !isStaff(u)) bad('ต้องเป็นทีมฟาร์ม', 403);
  return u;
}
export async function login(username, password) {
  const u = await one('select * from users where lower(username)=lower($1)', [String(username || '').trim()]);
  if (!u || !u.active || !checkPassword(String(password || ''), u.password_hash)) bad('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  await q('update users set last_login=now() where id=$1', [u.id]); return u;
}
export async function userCount() { return (await one('select count(*)::int as n from users'))?.n || 0; }
export async function createUser({ username, display_name, password, role, buyer_id, houses }) {
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) bad('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–32 ตัว');
  if (!display_name) bad('ใส่ชื่อที่แสดง');
  if (!ROLES[role]) bad('บทบาทไม่ถูกต้อง');
  if (String(password || '').length < 6) bad('รหัสผ่านอย่างน้อย 6 ตัว');
  if ((role === 'lhong' || role === 'customer') && !buyer_id) bad('บัญชีล้ง / ลูกค้า ต้องเลือกว่าผูกกับผู้ซื้อรายไหน');
  if (await one('select 1 as x from users where lower(username)=$1', [username])) bad('ชื่อผู้ใช้นี้มีแล้ว');
  const id = 'u_' + rid(12);
  await q('insert into users(id, farm_id, username, display_name, password_hash, role, buyer_id, houses) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [id, FARM, username, display_name, hashPassword(password), role, buyer_id || null, Array.isArray(houses) ? houses.map(Number) : []]);
  return id;
}
export function publicUser(u) {
  return { id: u.id, username: u.username, name: u.display_name, role: u.role, roleLabel: ROLES[u.role]?.label, group: ROLES[u.role]?.group, buyerId: u.buyer_id, houses: u.houses || [] };
}
