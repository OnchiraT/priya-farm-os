// Breed standards, vaccine program, feed phases, rearing light/temperature, dropdown lists and the breed guide.
// They live in the database (standards/*, config/reference) and are edited in หลังบ้าน → มาตรฐานและข้อมูลอ้างอิง.
// data/reference.json only fills a brand-new farm once; after that the saved documents are the only source.
import fs from 'node:fs'; import path from 'node:path';
import { q, one } from './db.js';
import { FARM } from './auth.js';
import { putDoc, getDoc } from './store.js';
let checked = false;
function seedFile() {
  for (const f of [path.join(process.cwd(), 'data/reference.json'), path.join(path.dirname(new URL(import.meta.url).pathname), '../data/reference.json')]) if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  return null;
}
export async function ensureReference() {
  if (checked) return; checked = true;
  try {
    const hasStd = (await one(`select count(*)::int n from docs where farm_id=$1 and collection='standards'`, [FARM])).n;
    const hasRef = await getDoc('config/reference');
    if (hasStd && hasRef) return;
    const S = seedFile(); if (!S) { console.error('reference seed file missing'); checked = false; return; }
    if (!hasStd) for (const s of S.standards) await putDoc('standards/' + s.id, { breed: s.breed, src: s.src, approx: s.approx, rows: s.rows }, 'system', 'seed');
    if (!hasRef) await putDoc('config/reference', S.reference, 'system', 'seed');
  } catch (e) { checked = false; console.error(e); }
}
export function cleanStandard(b) {
  const breed = String(b.breed || '').trim().slice(0, 60); if (!breed) throw Object.assign(new Error('ใส่ชื่อสายพันธุ์'), { status: 400 });
  const nums = ['hd', 'ew', 'surv', 'cum', 'bwMin', 'bwMax', 'feed'];
  const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => { const o = { w: Math.round(Number(r.w)) }; for (const k of nums) { const v = Number(r[k]); if (r[k] !== '' && r[k] != null && isFinite(v)) o[k] = v; } return o; })
    .filter(r => r.w >= 0 && r.w <= 200).sort((a, c) => a.w - c.w);
  return { breed, src: String(b.src || '').slice(0, 300), approx: !!b.approx, rows };
}
