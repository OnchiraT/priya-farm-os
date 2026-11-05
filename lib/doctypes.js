// What kinds of paper the farm sends, how to read each one, how to check it, and where it lands.
import { farmConfig } from './farmconfig.js';
import { q, one } from './db.js';
import { getDoc, putDoc } from './store.js';

const SLIP_GUIDE = [
  'house: เลขเล้า (1 ถึง 10) จากหัวใบ "เล้า"',
  'date: วันที่ในหัวใบ เขียนแบบ วัน/เดือน/ปี พ.ศ. 2 หลัก เช่น 28/10/69 → ตอบเป็น ค.ศ. "2026-10-28"',
  'age: อายุไก่หลังคำว่า "อายุ" เช่น "33.1"',
  'ตารางไข่ดี: แถว ใหญ่(big) กลาง(mid) เล็ก(small) จิ๋ว(tiny) แฝด(twin) ขาว(white) เบี้ยว(odd) และ รวม(sum); คอลัมน์ เช้า(m) เย็น(e) รวม(t) → id เช่น e_big_m, e_mid_t, e_sum_t ค่าเป็นรูปแบบ ลัง.แผง คัดลอกตามที่เขียน รวมจุดนำหน้า เช่น ".2" หรือ "6.4"',
  'กล่องขวา: ไข่จิก=d_pecked, ไข่นิ่ม=d_soft, ไข่ทิ้ง=d_discard, ไข่แตก=d_cracked, ไข่เลื่อน=d_carry, ไข่เลื่อน เพิ่ม=d_carryAdd, ไข่เลื่อน ลด=d_carrySub, ไก่ตาย=h_dead, ไก่คัด=h_culled, ไก่จิก=h_pecked',
  'อาหาร: อาหารรับเข้า=f_in, เก่าเหลือ=f_prev, รวม=f_total, ใช้ไป=f_used, คงเหลือ=f_left',
  'จำนวนไก่=birds, น้ำวันนี้ (เลขมิเตอร์)=w_today, น้ำเมื่อวาน=w_yest, น้ำใช้จริง=w_used',
];
const SZ = { big: 'ใหญ่', mid: 'กลาง', small: 'เล็ก', tiny: 'จิ๋ว', twin: 'แฝด', white: 'ขาว', odd: 'เบี้ยว', sum: 'รวม' }, COL = { m: 'เช้า', e: 'เย็น', t: 'รวม' };
export const FIELD_LABELS = Object.assign({ house: 'เล้า', date: 'วันที่', age: 'อายุไก่ (สัปดาห์)', birds: 'จำนวนไก่', housed: 'ไก่ลงเล้า',
  d_pecked: 'ไข่จิก', d_soft: 'ไข่นิ่ม', d_discard: 'ไข่ทิ้ง', d_cracked: 'ไข่แตก', d_carry: 'ไข่เลื่อน', d_carryAdd: 'ไข่เลื่อน เพิ่ม', d_carrySub: 'ไข่เลื่อน ลด',
  h_dead: 'ไก่ตาย', h_culled: 'ไก่คัด', h_pecked: 'ไก่จิก', f_in: 'อาหารรับเข้า', f_prev: 'อาหารเก่าเหลือ', f_total: 'อาหารรวม', f_used: 'อาหารใช้ไป', f_left: 'อาหารคงเหลือ',
  left: 'คงเหลือ (ตัว)', dead: 'ตาย', culled: 'คัดทิ้ง', feedKg: 'อาหาร (กก.)', gPerBird: 'กรัม/ตัว', std: 'มาตรฐาน', g_bird: 'กรัม/ตัว',
  w_today: 'มิเตอร์น้ำวันนี้', w_yest: 'มิเตอร์น้ำเมื่อวาน', w_used: 'น้ำใช้จริง', plate: 'ทะเบียนรถ', ticket: 'เลขที่ใบชั่ง', time_in: 'เวลาเข้า', time_out: 'เวลาออก',
  w_in: 'ชั่งเข้า (กก.)', w_out: 'ชั่งออก (กก.)', net: 'น้ำหนักสุทธิ (กก.)', buyer: 'ผู้ซื้อ', total: 'ยอดรวม', temp: 'อุณหภูมิ', time: 'เวลา', kg: 'กก.', silo: 'ไซโล',
  driver: 'คนขับ', formula: 'สูตรอาหาร', weighKg: 'น้ำหนักอาหาร (กก.)', note: 'หมายเหตุ' },
  Object.fromEntries(Object.keys(SZ).flatMap(s => Object.keys(COL).map(c => [`e_${s}_${c}`, `ไข่${SZ[s]} ${COL[c]}`]))));
