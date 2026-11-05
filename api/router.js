// One serverless function routes every /api/* call (Vercel Hobby allows only 12 functions).
import { send, readJson, readRaw, bad, HttpError } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { FARM, currentUser, requireUser, login, sessionCookie, userCount, createUser, publicUser } from '../lib/auth.js';
import { hashPassword } from '../lib/crypto.js';
import { ROLES, isAdmin, isStaff, uidFor } from '../lib/roles.js';
import { changes, userWrite, putDoc, delDoc } from '../lib/store.js';
import { getSetting, setSetting, listKeys, addKey, delKey } from '../lib/settings.js';
import { PROVIDERS, FEATURES, featureConfig, chat, ocr, parseJson, runFeature, tts } from '../lib/ai.js';
import { dailyReportText } from '../lib/report.js';
import crypto from 'node:crypto';
import { DOC_TYPES, FIELD_LABELS } from '../lib/doctypes.js';
import { saveFile, createIntake, processIntake, getIntake, approve, answer, toReview, openQuestionIn, logEvent, sweep, dailySummary, score } from '../lib/pipeline.js';
import { lineConfig, verifySignature, getContent, say, push, botInfo, chatName, memberName, chatIdOf } from '../lib/line.js';
import fs from 'node:fs'; import path from 'node:path';

let waitUntil = p => { p.catch(e => console.error(e)); };
try { const m = await import('@vercel/functions'); if (m.waitUntil) waitUntil = p => m.waitUntil(p.catch(e => console.error(e))); } catch { }

