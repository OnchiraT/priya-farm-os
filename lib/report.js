// Spoken daily report for executives: plain Thai sentences built from the latest saved records.
import { q, one } from './db.js';
import { FARM } from './auth.js';
import { farmConfig } from './farmconfig.js';
const n0 = v => Math.round(v).toLocaleString('th-TH');
const pct = v => `${(Math.round(v * 10) / 10).toLocaleString('th-TH')} เปอร์เซ็นต์`;
const thDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
export async function dailyReportText(dateWanted) {
  const last = dateWanted || (await one(`select max(data->>'date') d from docs where farm_id=$1 and collection='records'`, [FARM]))?.d;
  if (!last) return 'ยังไม่มีข้อมูลใบบันทึกในระบบ จึงยังรายงานไม่ได้ค่ะ';
  const recs = async d => (await q(`select data from docs where farm_id=$1 and collection='records' and data->>'date'=$2`, [FARM, d])).map(r => r.data);
  const prevDate = (await one(`select max(data->>'date') d from docs where farm_id=$1 and collection='records' and data->>'date' < $2`, [FARM, last]))?.d;
  const today = await recs(last), prev = prevDate ? await recs(prevDate) : [];
  const houses = (await q(`select data from docs where farm_id=$1 and collection='houses'`, [FARM])).map(r => r.data);
  const num = v => { const x = Number(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : 0; };
  const eggsOf = r => r.calc?.goodEggs || 0, birdsOf = r => r.calc?.birds || num(r.f?.birds);
  const layers = today.filter(r => eggsOf(r) > 0).sort((a, b) => a.house - b.house);
  const cfg = await farmConfig(); const A = cfg.alerts; const EPC = cfg.eggsPerTray * cfg.traysPerCrate;
  const L = [];
  const farmName = (await one('select name from farms where id=$1', [FARM]))?.name || '';
  L.push(`รายงานประจำวันที่ ${thDate(last)}${farmName ? ' ของ' + farmName : ''}`);
  if (layers.length) {
    const eggs = layers.reduce((a, r) => a + eggsOf(r), 0), birds = layers.reduce((a, r) => a + birdsOf(r), 0);
    const hd = eggs / birds * 100;
    const pl = prev.filter(r => eggsOf(r) > 0 && layers.some(x => x.house === r.house));
    const phd = pl.length ? pl.reduce((a, r) => a + eggsOf(r), 0) / pl.reduce((a, r) => a + birdsOf(r), 0) * 100 : null;
    L.push(`มีใบบันทึกไก่ไข่ ${layers.length} เล้า ได้ไข่ดีรวม ${n0(eggs)} ฟอง หรือประมาณ ${n0(eggs / EPC)} ลัง จากแม่ไก่ ${n0(birds)} ตัว อัตราไข่เฉลี่ย ${pct(hd)}${phd != null ? `, ${hd >= phd ? 'เพิ่มขึ้น' : 'ลดลง'} ${pct(Math.abs(hd - phd))} จากวันก่อน` : ''}.`);
  }
  const dead = today.reduce((a, r) => a + num(r.f?.h_dead), 0), culled = today.reduce((a, r) => a + num(r.f?.h_culled), 0);
  const cracked = today.reduce((a, r) => a + num(r.f?.d_cracked), 0);
  L.push(`ไก่ตายรวม ${n0(dead)} ตัว${culled ? ` คัดทิ้ง ${n0(culled)} ตัว` : ''} ไข่แตก ${n0(cracked)} ฟอง.`);
  for (const r of layers) {
    const p = prev.find(x => x.house === r.house); const hd = eggsOf(r) / birdsOf(r) * 100; const phd = p && eggsOf(p) ? eggsOf(p) / birdsOf(p) * 100 : null;
    L.push(`เล้า ${r.house}: ไข่ ${pct(hd)}${phd != null && Math.abs(hd - phd) >= 0.5 ? ` ${hd >= phd ? 'ขึ้น' : 'ลง'} ${pct(Math.abs(hd - phd))}` : ''}, ตาย ${n0(num(r.f?.h_dead))} ตัว${num(r.f?.f_used) ? `, อาหาร ${n0(r.calc?.feedPer || 0)} กรัมต่อตัว` : ''}.`);
  }
  const pullets = today.filter(r => !eggsOf(r));
  if (pullets.length) L.push(`ไก่เล็กมีบันทึก ${pullets.length} เล้า ตายรวม ${n0(pullets.reduce((a, r) => a + num(r.f?.h_dead), 0))} ตัว.`);
  // things that need attention
  const warn = [];
  for (const r of layers) {
    const p = prev.find(x => x.house === r.house); if (!p || !eggsOf(p)) continue;
    const drop = eggsOf(p) / birdsOf(p) * 100 - eggsOf(r) / birdsOf(r) * 100;
    if (drop >= A.hdDropWarn) warn.push(`เล้า ${r.house} ไข่ลดลง ${pct(drop)}`);
    const wp = r.calc?.waterPer, pw = p.calc?.waterPer; if (wp && pw && Math.abs(wp - pw) / pw * 100 > A.waterChangePct) warn.push(`เล้า ${r.house} กินน้ำ${wp > pw ? 'มากขึ้น' : 'น้อยลง'}ผิดปกติ`);
  }
  for (const r of today) { const b = birdsOf(r); if (b && num(r.f?.h_dead) / b * 100 >= A.deadWarnPct) warn.push(`เล้า ${r.house} ไก่ตาย ${n0(num(r.f?.h_dead))} ตัว สูงกว่าปกติ`); }
  const missing = houses.filter(h => h.status === 'active' && (h.birds || 0) > 0 && !today.some(r => r.house === h.no)).map(h => h.no).sort((a, b) => a - b);
  if (missing.length) warn.push(`ยังไม่มีใบบันทึกของเล้า ${missing.join(', ')}`);
  const pend = (await one(`select count(*)::int n from intake where farm_id=$1 and status in ('review','error')`, [FARM]))?.n || 0;
  if (pend) warn.push(`มีเอกสารรอผู้บริหารตรวจ ${pend} ใบ`);
  L.push(warn.length ? `เรื่องที่ควรดู: ${warn.join(' ; ')}.` : 'ไม่มีเรื่องผิดปกติที่ต้องดูเป็นพิเศษ.');
  return L.join('\n');
}