const CONF = 'ให้ "conf" เป็นความมั่นใจรายช่อง 0–100 (100 = ตัวเลขชัดมาก, ต่ำกว่า 80 = ลายมือกำกวม/ขีดฆ่า/มีรอยเปื้อน) ใส่ทุกช่องที่ตอบ';

export const DOC_TYPES = {
  daily_slip: {
    label: 'ใบบันทึกประจำวันของเล้า', target: 'records',
    prompt: () => `รูปนี้คือใบบันทึกประจำวันของเล้าไก่ไข่ เขียนด้วยลายมือภาษาไทย อ่านค่าทุกช่องที่มีเขียนไว้ ตอบเป็น JSON อย่างเดียว:
{"fields":{"house":"1","date":"2026-10-28","age":"33.1","e_big_m":"51"},"conf":{"house":99,"date":95,"e_big_m":72},"weights":[21.1,21.3],"note":""}
ช่องและ id:\n- ${SLIP_GUIDE.join('\n- ')}
- weights: ถ้ามีใบน้ำหนักลังไข่ (ตัวเลขประมาณ 18–23 เรียงเป็นแถว) ใส่ทุกค่าเป็น array
กติกา: ใส่เฉพาะช่องที่มีเขียน ค่าเป็น string ตามที่เห็น ห้ามคำนวณหรือแก้ แม้บวกไม่ตรง ${CONF}`,
    ask: { house: 'เล้าที่', date: 'วันที่', e_sum_t: 'ไข่ดีรวม (ลัง.แผง)', h_dead: 'ไก่ตาย (ตัว)', f_used: 'อาหารใช้ไป (กก.)', w_used: 'น้ำใช้จริง', birds: 'จำนวนไก่', f_left: 'อาหารคงเหลือ', f_total: 'อาหารรวม' },
  },
  daily_summary: {
    label: 'ตารางสรุปรายวันหลายเล้า (Excel / ใบรวม)', target: 'records',
    prompt: () => `รูปนี้คือตารางสรุปการผลิตรายวันของฟาร์มไก่ไข่ หนึ่งแถวต่อหนึ่งเล้า ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-10-31"},"rows":[{"house":"3","age":"41.1","birds":"18501","e_sum_t":"54.1","e_white_t":".6","e_odd_t":".1","d_cracked":"80","d_discard":"23","h_dead":"3","h_culled":"3","h_pecked":"20","f_used":"2011","w_used":"7163"}],"conf":{"date":95,"rows.0.e_sum_t":90},"note":""}
ใช้ id เดียวกับใบบันทึกเล้า: ${SLIP_GUIDE.slice(2).join(' / ')} วันที่ พ.ศ. 2 หลัก → ค.ศ. ${CONF} โดยใช้ key แบบ "rows.<ลำดับแถว>.<id>"`,
  },
  weigh_slip: {
    label: 'ใบชั่งน้ำหนักรถขายไก่ปลด', target: 'hensales',
    prompt: () => `รูปนี้คือใบชั่งน้ำหนักรถบรรทุกไก่ (ขายไก่ไข่ปลด) ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-11-02","plate":"2686","ticket":"","time_in":"08:10","time_out":"09:40","w_in":"8120","w_out":"9540","net":"1420","birds":"700","house":"4","buyer":""},"conf":{"plate":95,"net":90},"note":""}
w_in=น้ำหนักชั่งเข้า(กก.) w_out=น้ำหนักชั่งออก net=น้ำหนักสุทธิ birds=จำนวนไก่ที่เขียนด้วยมือ (ถ้ามี) house=เล้า (ถ้ามี) วันที่ พ.ศ. → ค.ศ. ไม่ต้องอ่านราคา ${CONF}`,
    ask: { plate: 'ทะเบียนรถ', net: 'น้ำหนักสุทธิ (กก.)', birds: 'จำนวนไก่ (ตัว)', house: 'มาจากเล้าไหน', date: 'วันที่' },
  },
  gate_sheet: {
    label: 'ใบหน้าฟาร์ม จดทะเบียนรถกับจำนวนไก่', target: 'gatelog',
    prompt: () => `รูปนี้คือใบลายมือหน้าฟาร์ม จดว่ารถทะเบียนอะไรขนไก่ไปกี่ตัว ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-11-02","buyer":"","total":"5712"},"rows":[{"plate":"3465","birds":"3328"}],"conf":{"total":90,"rows.0.birds":85},"note":""}
ถ้าไม่มีวันที่ในใบ ให้เว้น date ไว้ ${CONF} โดยใช้ key แบบ "rows.<ลำดับ>.<id>"`,
    ask: { date: 'วันที่ของใบนี้', total: 'ยอดรวม (ตัว)' },
  },
  pullet_sheet: {
    label: 'ใบบันทึกไก่รุ่น / ไก่เล็ก (หลายวันในแผ่นเดียว)', target: 'records',
    prompt: () => `รูปนี้คือใบบันทึกไก่รุ่น (ไก่เล็ก) แบ่งเป็นช่วงวันที่ แต่ละช่วงมีตารางหนึ่งแถวต่อหนึ่งเล้า คอลัมน์: เล้าที่, อายุ, จำนวน(ตัว), ตาย, คัดทิ้ง, คงเหลือ, อาหาร/กก, กรัม/ตัว, มาตรฐาน ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-10-30"},"rows":[{"date":"2026-10-28","house":"9","age":"11.5","birds":"19453","dead":"","culled":"","left":"19453","feedKg":"1246","gPerBird":"64.05","std":"63-65"}],"conf":{"rows.0.left":95},"note":""}
fields.date = วันที่ล่าสุดในแผ่น วันที่ พ.ศ. 2 หลัก เช่น 28.10.69 → "2026-10-28" ข้ามตารางที่ว่างเปล่า ถ้าเลขเล้าถูกตัดขอบให้เดาจากแถวอื่นของแผ่นเดียวกันและให้ conf ต่ำ ${CONF} โดยใช้ key แบบ "rows.<ลำดับ>.<id>"`,
  },
  fridge_temp: {
    label: 'ใบจดอุณหภูมิตู้เย็นวัคซีน', target: 'fridge',
    prompt: () => `รูปนี้คือใบจดอุณหภูมิตู้เย็นเก็บวัคซีน ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-11-02"},"rows":[{"time":"08:00","temp":"4.5","by":""}],"conf":{"rows.0.temp":95},"note":""} ${CONF}`,
  },
  feed_delivery: {
    label: 'ใบส่งอาหารไก่ / ใบชั่งรถอาหาร', target: 'feeddel',
    prompt: () => `รูปนี้คือใบส่งอาหารสัตว์หรือใบชั่งรถอาหาร ตอบ JSON อย่างเดียว:
{"fields":{"date":"2026-10-01","time":"07:05","plate":"","driver":"","ticket":"","formula":"","weighKg":"9610"},"rows":[{"silo":"1A","kg":"3200"}],"conf":{"weighKg":95},"note":""}
ไม่ต้องอ่านราคา ${CONF}`,
    ask: { weighKg: 'น้ำหนักอาหาร (กก.)', date: 'วันที่' },
  },
};
export const CLASSIFY_PROMPT = `ดูรูปเอกสารจากฟาร์มไก่ไข่แล้วบอกว่าเป็นเอกสารประเภทไหน ตอบ JSON อย่างเดียว {"type":"...","conf":0-100,"why":"สั้นๆ"}
ประเภท:
${Object.entries(DOC_TYPES).map(([k, v]) => `- ${k}: ${v.label}`).join('\n')}
- unknown: ไม่ใช่เอกสารของฟาร์ม หรือรูปเบลอจนอ่านไม่ได้ (เช่น รูปคน รูปไก่ สติกเกอร์)`;

