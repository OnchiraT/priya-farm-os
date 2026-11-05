// Photos, PDFs and voice files. When a Vercel Blob store (private) is connected to the project they are kept there
// and the database only keeps a small record; without one they stay in the database as before.
import { q, one } from './db.js';
import { FARM } from './auth.js';
import { rid } from './crypto.js';
let mod;
async function blob() {
  if (!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN)) return null;
  if (mod === undefined) { try { mod = await import('@vercel/blob'); } catch (e) { console.error('blob sdk missing', e.message); mod = null; } }
  return mod;
}
export const fileStore = async () => (await blob()) ? 'blob' : 'database';
const keyOf = id => `${FARM}/${id}`;
export async function saveFile(buf, mime, by, id) {
  id = id || 'f_' + rid(16); const b = await blob();
  if (b) {
    await b.put(keyOf(id), buf, { access: 'private', contentType: mime, addRandomSuffix: false, allowOverwrite: true });
    await q('insert into files(id, farm_id, mime, size, data, blob_path, created_by) values($1,$2,$3,$4,null,$5,$6) on conflict (id) do nothing', [id, FARM, mime, buf.length, keyOf(id), by || null]);
  } else {
    await q('insert into files(id, farm_id, mime, size, data, created_by) values($1,$2,$3,$4,$5,$6) on conflict (id) do nothing', [id, FARM, mime, buf.length, buf, by || null]);
  }
  return id;
}
export async function fileExists(id) { return !!(await one('select 1 as x from files where id=$1 and farm_id=$2', [id, FARM])); }
export async function readFile(id) {
  const f = await one('select mime, data, blob_path from files where id=$1 and farm_id=$2', [id, FARM]); if (!f) return null;
  if (f.data) return { mime: f.mime, data: Buffer.from(f.data) };
  const b = await blob(); if (!b || !f.blob_path) throw new Error('ไฟล์อยู่ในที่เก็บไฟล์ แต่ระบบยังไม่ได้ต่อที่เก็บไฟล์');
  const r = await b.get(f.blob_path, { access: 'private' });
  if (!r || r.statusCode !== 200) return null;
  return { mime: f.mime || r.blob.contentType, data: Buffer.from(await new Response(r.stream).arrayBuffer()) };
}
// move files still sitting in the database into the file store, a batch at a time
export async function migrateFiles(max = 25) {
  const b = await blob(); if (!b) return { moved: 0, left: null, store: 'database' };
  const rows = await q('select id, mime, data from files where farm_id=$1 and data is not null order by created_at limit $2', [FARM, max]);
  for (const r of rows) {
    await b.put(keyOf(r.id), Buffer.from(r.data), { access: 'private', contentType: r.mime || 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true });
    await q('update files set data=null, blob_path=$2 where id=$1', [r.id, keyOf(r.id)]);
  }
  const left = (await one('select count(*)::int n from files where farm_id=$1 and data is not null', [FARM])).n;
  return { moved: rows.length, left, store: 'blob' };
}
// voice reports are cached for replay; keep only the recent ones
export async function pruneVoice(days = 7) {
  const rows = await q(`select id, blob_path from files where farm_id=$1 and created_by='tts' and created_at < now() - ($2 || ' days')::interval`, [FARM, String(days)]);
  const b = await blob(); const paths = rows.map(r => r.blob_path).filter(Boolean);
  if (b && paths.length) { try { await b.del(paths); } catch (e) { console.error(e); } }
  if (rows.length) await q('delete from files where id = any($1)', [rows.map(r => r.id)]);
  return rows.length;
}
export async function fileStats() {
  return one(`select count(*)::int n, coalesce(sum(size),0)::bigint bytes, count(*) filter (where data is not null)::int in_db,
    coalesce(sum(size) filter (where data is not null),0)::bigint db_bytes from files where farm_id=$1`, [FARM]);
}
