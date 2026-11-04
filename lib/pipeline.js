// Paper → data: classify, read, double-check, score confidence, then auto-save or ask a person.
import { q, one } from './db.js';
import { rid } from './crypto.js';
import { FARM } from './auth.js';
import { runFeature, parseJson, featureConfig } from './ai.js';
import { FIELD_LABELS, DOC_TYPES, CLASSIFY_PROMPT, runChecks, normalize, commit, crossCheckHenSale } from './doctypes.js';
import { lineConfig, say, quick } from './line.js';

export async function logEvent(intakeId, actor, action, detail) {
  await q('insert into intake_events(intake_id, actor, action, detail) values($1,$2,$3,$4::jsonb)', [intakeId, actor || 'ระบบ', action, detail || {}]);
}
export async function saveFile(buf, mime, by) {
  const id = 'f_' + rid(16);
  await q('insert into files(id, farm_id, mime, size, data, created_by) values($1,$2,$3,$4,$5,$6)', [id, FARM, mime, buf.length, buf, by || null]);
  return id;
}
export async function createIntake({ source, fileId, chatId, senderId, senderName, docType }) {
  const id = 'in_' + rid(12);
  await q(`insert into intake(id, farm_id, source, file_id, chat_id, sender_id, sender_name, doc_type, status) values($1,$2,$3,$4,$5,$6,$7,$8,'new')`,
    [id, FARM, source, fileId, chatId || null, senderId || null, senderName || null, docType || null]);
  await logEvent(id, senderName, 'received', { source });
  return id;
}
export const getIntake = id => one('select * from intake where farm_id=$1 and id=$2', [FARM, id]);
async function upd(id, patch) {
  const keys = Object.keys(patch); if (!keys.length) return;
  const json = new Set(['fields', 'checks', 'committed', 'ask']);
  const sets = keys.map((k, i) => `${k}=$${i + 3}${json.has(k) ? '::jsonb' : ''}`).join(', ');
  await q(`update intake set ${sets}, updated_at=now() where farm_id=$1 and id=$2`, [FARM, id, ...keys.map(k => patch[k])]);
}
async function imageOf(fileId) {
  const f = await one('select mime, data from files where id=$1', [fileId]);
  if (!f) throw new Error('ไม่พบไฟล์รูป');
  return { mime: f.mime || 'image/jpeg', b64: Buffer.from(f.data).toString('base64') };
}
// flatten {fields, rows} into "key → value" for confidence bookkeeping
function flat(d) {
  const o = {}; for (const [k, v] of Object.entries(d.fields || {})) o[k] = v;
  (d.rows || []).forEach((r, i) => { for (const [k, v] of Object.entries(r)) o[`rows.${i}.${k}`] = v; });
  return o;
}
export function setFlat(d, key, value) {
  const m = key.match(/^rows\.(\d+)\.(.+)$/);
  if (m) { d.rows = d.rows || []; d.rows[+m[1]] = d.rows[+m[1]] || {}; d.rows[+m[1]][m[2]] = value; }
  else { d.fields = d.fields || {}; d.fields[key] = value; }
}
const same = (a, b) => String(a ?? '').replace(/[,\s]/g, '').replace(/^\./, '0.') === String(b ?? '').replace(/[,\s]/g, '').replace(/^\./, '0.');