// ---------- helpers ----------
const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '').trim()); return isFinite(n) ? n : null; };
export function parseCT(s, tpc) {
  if (!tpc) throw new Error('parseCT needs trays per crate'); s = String(s == null ? '' : s).replace(/,/g, '').trim(); if (!s) return null; const m = s.match(/^(\d*)(?:\.(\d+))?$/); if (!m) return NaN; return (+(m[1] || 0)) * tpc + (+(m[2] || 0)); }
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
const fixDate = d => { if (!d) return d; const m = String(d).trim().match(/^(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})$/); if (m) { let y = +m[3]; if (y < 100) y += 2500; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } return d; };

// P = packing from farm settings: eggs per tray, trays per crate, empty-tray weight per crate (kg)
export function slipCalc(f, weights = [], P = {}) {
  const tpc = P.traysPerCrate, ept = P.eggsPerTray;
  const trays = parseCT(f.e_sum_t, tpc); const goodEggs = trays > 0 ? trays * ept : null;
  const birds = num(f.birds), housed = num(f.housed);
  const bad = ['d_cracked', 'd_discard', 'd_pecked', 'd_soft'].reduce((a, k) => a + (num(f[k]) || 0), 0);
  const avgW = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  return {
    goodEggs, birds, housed, bad, dead: num(f.h_dead), issues: 0,
    pct: goodEggs && birds ? goodEggs / birds * 100 : null,
    hh: goodEggs && housed ? goodEggs / housed * 100 : null,
    feedPer: num(f.f_used) && birds ? num(f.f_used) * 1000 / birds : null,
    waterPer: num(f.w_used) && birds ? num(f.w_used) * 1000 / birds : null,
    avgEgg: avgW ? (avgW - (P.trayKg || 0)) * 1000 / (tpc * ept) : null,
  };
}
async function lastRecord(house, before) {
  const r = await one(`select data from docs where collection='records' and (data->>'house')::text=$1 and data->>'date' < $2 order by data->>'date' desc limit 1`, [String(house), before || '9999']);
  return r ? r.data : null;
}
// Each check: {id, ok, msg, fields:[...]} — failing checks lower confidence of the fields involved.
export async function runChecks(type, fields, rows = []) {
  const C = []; const add = (id, ok, msg, flds) => C.push({ id, ok: !!ok, msg, fields: flds });
  const f = fields;
  if (type === 'daily_slip') {
    const tp = (await farmConfig()).traysPerCrate;
    if (num(f.f_in) != null && num(f.f_prev) != null && num(f.f_total) != null) add('feed_total', near(num(f.f_in) + num(f.f_prev), num(f.f_total), 2), 'อาหารรับเข้า + เก่าเหลือ = รวม', ['f_in', 'f_prev', 'f_total']);
    if (num(f.f_total) != null && num(f.f_used) != null && num(f.f_left) != null) add('feed_left', near(num(f.f_total) - num(f.f_used), num(f.f_left), 2), 'อาหารรวม − ใช้ไป = คงเหลือ', ['f_total', 'f_used', 'f_left']);
    if (num(f.w_today) != null && num(f.w_yest) != null && num(f.w_used) != null) add('water', near(num(f.w_today) - num(f.w_yest), num(f.w_used), 2), 'น้ำวันนี้ − เมื่อวาน = ใช้จริง', ['w_today', 'w_yest', 'w_used']);
    const sizes = ['big', 'mid', 'small', 'tiny', 'twin', 'white', 'odd'];
    const sumT = sizes.reduce((a, k) => a + (parseCT(f[`e_${k}_t`], tp) || 0), 0);
    if (f.e_sum_t && sumT > 0) add('egg_sum', near(sumT, parseCT(f.e_sum_t, tp), 1), 'ไข่แต่ละขนาดรวมกัน = ไข่รวม', ['e_sum_t']);
    for (const k of sizes) { const m = parseCT(f[`e_${k}_m`], tp), e = parseCT(f[`e_${k}_e`], tp), t = parseCT(f[`e_${k}_t`], tp); if (t != null && (m != null || e != null)) add('egg_' + k, near((m || 0) + (e || 0), t, 0), `ไข่${k} เช้า + เย็น = รวม`, [`e_${k}_m`, `e_${k}_e`, `e_${k}_t`]); }
    if (!f.house) add('house', false, 'ไม่พบเลขเล้า', ['house']);
    if (!f.date) add('date', false, 'ไม่พบวันที่', ['date']);
    else { const d = Date.parse(f.date), now = Date.now(); add('date_range', d && d <= now + 864e5 && d > now - 45 * 864e5, 'วันที่อยู่ในช่วง 45 วันล่าสุด', ['date']); }
    const prev = f.house ? await lastRecord(f.house, f.date) : null;
    if (prev && prev.f) {
      for (const [k, tol] of [['e_sum_t', .25], ['f_used', .25], ['w_used', .35], ['birds', .05]]) {
        const a = k === 'e_sum_t' ? parseCT(f[k], tp) : num(f[k]), b = k === 'e_sum_t' ? parseCT(prev.f[k], prev.tpc || tp) : num(prev.f[k]);
        if (a != null && b) add('hist_' + k, Math.abs(a - b) / b <= tol, `ใกล้เคียงวันก่อน (${prev.date}) ไม่เกิน ±${Math.round(tol * 100)}%`, [k]);
      }
      if (num(f.f_prev) != null && num(prev.f.f_left) != null) add('carry_feed', near(num(f.f_prev), num(prev.f.f_left), 2), `อาหารเก่าเหลือ = คงเหลือของวันก่อน (${prev.date})`, ['f_prev']);
      if (num(f.w_yest) != null && num(prev.f.w_today) != null) add('carry_water', near(num(f.w_yest), num(prev.f.w_today), 2), `มิเตอร์น้ำเมื่อวาน = มิเตอร์ของวันก่อน`, ['w_yest']);
    }
  }
  if (type === 'weigh_slip') {
    const wi = num(f.w_in), wo = num(f.w_out), net = num(f.net), birds = num(f.birds);
    if (wi != null && wo != null && net != null) add('net', near(Math.abs(wo - wi), net, 5), 'ชั่งออก − ชั่งเข้า = สุทธิ', ['w_in', 'w_out', 'net']);
    if (net && birds) add('kg_bird', net / birds >= 1.5 && net / birds <= 2.6, 'น้ำหนักเฉลี่ยต่อตัว 1.5–2.6 กก.', ['net', 'birds']);
    if (!f.plate) add('plate', false, 'ไม่พบทะเบียนรถ', ['plate']);
    if (!birds) add('birds', false, 'ยังไม่รู้จำนวนไก่ (ตัว)', ['birds']);
    if (!f.house) add('house', false, 'ยังไม่รู้ว่ามาจากเล้าไหน', ['house']);
  }
  if (type === 'gate_sheet') {
    const s = rows.reduce((a, r) => a + (num(r.birds) || 0), 0);
    if (num(f.total) != null) add('total', near(s, num(f.total), 0), 'ผลรวมแต่ละคัน = ยอดรวม', ['total']);
    if (!f.date) add('date', false, 'ไม่มีวันที่ในใบ', ['date']);
  }
  if (type === 'pullet_sheet') rows.forEach((r, i) => {
    const b = num(r.birds), l = num(r.left), d = num(r.dead) || 0, c = num(r.culled) || 0, kg = num(r.feedKg), g = num(r.gPerBird);
    if (b != null && l != null) add('left_' + i, b - d - c === l, `แถว ${i + 1}: จำนวน − ตาย − คัดทิ้ง = คงเหลือ`, [`rows.${i}.left`, `rows.${i}.birds`]);
    if (kg != null && l && g != null) add('gram_' + i, Math.abs(kg * 1000 / l - g) <= 0.6, `แถว ${i + 1}: อาหาร ÷ ไก่คงเหลือ = กรัม/ตัว`, [`rows.${i}.feedKg`, `rows.${i}.gPerBird`]);
    if (!r.house) add('house_' + i, false, `แถว ${i + 1}: ไม่เห็นเลขเล้า`, [`rows.${i}.house`]);
    if (!r.date) add('date_' + i, false, `แถว ${i + 1}: ไม่มีวันที่`, [`rows.${i}.date`]);
  });
  if (type === 'fridge_temp') rows.forEach((r, i) => { const t = num(r.temp); if (t != null) add('temp_' + i, t >= 2 && t <= 8, `อุณหภูมิ ${r.time || ''} อยู่ในช่วง 2–8°C`, [`rows.${i}.temp`]); });
  if (type === 'feed_delivery') {
    const s = rows.reduce((a, r) => a + (num(r.kg) || 0), 0);
    if (s && num(f.weighKg)) add('drops', Math.abs(s - num(f.weighKg)) <= Math.max(50, num(f.weighKg) * .01), 'ลงไซโลรวม ≈ น้ำหนักชั่ง', ['weighKg']);
  }
  return C;
}
export function normalize(type, out) {
  const fields = Object.assign({}, out.fields || {}); const rows = (Array.isArray(out.rows) ? out.rows : []).map(r => r && r.date ? Object.assign({}, r, { date: fixDate(r.date) }) : r);
  if (fields.date) fields.date = fixDate(fields.date);
  if (fields.house != null) fields.house = String(fields.house).replace(/[^\d]/g, '') || fields.house;
  return { fields, rows, weights: Array.isArray(out.weights) ? out.weights.map(Number).filter(isFinite) : [], conf: out.conf || {}, note: out.note || '' };
}
// Write the confirmed data into the farm's collections. Returns list of doc paths written.
export async function commit(type, data, actor, intakeId, fileId) {
  const P = await farmConfig();
  const { fields: f, rows = [], weights = [] } = data; const src = 'line:' + intakeId; const written = [];
  const now = new Date().toISOString(); const meta = { by: null, byName: actor || 'AI รับเอกสาร', savedAt: now, at: now, intake: intakeId, photo: fileId || null };
  if (type === 'daily_slip') {
    const id = `${f.date}_h${f.house}`; const ff = Object.assign({}, f); delete ff.house; delete ff.date;
    const rec = Object.assign({ date: f.date, house: +f.house, f: ff, weights, tpc: P.traysPerCrate }, meta); rec.calc = slipCalc(ff, weights, P);
    await putDoc('records/' + id, rec, actor, src); written.push('records/' + id);
  } else if (type === 'daily_summary') {
    for (const r of rows) {
      if (!r.house) continue; const id = `${f.date}_h${r.house}`; const ff = Object.assign({}, r); delete ff.house;
      const rec = Object.assign({ date: f.date, house: +r.house, f: ff, weights: [], tpc: P.traysPerCrate }, meta); rec.calc = slipCalc(ff, [], P);
      await putDoc('records/' + id, rec, actor, src); written.push('records/' + id);
    }
  } else if (type === 'pullet_sheet') {
    for (const r of rows) {
      const date = fixDate(r.date || f.date); if (!date || !r.house) continue;
      const h = String(r.house).trim(), whole = /^\d+$/.test(h), slug = h.replace(/[^\d]+/g, '-');
      const ff = { age: r.age, birds: r.left || r.birds, h_dead: r.dead, h_culled: r.culled, f_used: r.feedKg, g_bird: r.gPerBird, std: r.std };
      for (const k of Object.keys(ff)) if (ff[k] == null || ff[k] === '') delete ff[k];
      // a sub-pen like "9/5" is kept in its own log so the house totals on the dashboard stay clean
      const path = whole ? `records/${date}_h${h}` : `pulletlog/${date}_h${slug}`;
      const rec = Object.assign({ date, house: whole ? +h : h, f: ff, weights: [], tpc: P.traysPerCrate, phase: 'pullet' }, meta); rec.calc = slipCalc(ff, [], P);
      await putDoc(path, rec, actor, src); written.push(path);
    }
  } else if (type === 'weigh_slip') {
    const id = `hs-${f.date}-${String(f.plate || 'x').replace(/[^\w]/g, '')}`;
    await putDoc('hensales/' + id, Object.assign({ date: f.date, house: num(f.house), birds: num(f.birds), plate: f.plate, ticket: f.ticket || '', netKg: num(f.net), wIn: num(f.w_in), wOut: num(f.w_out), timeIn: f.time_in || '', timeOut: f.time_out || '', buyer: f.buyer || '', pricePending: true, total: null }, meta), actor, src);
    written.push('hensales/' + id);
  } else if (type === 'gate_sheet') {
    const id = `gl-${f.date || now.slice(0, 10)}-${intakeId}`;
    await putDoc('gatelog/' + id, Object.assign({ date: f.date || null, buyer: f.buyer || '', total: num(f.total), rows: rows.map(r => ({ plate: r.plate, birds: num(r.birds) })) }, meta), actor, src);
    written.push('gatelog/' + id);
  } else if (type === 'fridge_temp') {
    const id = `fr-${f.date}-${intakeId}`;
    await putDoc('fridge/' + id, Object.assign({ date: f.date, rows: rows.map(r => ({ time: r.time, temp: num(r.temp), by: r.by || '' })) }, meta), actor, src);
    written.push('fridge/' + id);
  } else if (type === 'feed_delivery') {
    const id = `fd-${f.date}-${intakeId}`;
    await putDoc('feeddel/' + id, Object.assign({ date: f.date, time: f.time || '', plate: f.plate || '', driver: f.driver || '', ticket: f.ticket || '', formula: f.formula || '', weighKg: num(f.weighKg), drops: rows.map(r => ({ silo: r.silo, kg: num(r.kg) })), totalKg: rows.reduce((a, r) => a + (num(r.kg) || 0), 0) || num(f.weighKg), photos: [], note: 'รับจาก LINE' }, meta), actor, src);
    written.push('feeddel/' + id);
  }
  return written;
}
// Cross-document: gate sheet rows vs weigh slips of the same day (by plate digits).
export async function crossCheckHenSale(date) {
  if (!date) return null;
  const slips = await q(`select path, data from docs where collection='hensales' and data->>'date'=$1`, [date]);
  const gates = await q(`select path, data from docs where collection='gatelog' and data->>'date'=$1`, [date]);
  if (!slips.length || !gates.length) return null;
  const digits = s => String(s || '').replace(/\D/g, '').slice(-4);
  const out = [];
  for (const g of gates) for (const r of g.data.rows || []) {
    const s = slips.find(x => digits(x.data.plate) === digits(r.plate));
    out.push({ plate: r.plate, gateBirds: r.birds, slipBirds: s ? s.data.birds : null, slipNetKg: s ? s.data.netKg : null, match: s ? (s.data.birds == null || s.data.birds === r.birds) : false });
  }
  return out;
}
