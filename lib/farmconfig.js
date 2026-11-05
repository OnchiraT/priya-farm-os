// Farm-wide values the owner can change on the "ตั้งค่าฟาร์ม" page. These are only the starting values for a new farm;
// whatever is saved in config/farm wins. Every page and report reads the merged result from here.
import { getDoc, putDoc } from './store.js';
import { q, one } from './db.js';
import { FARM } from './auth.js';
export const FARM_DEFAULTS = {
  eggsPerTray: 30, traysPerCrate: 10, trayKg: 2.5,
  restDays: 45, moveWeek: 16, depopWeek: 85,
  summaryHour: 18,
  alerts: {
    stdNear: 2, stdWarn: 5, stdCrit: 10,
    hdDropWarn: 3, hdDropCrit: 5,
    deadWarnPct: 0.05, deadCritPct: 0.1,
    waterFeedChangePct: 15, waterChangePct: 25, feedDropPct: 8, crackPct: 1.5,
    oweBaht: 1000, oweDays: 5, oweCritDays: 9, eggOldDays: 7,
    bwNearPct: 5, bwWarnPct: 10, weighEveryDays: 7, moveSoonDays: 7, siloLowDays: 2,
  },
  map: { top: ['ขยายบ่อน้ำ', 'บ้านคนงาน'], left: 'คลอง', right: 'บ่อน้ำ', road: 'ถนนหน้าฟาร์ม', pond: 'บ่อน้ำในฟาร์ม', gate: 'จุดฆ่าเชื้อ', entrance: 'ทางเข้า', showStock: true },
  sensors: false,
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function merge(a, b) { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v; return o; }
export async function farmConfig() {
  const d = await getDoc('config/farm'); const f = await one('select name from farms where id=$1', [FARM]);
  return Object.assign(merge(FARM_DEFAULTS, d || {}), { name: f?.name || '' });
}
const NUM = (v, lo, hi) => { const x = Number(v); if (!isFinite(x) || x < lo || x > hi) return undefined; return x; };
// keep only known keys with sane numbers so a typo can't break every page
export function cleanConfig(b) {
  const o = {}; const n = (k, lo, hi, src = b, dst = o) => { if (src[k] !== undefined && src[k] !== '') { const x = NUM(src[k], lo, hi); if (x === undefined) throw Object.assign(new Error(`ค่า ${k} ไม่ถูกต้อง`), { status: 400 }); dst[k] = x; } };
  n('eggsPerTray', 1, 100); n('traysPerCrate', 1, 100); n('trayKg', 0, 20); n('restDays', 0, 365); n('moveWeek', 1, 40); n('depopWeek', 20, 200); n('summaryHour', 0, 23);
  if (isObj(b.alerts)) { o.alerts = {}; for (const k of Object.keys(FARM_DEFAULTS.alerts)) n(k, 0, 1e7, b.alerts, o.alerts); }
  if (isObj(b.map)) { o.map = {}; for (const k of ['left', 'right', 'road', 'pond', 'gate', 'entrance']) if (typeof b.map[k] === 'string') o.map[k] = b.map[k].slice(0, 40); if (Array.isArray(b.map.top)) o.map.top = b.map.top.map(String).map(s => s.slice(0, 40)).filter(Boolean).slice(0, 4); if (b.map.showStock !== undefined) o.map.showStock = !!b.map.showStock; }
  if (b.sensors !== undefined) o.sensors = !!b.sensors;
  return o;
}
export async function saveFarmConfig(b, actor) {
  if (typeof b.name === 'string' && b.name.trim()) await q('update farms set name=$2 where id=$1', [FARM, b.name.trim().slice(0, 80)]);
  const cur = (await getDoc('config/farm')) || {};
  await putDoc('config/farm', merge(cur, cleanConfig(b)), actor, 'web');
  return farmConfig();
}