// Combine: AI self-score, second reading, arithmetic/history checks, human answers.
export function score(data, checks, verify, human = {}) {
  const F = flat(data); const conf = {}; const why = {};
  for (const k of Object.keys(F)) {
    let c = Number(data.conf?.[k]); if (!isFinite(c)) c = 85; why[k] = [`AI ${c}`];
    if (verify) {
      const v = flat(verify)[k];
      if (v === undefined) { why[k].push('รอบ 2 ไม่ได้อ่านช่องนี้'); }
      else if (!same(v, F[k])) { c = Math.min(c, 40); why[k].push(`รอบ 2 อ่านได้ ${v}`); }
      else { c = Math.min(100, c + 8); why[k].push('รอบ 2 ตรงกัน'); }
    }
    conf[k] = c;
  }
  for (const ch of checks) for (const k of ch.fields || []) {
    if (!(k in conf)) { if (!ch.ok) { conf[k] = 0; why[k] = ['ไม่มีค่า']; } continue; }
    if (ch.ok) { conf[k] = Math.min(100, conf[k] + 5); why[k].push('✓ ' + ch.msg); }
    else { conf[k] = Math.min(conf[k], 50); why[k].push('✗ ' + ch.msg); }
  }
  for (const k of Object.keys(human)) { conf[k] = 100; (why[k] = why[k] || []).push('คนยืนยันแล้ว'); }
  const vals = Object.values(conf); const overall = vals.length ? Math.min(...vals) : 0;
  return { conf, why, overall };
}
// Pick the single most doubtful field that a person can answer quickly.
function pickQuestion(type, data, sc, checks, asked) {
  const T = DOC_TYPES[type] || {}; const askable = T.ask || {};
  const failing = checks.filter(c => !c.ok).flatMap(c => c.fields);
  const cand = Object.keys(sc.conf).concat(failing).filter((k, i, a) => a.indexOf(k) === i && !asked.includes(k));
  cand.sort((a, b) => (sc.conf[a] ?? 0) - (sc.conf[b] ?? 0) || ((askable[b] ? 1 : 0) - (askable[a] ? 1 : 0)));
  return cand.find(k => (sc.conf[k] ?? 0) < 90);
}
const LABEL = (type, k) => (DOC_TYPES[type]?.ask || {})[k] || FIELD_LABELS[k] || k.replace(/^rows\.(\d+)\./, (m, i) => `แถว ${+i + 1} `);