const routes = [];
const on = (method, pattern, fn) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ method, re, keys, fn }); };
const origin = req => `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const b64img = i => { if (!i || !i.b64) bad('ไม่มีรูป'); const mime = i.mime || 'image/jpeg'; if (!/^image\/|^application\/pdf$/.test(mime)) bad('รองรับเฉพาะรูปภาพ'); return { mime, b64: String(i.b64).replace(/^data:[^,]+,/, '') }; };

// ---------- health / session ----------
on('GET', 'health', async () => ({ ok: true, db: !!(await one('select 1 as x')), time: new Date().toISOString() }));
on('GET', 'me', async req => { const u = await currentUser(req); return { user: u ? publicUser(u) : null, setupNeeded: (await userCount()) === 0, farm: (await one('select name from farms where id=$1', [FARM]))?.name }; });
on('POST', 'setup', async (req, res) => {
  if ((await userCount()) > 0) bad('ตั้งค่าครั้งแรกไปแล้ว ให้เข้าสู่ระบบแทน', 409);
  const b = await readJson(req);
  if (b.farmName) await q('update farms set name=$2 where id=$1', [FARM, b.farmName]);
  const id = await createUser({ username: b.username, display_name: b.display_name, password: b.password, role: 'owner' });
  const u = await one('select * from users where id=$1', [id]);
  res.setHeader('set-cookie', sessionCookie(u, req)); return { user: publicUser(u) };
});
on('POST', 'login', async (req, res) => { const b = await readJson(req); const u = await login(b.username, b.password); res.setHeader('set-cookie', sessionCookie(u, req)); return { user: publicUser(u) }; });
on('POST', 'logout', async (req, res) => { res.setHeader('set-cookie', sessionCookie(null, req)); return { ok: true }; });
on('POST', 'me/password', async req => {
  const u = await requireUser(req); const b = await readJson(req);
  const full = await one('select password_hash from users where id=$1', [u.id]);
  const { checkPassword } = await import('../lib/crypto.js');
  if (!checkPassword(String(b.old || ''), full.password_hash)) bad('รหัสผ่านเดิมไม่ถูกต้อง');
  if (String(b.password || '').length < 6) bad('รหัสผ่านใหม่อย่างน้อย 6 ตัว');
  await q('update users set password_hash=$2 where id=$1', [u.id, hashPassword(b.password)]); return { ok: true };
});

// ---------- dashboard data ----------
on('GET', 'db/changes', async (req, res, p, url) => { const u = await requireUser(req); return Object.assign(await changes(u, url.searchParams.get('since')), { me: { uid: uidFor(u) } }); });
on('POST', 'db/write', async req => {
  const u = await requireUser(req); const b = await readJson(req);
  const ops = Array.isArray(b.ops) ? b.ops : [b]; const out = [];
  for (const op of ops.slice(0, 200)) out.push(await userWrite(u, op));
  return { ok: true, results: out };
});
on('POST', 'files', async req => {
  const u = await requireUser(req); const raw = await readRaw(req);
  if (!raw.length) bad('ไฟล์ว่าง'); if (raw.length > 4.4e6) bad('ไฟล์ใหญ่เกินไป (สูงสุดประมาณ 4 MB)');
  const id = await saveFile(raw, req.headers['content-type'] || 'application/octet-stream', u.id);
  return { id, url: '/api/files/' + id };
});
on('GET', 'files/:id', async (req, res, p) => {
  await requireUser(req); const f = await one('select mime, data from files where id=$1 and farm_id=$2', [p.id, FARM]);
  if (!f) bad('ไม่พบไฟล์', 404);
  send(res, 200, Buffer.from(f.data), { 'content-type': f.mime || 'application/octet-stream', 'cache-control': 'private, max-age=86400' }); return undefined;
});
on('POST', 'ai/form', async req => {
  await requireUser(req); const b = await readJson(req);
  const images = (b.images || []).slice(0, 6).map(b64img);
  const t = await runFeature('form_read', { prompt: String(b.prompt || ''), images, json: true });
  if (t == null) bad('ยังไม่ได้ตั้งค่า AI สำหรับปุ่ม "อ่านจากรูป" (หน้า ตั้งค่า AI)', 400);
  return { result: parseJson(t) };
});
on('POST', 'ai/translate', async req => {
  await requireUser(req); const b = await readJson(req);
  const t = await runFeature('translate', { prompt: String(b.prompt || ''), json: true, maxTokens: 8000 });
  if (t == null) bad('ยังไม่ได้ตั้งค่า AI สำหรับการแปล', 400);
  return { result: parseJson(t) };
});

// voice report: build today's summary text, speak it once, keep the mp3 so replaying costs nothing
on('POST', 'report/voice', async req => {
  await requireUser(req, 'staff'); const b = await readJson(req);
  const text = await dailyReportText(b.date);
  const cfg = await featureConfig('tts'); const t0 = Date.now();
  const id = 'tts_' + crypto.createHash('sha256').update([cfg.provider, cfg.model, cfg.voice, text].join('|')).digest('hex').slice(0, 24);
  if (!(await one('select 1 as x from files where id=$1', [id]))) {
    const audio = await tts(cfg, text);
    await q('insert into files(id, farm_id, mime, size, data, created_by) values($1,$2,$3,$4,$5,$6) on conflict (id) do nothing', [id, FARM, 'audio/mpeg', audio.length, audio, 'tts']);
    q('insert into ai_calls(farm_id, feature, provider, model, ms, ok) values($1,$2,$3,$4,$5,true)', [FARM, 'tts', cfg.provider, cfg.model || '', Date.now() - t0]).catch(() => { });
  }
  return { text, audioUrl: '/api/files/' + id };
});
on('GET', 'report/text', async (req, res, p, url) => { await requireUser(req, 'staff'); return { text: await dailyReportText(url.searchParams.get('date')) }; });

// ---------- accounts ----------
on('GET', 'users', async req => {
  await requireUser(req, 'admin');
  const users = await q('select id, username, display_name, role, buyer_id, houses, active, line_user_id, created_at, last_login from users where farm_id=$1 order by created_at', [FARM]);
  const buyers = (await q(`select doc_id, data->>'name' as name, data->>'kind' as kind from docs where farm_id=$1 and collection='ledger' order by data->>'name'`, [FARM]));
  return { users, roles: ROLES, buyers };
});
on('POST', 'users', async req => { await requireUser(req, 'admin'); const b = await readJson(req); return { id: await createUser(b) }; });
on('PATCH', 'users/:id', async (req, res, p) => {
  const me = await requireUser(req, 'admin'); const b = await readJson(req);
  const t = await one('select * from users where id=$1 and farm_id=$2', [p.id, FARM]); if (!t) bad('ไม่พบบัญชี', 404);
  if (t.role === 'owner' && me.role !== 'owner') bad('เฉพาะเจ้าของฟาร์มแก้บัญชีเจ้าของได้', 403);
  if (b.role && !ROLES[b.role]) bad('บทบาทไม่ถูกต้อง');
  if (t.id === me.id && (b.active === false || (b.role && b.role !== t.role))) bad('แก้บทบาทหรือปิดบัญชีของตัวเองไม่ได้');
  if (b.role === 'owner' && me.role !== 'owner') bad('เฉพาะเจ้าของฟาร์มตั้งเจ้าของเพิ่มได้', 403);
  const sets = [], vals = [p.id];
  const add = (col, v, cast = '') => { vals.push(v); sets.push(`${col}=$${vals.length}${cast}`); };
  if (b.display_name) add('display_name', b.display_name);
  if (b.role) add('role', b.role);
  if ('buyer_id' in b) add('buyer_id', b.buyer_id || null);
  if (Array.isArray(b.houses)) add('houses', b.houses.map(Number), '::jsonb');
  if (typeof b.active === 'boolean') add('active', b.active);
  if (b.password) { if (String(b.password).length < 6) bad('รหัสผ่านอย่างน้อย 6 ตัว'); add('password_hash', hashPassword(b.password)); }
  if (sets.length) await q(`update users set ${sets.join(', ')} where id=$1`, vals);
  return { ok: true };
});
on('GET', 'labels', async req => { await requireUser(req); return { labels: FIELD_LABELS, docTypes: Object.fromEntries(Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label])) }; });
on('GET', 'profiles', async req => { await requireUser(req); return { profiles: (await q('select id, display_name as name, role, buyer_id from users where farm_id=$1 and active', [FARM])) }; });

// ---------- settings: LINE ----------
on('GET', 'settings/line', async req => {
  await requireUser(req, 'admin'); const c = await lineConfig();
  const chats = await q('select chat_id, kind, name, last_seen from line_chats where farm_id=$1 order by last_seen desc nulls last', [FARM]);
  const { channelSecret, accessToken, ...rest } = c;
  return Object.assign(rest, { hasSecret: !!channelSecret, hasToken: !!accessToken, secretLast4: channelSecret ? channelSecret.slice(-4) : '', tokenLast4: accessToken ? accessToken.slice(-4) : '', webhookUrl: origin(req) + '/api/line/webhook', chats });
});
on('POST', 'settings/line', async req => {
  await requireUser(req, 'admin'); const b = await readJson(req); const cur = await getSetting('line');
  const allow = ['enabled', 'intakeChats', 'notifyChats', 'replyOnSuccess', 'threshold', 'askTimeoutHours', 'maxQuestions'];
  const v = Object.assign({}, cur); for (const k of allow) if (k in b) v[k] = b[k];
  v.threshold = Math.max(50, Math.min(100, Number(v.threshold) || 90));
  await setSetting('line', v, { channelSecret: b.channelSecret === '' ? undefined : b.channelSecret, accessToken: b.accessToken === '' ? undefined : b.accessToken });
  return { ok: true };
});
on('POST', 'settings/line/test', async req => { await requireUser(req, 'admin'); const c = await lineConfig(); const info = await botInfo(c); return { ok: true, bot: { name: info.displayName, basicId: info.basicId } }; });
on('POST', 'settings/line/push-test', async req => { await requireUser(req, 'admin'); const b = await readJson(req); const c = await lineConfig(); await push(c, b.to, 'ทดสอบจากระบบปรียาฟาร์ม ✅'); return { ok: true }; });

// ---------- settings: AI + keys ----------
on('GET', 'settings/ai', async req => {
  await requireUser(req, 'admin'); const cfg = {};
  for (const f of Object.keys(FEATURES)) cfg[f] = await featureConfig(f);
  const usage = await q(`select feature, provider, model, count(*)::int n, sum(case when ok then 0 else 1 end)::int fails, avg(ms)::int ms from ai_calls where farm_id=$1 and at > now() - interval '30 days' group by 1,2,3 order by 1`, [FARM]);
  return { providers: PROVIDERS, features: FEATURES, config: cfg, keys: await listKeys(), usage };
});
on('POST', 'settings/ai', async req => {
  await requireUser(req, 'admin'); const b = await readJson(req); const cur = await getSetting('ai'); const features = Object.assign({}, cur.features);
  for (const [f, c] of Object.entries(b.features || {})) {
    if (!FEATURES[f]) continue;
    if (c.provider && !PROVIDERS[c.provider]) bad('ไม่รู้จักผู้ให้บริการ ' + c.provider);
    features[f] = { provider: c.provider || '', model: String(c.model || ''), keyId: c.keyId || '', baseUrl: String(c.baseUrl || ''), voice: String(c.voice || '').trim() };
  }
  await setSetting('ai', Object.assign({}, cur, { features })); return { ok: true };
});
on('POST', 'settings/ai/test', async req => {
  await requireUser(req, 'admin'); const b = await readJson(req); const cfg = b.config || await featureConfig(b.feature);
  const P = PROVIDERS[cfg.provider]; if (!P) bad('ยังไม่ได้เลือกผู้ให้บริการ');
  const t0 = Date.now();
  if (P.ttsOnly) { const a = await tts(cfg, 'ทดสอบเสียงรายงานของปรียาฟาร์ม'); return { ok: true, ms: Date.now() - t0, reply: `ได้ไฟล์เสียง ${Math.round(a.length / 1024)} KB`, audio: a.toString('base64') }; }
  if (P.ocrOnly) {
    const img = b.image ? b64img(b.image) : null; if (!img) return { ok: true, note: 'ผู้ให้บริการนี้ทดสอบด้วยรูปจริงได้ที่หน้า "ทดสอบ OCR"' };
    const text = await ocr(cfg, img); return { ok: true, ms: Date.now() - t0, reply: text.slice(0, 400) };
  }
  const text = await chat(cfg, { prompt: 'ตอบสั้นๆ ว่า "ใช้งานได้" เป็นภาษาไทย', maxTokens: 30, feature: b.feature });
  return { ok: true, ms: Date.now() - t0, reply: text.slice(0, 200) };
});
on('GET', 'keys', async req => { await requireUser(req, 'admin'); return { keys: await listKeys() }; });
on('POST', 'keys', async req => { await requireUser(req, 'admin'); const b = await readJson(req); if (!b.name || !b.value) bad('ใส่ชื่อและ API key'); return { id: await addKey(String(b.name), b.provider, String(b.value).trim()) }; });
on('DELETE', 'keys/:id', async (req, res, p) => { await requireUser(req, 'admin'); await delKey(p.id); return { ok: true }; });

// ---------- intake (documents) ----------
const INTAKE_COLS = 'id, source, file_id, chat_id, sender_name, doc_type, status, confidence, error, created_at, updated_at, reviewed_by';
on('GET', 'intake', async (req, res, p, url) => {
  await requireUser(req, 'staff'); const st = url.searchParams.get('status');
  const list = st === 'pending' ? `status in ('review','error','asking')` : st ? `status = $2` : 'true';
  const rows = await q(`select ${INTAKE_COLS}, fields->'fields' as head from intake where farm_id=$1 and ${list} order by created_at desc limit 200`, st && st !== 'pending' ? [FARM, st] : [FARM]);
  const counts = await q(`select status, count(*)::int n from intake where farm_id=$1 group by status`, [FARM]);
  return { items: rows.map(r => ({ ...r, head: r.head ? { house: r.head.house, date: r.head.date, plate: r.head.plate } : null })), counts: Object.fromEntries(counts.map(c => [c.status, c.n])), docTypes: Object.fromEntries(Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label])) };
});
on('GET', 'intake/:id', async (req, res, p) => {
  await requireUser(req, 'staff'); const it = await getIntake(p.id); if (!it) bad('ไม่พบ', 404);
  const events = await q('select at, actor, action, detail from intake_events where intake_id=$1 order by at', [p.id]);
  return { item: it, events, docTypes: Object.fromEntries(Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label])) };
});
on('POST', 'intake/upload', async req => {
  const u = await requireUser(req, 'staff'); const b = await readJson(req); const img = b64img(b.image);
  if (b.doc_type && !DOC_TYPES[b.doc_type]) bad('ประเภทเอกสารไม่ถูกต้อง');
  const fileId = await saveFile(Buffer.from(img.b64, 'base64'), img.mime, u.id);
  const id = await createIntake({ source: 'upload', fileId, senderId: u.id, senderName: u.display_name, docType: b.doc_type || null });
  const r = await processIntake(id, { notify: false });
  return Object.assign({ id }, r);
});
on('POST', 'intake/:id/approve', async (req, res, p) => { const u = await requireUser(req, 'admin'); const b = await readJson(req); return { ok: true, paths: await approve(p.id, b.data || null, u.display_name) }; });
on('POST', 'intake/:id/reject', async (req, res, p) => { const u = await requireUser(req, 'admin'); const b = await readJson(req); await q(`update intake set status='rejected', reviewed_by=$2, updated_at=now() where id=$1`, [p.id, u.display_name]); await logEvent(p.id, u.display_name, 'rejected', { why: b.why || '' }); return { ok: true }; });
on('POST', 'intake/:id/reprocess', async (req, res, p) => { const u = await requireUser(req, 'admin'); const b = await readJson(req); if (b.doc_type) await q('update intake set doc_type=$2 where id=$1', [p.id, b.doc_type]); await logEvent(p.id, u.display_name, 'reprocess', {}); return await processIntake(p.id, { notify: false }); });
on('POST', 'intake/:id/undo', async (req, res, p) => {
  const u = await requireUser(req, 'admin'); const it = await getIntake(p.id); if (!it) bad('ไม่พบ', 404);
  for (const path of (it.committed && it.committed.paths) || []) await delDoc(path);
  await q(`update intake set status='review', committed=null, updated_at=now() where id=$1`, [p.id]); await logEvent(p.id, u.display_name, 'undone', { paths: it.committed?.paths }); return { ok: true };
});

// ---------- OCR lab: same picture through several providers side by side ----------
on('POST', 'lab/compare', async req => {
  await requireUser(req, 'admin'); const b = await readJson(req); const img = b64img(b.image);
  const T = DOC_TYPES[b.doc_type] || DOC_TYPES.daily_slip;
  const runs = (b.configs || []).slice(0, 6).map(async cfg => {
    const P = PROVIDERS[cfg.provider]; const t0 = Date.now();
    try {
      if (!P) throw new Error('ไม่รู้จักผู้ให้บริการ');
      if (P.ocrOnly || cfg.mode === 'ocr') { const text = await ocr(cfg, img); return { cfg, ms: Date.now() - t0, text }; }
      const raw = await chat(cfg, { prompt: T.prompt(), images: [img], json: true, feature: 'extract' });
      let data = null; try { data = parseJson(raw); } catch { }
      return { cfg, ms: Date.now() - t0, data, text: data ? null : raw };
    } catch (e) { return { cfg, ms: Date.now() - t0, error: e.message }; }
  });
  return { results: await Promise.all(runs) };
});

// ---------- LINE webhook ----------
on('POST', 'line/webhook', async (req, res) => {
  const raw = await readRaw(req); const c = await lineConfig();
  if (!verifySignature(raw, req.headers['x-line-signature'], c.channelSecret)) bad('signature ไม่ถูกต้อง', 401);
  const body = JSON.parse(raw.toString('utf8') || '{}');
  const jobs = [];
  for (const ev of body.events || []) jobs.push(handleLine(c, ev).catch(e => console.error('line event', e)));
  waitUntil(Promise.all(jobs));
  return { ok: true };
});
async function handleLine(c, ev) {
  if (!c.enabled || !ev.source) return;
  const chatId = chatIdOf(ev.source); const kind = ev.source.type;
  const known = await one('select name from line_chats where farm_id=$1 and chat_id=$2', [FARM, chatId]);
  await q(`insert into line_chats(farm_id, chat_id, kind, name, last_seen) values($1,$2,$3,$4,now()) on conflict (farm_id, chat_id) do update set last_seen=now(), name=coalesce(line_chats.name, excluded.name)`, [FARM, chatId, kind, known?.name || await chatName(c, ev.source)]);
  const allowed = !(c.intakeChats || []).length || c.intakeChats.includes(chatId);
  if (ev.type === 'message' && ev.message.type === 'image') {
    if (!allowed) return;
    const { buf, mime } = await getContent(c, ev.message.id);
    const fileId = await saveFile(buf, mime, 'line:' + (ev.source.userId || ''));
    const id = await createIntake({ source: 'line', fileId, chatId, senderId: ev.source.userId, senderName: await memberName(c, ev.source) });
    await processIntake(id, { replyToken: ev.replyToken });
    return;
  }
  if (ev.type === 'postback') {
    let d; try { d = JSON.parse(ev.postback.data); } catch { return; }
    const who = await memberName(c, ev.source) || 'คนในกลุ่ม';
    const it = await getIntake(d.i); if (!it || it.status !== 'asking') { await say(c, { token: ev.replyToken }, 'รายการนี้จัดการไปแล้วครับ'); return; }
    if (d.a === 'retake') { await q(`update intake set status='retake', updated_at=now() where id=$1`, [d.i]); await logEvent(d.i, who, 'retake', {}); await say(c, { token: ev.replyToken }, 'ได้ครับ ส่งรูปใหม่เข้ามาได้เลย ถ่ายให้เห็นทั้งใบ ไม่เอียง ไม่มีเงาบัง 🙏'); return; }
    if (d.a === 'review') { await toReview(d.i, who, 'คนในกลุ่มขอให้ผู้บริหารดู'); await say(c, { token: ev.replyToken }, 'ส่งให้ผู้บริหารตรวจแล้วครับ'); return; }
    if (d.f) await answer(d.i, d.f, d.v, who, ev.replyToken);
    return;
  }
  if (ev.type === 'message' && ev.message.type === 'text') {
    const t = ev.message.text.trim();
    const open = await openQuestionIn(chatId);
    if (open && open.ask?.open && /^[\d.,\s-]{1,20}$/.test(t)) { await answer(open.id, open.ask.open, t.replace(/[\s,]/g, ''), await memberName(c, ev.source) || 'คนในกลุ่ม', ev.replyToken); return; }
    if (/^(สรุป|สถานะ|summary)$/i.test(t)) await say(c, { token: ev.replyToken }, await dailySummary());
  }
}

// ---------- scheduled ----------
on('GET', 'cron/daily', async req => {
  const ok = process.env.CRON_SECRET ? req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET : true;
  if (!ok) bad('forbidden', 403);
  const escalated = await sweep(); const c = await lineConfig(); const text = await dailySummary(); const sent = [];
  for (const to of c.notifyChats || []) { try { await push(c, to, text); sent.push(to); } catch (e) { console.error(e); } }
  return { ok: true, escalated, sent: sent.length };
});
on('POST', 'cron/sweep', async req => { await requireUser(req, 'admin'); return { escalated: await sweep() }; });

// ---------- demo data ----------
on('POST', 'admin/seed', async req => {
  const u = await requireUser(req, 'admin');
  const file = [path.join(process.cwd(), 'public/farm/demo.json'), path.join(process.cwd(), 'data/demo.json')].find(f => fs.existsSync(f));
  if (!file) bad('ไม่พบไฟล์ข้อมูลตัวอย่าง');
  const S = JSON.parse(fs.readFileSync(file, 'utf8')); let n = 0;
  for (const [p, d] of Object.entries(S)) { if ((await one('select 1 as x from docs where farm_id=$1 and path=$2', [FARM, p]))) continue; await putDoc(p, d, u.id, 'demo'); n++; }
  return { ok: true, added: n };
});
on('POST', 'admin/clear-demo', async req => {
  await requireUser(req, 'admin'); const rows = await q(`select path from docs where farm_id=$1 and source='demo'`, [FARM]);
  for (const r of rows) await delDoc(r.path); return { ok: true, removed: rows.length };
});
on('GET', 'admin/stats', async req => {
  await requireUser(req, 'staff');
  const c = await q(`select collection, count(*)::int n, sum(case when source='demo' then 1 else 0 end)::int demo from docs where farm_id=$1 group by 1 order by 1`, [FARM]);
  const pending = (await one(`select count(*)::int n from intake where farm_id=$1 and status in ('review','error')`, [FARM]))?.n || 0;
  return { collections: c, pending };
});

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = (url.searchParams.get('__p') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  url.searchParams.delete('__p');
  try {
    if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 16) bad('ยังไม่ได้ตั้งค่า APP_SECRET บน Vercel (ข้อความลับยาวอย่างน้อย 16 ตัว)', 500);
    for (const r of routes) {
      if (r.method !== req.method) continue; const m = p.match(r.re); if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.fn(req, res, params, url);
      if (out !== undefined && !res.writableEnded) send(res, 200, out);
      return;
    }
    send(res, 404, { error: 'ไม่พบ ' + req.method + ' /api/' + p });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message || String(e), code: e.code });
  }
}
export const config = { api: { bodyParser: false } };
