// Document store that backs the dashboard (same shape as the prototype: collection/doc paths with JSON data).
import { q, one } from './db.js';
import { canRead, canWrite, redact, collOf, isWorker, stripMoney } from './roles.js';
import { bad } from './http.js';
import { rid } from './crypto.js';
import { FARM } from './auth.js';
const validPath = p => typeof p === 'string' && /^[A-Za-z0-9_\-.~:@+]+(\/[A-Za-z0-9_\-.~:@+]+)*$/.test(p) && p.split('/').length % 2 === 0;
export async function changes(user, sinceIso) {
  const since = sinceIso || '1970-01-01 00:00:00+00';
  const m = await one(`select greatest((select max(updated_at) from docs where farm_id=$1), (select max(deleted_at) from doc_deletes where farm_id=$1))::text as t`, [FARM]);
  const upto = (m && m.t) || since;
  const rows = await q('select path, data from docs where farm_id=$1 and updated_at > $2::text::timestamptz and updated_at <= $3::text::timestamptz order by updated_at', [FARM, since, upto]);
  const dels = await q('select path from doc_deletes where farm_id=$1 and deleted_at > $2::text::timestamptz and deleted_at <= $3::text::timestamptz', [FARM, since, upto]);
  const docs = rows.filter(r => canRead(user, r.path)).map(r => ({ p: r.path, d: redact(user, r.data) }));
  const deleted = dels.filter(d => canRead(user, d.path)).map(d => d.path);
  return { docs, deleted, now: upto };
}
export async function getDoc(path) {
  const r = await one('select data from docs where farm_id=$1 and path=$2', [FARM, path]); return r ? r.data : null;
}
export async function listColl(coll) {
  const rows = await q('select doc_id, data from docs where farm_id=$1 and collection=$2', [FARM, coll]);
  return rows.map(r => Object.assign({ id: r.doc_id }, r.data));
}
// low-level write used by the pipeline and by user writes after permission checks
export async function putDoc(path, data, actor, source = 'web', merge = false) {
  if (!validPath(path)) bad('path ไม่ถูกต้อง: ' + path);
  const coll = collOf(path), id = path.split('/').pop();
  if (merge) {
    const cur = await getDoc(path);
    data = Object.assign({}, cur || {}, data);
    for (const k of Object.keys(data)) if (data[k] && data[k].__delete__) delete data[k];
  }
  await q(`insert into docs(farm_id, path, collection, doc_id, data, updated_by, source) values($1,$2,$3,$4,$5::jsonb,$6,$7)
    on conflict (farm_id, path) do update set data=excluded.data, version=docs.version+1, updated_at=clock_timestamp(), updated_by=excluded.updated_by, source=excluded.source`,
    [FARM, path, coll, id, data, actor || null, source]);
  return path;
}
export async function delDoc(path) {
  await q('delete from docs where farm_id=$1 and path=$2', [FARM, path]);
  await q('insert into doc_deletes(farm_id, path, collection) values($1,$2,$3)', [FARM, path, collOf(path)]);
}
export async function userWrite(user, { op, path, collection, data }) {
  if (op === 'add') { if (!collection) bad('ไม่มี collection'); path = `${collection}/${rid(16)}`; op = 'set'; }
  if (!validPath(path)) bad('path ไม่ถูกต้อง');
  if (!canWrite(user, path)) bad('บัญชีนี้ไม่มีสิทธิ์บันทึกข้อมูลส่วนนี้', 403);
  if (op === 'delete') { await delDoc(path); return { path }; }
  if (op !== 'set' && op !== 'update') bad('op ไม่ถูกต้อง');
  if (data == null || typeof data !== 'object') bad('ไม่มีข้อมูล');
  // workers never see money, so their saves must not wipe or set money fields
  if (isWorker(user)) { data = stripMoney(data); op = 'update'; }
  await putDoc(path, data, user.id, 'web', op === 'update');
  return { path };
}