export async function processIntake(id, { notify = true, replyToken = null } = {}) {
  const it = await getIntake(id); if (!it) return;
  const fromLine = it.source === 'line'; const lc = await lineConfig();
  try {
    await upd(id, { status: 'reading' });
    const image = await imageOf(it.file_id);
    let type = it.doc_type;
    if (!type) {
      const c = parseJson(await runFeature('classify', { prompt: CLASSIFY_PROMPT, images: [image], json: true, maxTokens: 300 }) || '{"type":"unknown"}');
      type = DOC_TYPES[c.type] ? c.type : 'unknown';
      await logEvent(id, 'AI', 'classified', c);
    }
    if (type === 'unknown') {
      await upd(id, { doc_type: 'unknown', status: fromLine ? 'ignored' : 'review', confidence: 0 });
      return { status: fromLine ? 'ignored' : 'review' };
    }
    const T = DOC_TYPES[type];
    let ocrText = null;
    const ocrCfg = await featureConfig('ocr');
    if (ocrCfg.provider) { try { ocrText = await runFeature('ocr', { images: [image] }); await logEvent(id, 'AI', 'ocr', { chars: (ocrText || '').length }); } catch (e) { await logEvent(id, 'AI', 'ocr_failed', { error: e.message }); } }
    const prompt = T.prompt() + (ocrText ? `\n\nข้อความที่โปรแกรม OCR อ่านได้จากรูปเดียวกัน (ใช้ช่วยอ่าน แต่ถ้าขัดกับรูปให้เชื่อรูป):\n"""\n${ocrText.slice(0, 12000)}\n"""` : '');
    const data = normalize(type, parseJson(await runFeature('extract', { prompt, images: [image], json: true })));
    let verify = null;
    const vCfg = await featureConfig('verify');
    if (vCfg.provider) { try { verify = normalize(type, parseJson(await runFeature('verify', { prompt: T.prompt(), images: [image], json: true }))); } catch (e) { await logEvent(id, 'AI', 'verify_failed', { error: e.message }); } }
    const checks = await runChecks(type, data.fields, data.rows);
    const sc = score(data, checks, verify);
    const stored = Object.assign({}, data, { verify: verify ? { fields: verify.fields, rows: verify.rows } : null, scoreConf: sc.conf, why: sc.why, human: {} });
    await upd(id, { doc_type: type, ocr_text: ocrText, fields: stored, checks, confidence: sc.overall, status: 'scored' });
    await logEvent(id, 'AI', 'read', { overall: sc.overall, failing: checks.filter(c => !c.ok).map(c => c.id) });
    return await decide(id, { notify, replyToken });
  } catch (e) {
    await upd(id, { status: 'error', error: String(e.message || e).slice(0, 800) });
    await logEvent(id, 'ระบบ', 'error', { error: e.message });
    if (fromLine && notify && e.code !== 'not_configured') { try { await say(lc, { token: replyToken, to: it.chat_id }, 'รับรูปแล้ว แต่ตอนนี้ระบบอ่านไม่สำเร็จ ผู้บริหารจะเข้ามาตรวจให้ครับ'); } catch { } }
    return { status: 'error', error: e.message };
  }
}
// After reading or after each human answer: save automatically, ask the next question, or hand to the executive.
export async function decide(id, { notify = true, replyToken = null } = {}) {
  const it = await getIntake(id); const lc = await lineConfig(); const fromLine = it.source === 'line';
  const d = it.fields; const type = it.doc_type;
  const checks = await runChecks(type, d.fields, d.rows);
  const sc = score(d, checks, d.verify, d.human || {});
  d.scoreConf = sc.conf; d.why = sc.why;
  const threshold = Number(lc.threshold) || 90;
  const failing = checks.filter(c => !c.ok && !(c.fields || []).every(f => (d.human || {})[f]));
  if (sc.overall >= threshold && !failing.length) {
    const written = await commit(type, d, it.sender_name, id, it.file_id);
    const cross = type === 'weigh_slip' || type === 'gate_sheet' ? await crossCheckHenSale(d.fields.date) : null;
    const status = Object.keys(d.human || {}).length ? 'confirmed' : 'auto';
    await upd(id, { fields: d, checks, confidence: sc.overall, status, committed: { paths: written, cross }, ask: null });
    await logEvent(id, 'AI', status, { paths: written, overall: sc.overall });
    if (fromLine && notify && lc.replyOnSuccess) {
      const crossBad = cross && cross.some(x => !x.match);
      try { await say(lc, { token: replyToken, to: it.chat_id }, `✅ บันทึก${DOC_TYPES[type].label}${d.fields.house ? ' เล้า ' + d.fields.house : ''}${d.fields.date ? ' วันที่ ' + d.fields.date : ''} แล้ว (มั่นใจ ${Math.round(sc.overall)}%)${crossBad ? '\n⚠️ ตัวเลขไม่ตรงกับใบชั่ง/ใบหน้าฟาร์ม ส่งให้ผู้บริหารดูแล้ว' : ''}`); } catch { }
    }
    return { status, confidence: sc.overall, written };
  }
  const asked = (it.ask && it.ask.asked) || [];
  const field = pickQuestion(type, d, sc, checks, asked);
  if (!fromLine || !field || asked.length >= (lc.maxQuestions || 3)) {
    await upd(id, { fields: d, checks, confidence: sc.overall, status: 'review', ask: it.ask ? Object.assign({}, it.ask, { open: null }) : null });
    await logEvent(id, 'AI', 'to_review', { overall: sc.overall, failing: failing.map(c => c.id) });
    if (fromLine && notify && asked.length) { try { await say(lc, { token: replyToken, to: it.chat_id }, 'ขอบคุณครับ ส่งให้ผู้บริหารตรวจต่อแล้ว'); } catch { } }
    return { status: 'review', confidence: sc.overall };
  }
  const F = flat(d); const cur = F[field]; const alt = d.verify ? flat(d.verify)[field] : undefined;
  const opts = [];
  if (cur != null && cur !== '') opts.push({ label: String(cur), data: { i: id, f: field, v: String(cur) } });
  if (alt != null && alt !== '' && !same(alt, cur)) opts.push({ label: String(alt), data: { i: id, f: field, v: String(alt) } });
  opts.push({ label: '📷 ถ่ายรูปใหม่', data: { i: id, a: 'retake' } }, { label: 'ให้ผู้บริหารดู', data: { i: id, a: 'review' } });
  const hint = (sc.why[field] || []).filter(x => x.startsWith('✗')).map(x => x.slice(2)).join(', ');
  const text = `🤔 ${DOC_TYPES[type].label}${d.fields.house ? ' เล้า ' + d.fields.house : ''}${d.fields.date ? ' (' + d.fields.date + ')' : ''}\nช่อง "${LABEL(type, field)}" อ่านได้ ${cur ?? '(ไม่เห็น)'}${alt != null && !same(alt, cur) ? ' หรือ ' + alt : ''}${hint ? '\nเพราะ: ' + hint : ''}\nกดเลือก หรือพิมพ์ตัวเลขที่ถูกตอบกลับมาได้เลยครับ`;
  const ask = { asked: [...asked, field], open: field, at: new Date().toISOString() };
  await upd(id, { fields: d, checks, confidence: sc.overall, status: 'asking', ask });
  await logEvent(id, 'AI', 'asked', { field, cur, alt });
  if (notify) { try { await say(lc, { token: replyToken, to: it.chat_id }, quick(text, opts)); } catch (e) { await logEvent(id, 'ระบบ', 'line_failed', { error: e.message }); } }
  return { status: 'asking', field, confidence: sc.overall };
}
export async function answer(id, field, value, actor, replyToken) {
  const it = await getIntake(id); if (!it || it.status !== 'asking') return null;
  const d = it.fields; setFlat(d, field, value); d.human = Object.assign({}, d.human, { [field]: actor || 'คนในกลุ่ม' });
  await upd(id, { fields: d }); await logEvent(id, actor, 'answered', { field, value });
  return decide(id, { replyToken });
}
export async function toReview(id, actor, why) {
  await upd(id, { status: 'review', ask: null }); await logEvent(id, actor, 'to_review', { why });
}
// Executive edits fields in the inbox then approves → commit.
export async function approve(id, edited, actor) {
  const it = await getIntake(id); if (!it) throw new Error('ไม่พบรายการ');
  const d = Object.assign({}, it.fields || {}, edited ? { fields: edited.fields, rows: edited.rows, weights: edited.weights ?? it.fields?.weights } : {});
  const type = edited?.doc_type || it.doc_type;
  if (!DOC_TYPES[type]) throw new Error('ยังไม่ได้เลือกประเภทเอกสาร');
  const written = await commit(type, d, actor, id, it.file_id);
  await upd(id, { doc_type: type, fields: d, status: 'approved', committed: { paths: written }, reviewed_by: actor, ask: null });
  await logEvent(id, actor, 'approved', { paths: written, edited: !!edited });
  return written;
}
// Find the open question in a chat (newest first) for free-text answers.
export async function openQuestionIn(chatId) {
  return one(`select id, ask from intake where farm_id=$1 and chat_id=$2 and status='asking' order by updated_at desc limit 1`, [FARM, chatId]);
}
// cron: questions nobody answered → executive inbox; daily summary to notify chats.
export async function sweep() {
  const lc = await lineConfig(); const hrs = Number(lc.askTimeoutHours) || 3;
  const stale = await q(`select id from intake where farm_id=$1 and status='asking' and updated_at < now() - ($2 || ' hours')::interval`, [FARM, String(hrs)]);
  for (const s of stale) await toReview(s.id, 'ระบบ', `ไม่มีคนตอบภายใน ${hrs} ชม.`);
  return stale.length;
}
export async function dailySummary() {
  const rows = await q(`select status, count(*)::int n from intake where farm_id=$1 and created_at > now() - interval '24 hours' group by status`, [FARM]);
  const m = Object.fromEntries(rows.map(r => [r.status, r.n]));
  const pend = (await one(`select count(*)::int n from intake where farm_id=$1 and status in ('review','error')`, [FARM]))?.n || 0;
  const total = rows.reduce((a, r) => a + r.n, 0);
  return `📋 สรุปเอกสารวันนี้ (24 ชม.)\nรับรูป ${total} ใบ\n✅ บันทึกเองอัตโนมัติ ${m.auto || 0}\n🙋 ถามคนแล้วบันทึก ${m.confirmed || 0}\n👀 ผู้บริหารอนุมัติ ${m.approved || 0}\n⏳ รอผู้บริหารตรวจ ${pend}${m.ignored ? `\n(ไม่ใช่เอกสาร ${m.ignored})` : ''}`;
}
