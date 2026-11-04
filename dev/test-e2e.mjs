// End-to-end check against local Postgres with mocked AI + mocked LINE.
import http from 'node:http'; import crypto from 'node:crypto';
const BASE = 'http://localhost:' + (process.env.PORT||3999) + ''; const LINE_SECRET = 'line-secret-test';
const lineLog = [];
const lineSrv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    lineLog.push({ url: req.url, body: b ? JSON.parse(b) : null });
    if (req.url.includes('/content')) { res.setHeader('content-type', 'image/jpeg'); return res.end(Buffer.from('/9j/4AAQSkZJRg==', 'base64')); }
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/summary')) return res.end('{"groupName":"กลุ่มคนงานฟาร์ม"}');
    if (req.url.includes('/member/') || req.url.includes('/profile/')) return res.end('{"displayName":"ลุงสมศักดิ์"}');
    if (req.url.includes('/bot/info')) return res.end('{"displayName":"น้องปรียา","basicId":"@test"}');
    res.end('{}');
  });
}).listen(4100);
let cookie = '';
async function api(method, p, body, extra = {}) {
  const r = await fetch(BASE + '/api/' + p, { method, headers: { 'content-type': 'application/json', cookie, ...extra.headers }, body: extra.raw ?? (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok && !extra.ok) throw new Error(`${method} ${p} → ${r.status} ${t}`);
  return j;
}
const ok = (c, m) => { if (!c) { console.error('✗', m); process.exitCode = 1; } else console.log('✓', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const me0 = await api('GET', 'me'); ok(me0.setupNeeded, 'fresh install asks for setup');
await api('POST', 'setup', { username: 'owner', password: 'secret123', display_name: 'คุณนันท์ (ตัวอย่าง)' });
ok((await api('GET', 'me')).user.role === 'owner', 'owner created + signed in');
const seed = await api('POST', 'admin/seed'); ok(seed.added > 800, 'demo data seeded ' + seed.added);
// accounts
await api('POST', 'users', { username: 'somsak', password: 'pass123', display_name: 'ลุงสมศักดิ์', role: 'care', houses: [1, 2] });
await api('POST', 'users', { username: 'lhong1', password: 'pass123', display_name: 'ล้งทดสอบ', role: 'lhong', buyer_id: 'b-demo-b' });
const ul = await api('GET', 'users'); ok(ul.users.length === 3 && ul.buyers.length > 0, 'accounts listed with buyer choices');
// AI settings
const k = await api('POST', 'keys', { name: 'Claude หลัก', provider: 'anthropic', value: 'sk-ant-test-1234' });
await api('POST', 'settings/ai', { features: { verify: { provider: 'openai', model: 'gpt-4.1', keyId: k.id } } });
const ai = await api('GET', 'settings/ai'); ok(ai.config.verify.provider === 'openai' && !JSON.stringify(ai).includes('sk-ant-test'), 'AI settings saved; key never returned');
// LINE settings
await api('POST', 'settings/line', { channelSecret: LINE_SECRET, accessToken: 'tok-abcd', threshold: 90 });
const ls = await api('GET', 'settings/line'); ok(ls.hasSecret && ls.tokenLast4 === 'abcd' && !JSON.stringify(ls).includes(LINE_SECRET) && ls.webhookUrl.endsWith('/api/line/webhook'), 'LINE settings saved, secret hidden, webhook URL shown');
ok((await api('POST', 'settings/line/test')).bot.name === 'น้องปรียา', 'LINE connection test');
// manual upload: weigh slip → no house conflict, birds present
const up = await api('POST', 'intake/upload', { image: { mime: 'image/jpeg', b64: '/9j/4AAQ' }, doc_type: 'weigh_slip' });
console.log('  upload result', up.status, up.confidence);
ok(['auto', 'review'].includes(up.status), 'upload processed: ' + up.status);
// LINE webhook: daily slip where verify disagrees on h_dead → bot asks in group
const ev = (e) => { const raw = JSON.stringify({ events: [e] }); return { raw, headers: { 'x-line-signature': crypto.createHmac('sha256', LINE_SECRET).update(raw).digest('base64') } }; };
const bad = await api('POST', 'line/webhook', null, { raw: '{"events":[]}', headers: { 'x-line-signature': 'nope' }, ok: true }); ok(bad.error, 'bad signature rejected');
const src = { type: 'group', groupId: 'Cgroup1', userId: 'Uworker1' };
await api('POST', 'line/webhook', null, ev({ type: 'message', replyToken: 'rt1', source: src, message: { type: 'image', id: 'm1' } }));
await sleep(800);
const asks = lineLog.filter(l => l.url.includes('/reply'));
const q1 = asks.at(-1)?.body?.messages?.[0];
ok(q1 && q1.quickReply && /ไก่ตาย|h_dead/.test(q1.text), 'bot asked about the doubtful field: ' + (q1?.text || '').split('\n')[1]);
const pend = await api('GET', 'intake?status=asking'); const iid = pend.items[0]?.id; ok(!!iid, 'intake waiting for answer');
// answer with quick reply (choose 3)
const opt = q1.quickReply.items.find(i => i.action.type === 'postback' && JSON.parse(i.action.data).v === '3');
await api('POST', 'line/webhook', null, ev({ type: 'postback', replyToken: 'rt2', source: src, postback: { data: opt.action.data } }));
await sleep(800);
const it = await api('GET', 'intake/' + iid);
ok(['confirmed', 'asking', 'review'].includes(it.item.status), 'after answer: ' + it.item.status + ' conf ' + Math.round(it.item.confidence));
if (it.item.status === 'asking') console.log('  next question:', lineLog.filter(l => l.url.includes('/reply')).at(-1).body.messages[0].text.split('\n')[1]);
// dashboard data + worker redaction
const ch = await api('GET', 'db/changes'); ok(ch.docs.length > 800, 'owner sees all docs ' + ch.docs.length);
const ch2 = await api('GET', 'db/changes?since=' + encodeURIComponent(ch.now)); ok(ch2.docs.length === 0, 'incremental poll returns nothing new');
await api('POST', 'logout'); await api('POST', 'login', { username: 'somsak', password: 'pass123' });
const wc = await api('GET', 'db/changes'); const s = JSON.stringify(wc.docs);
ok(!wc.docs.some(d => d.p.startsWith('costs/') || d.p === 'public/prices') && !/"total":\d|"amount":\d|"price":\d/.test(s), 'worker sees no money');
const w = await api('POST', 'db/write', { op: 'set', path: 'costs/x', data: { amount: 1 } }, { ok: true }); ok(w.error, 'worker cannot write costs');
const w2 = await api('POST', 'db/write', { op: 'set', path: 'repairs/rp-1', data: { status: 'done' } }); const after = (await api('GET', 'db/changes?since=' + encodeURIComponent(wc.now)));
await api('POST', 'logout'); await api('POST', 'login', { username: 'owner', password: 'secret123' });
const rp = (await api('GET', 'db/changes')).docs.find(d => d.p === 'repairs/rp-1').d; ok(rp.status === 'done' && rp.total === 6650, 'worker edit kept the money fields intact');
await api('POST', 'logout'); await api('POST', 'login', { username: 'lhong1', password: 'pass123' });
const lc = await api('GET', 'db/changes'); ok(lc.me.uid === 'b-demo-b' && lc.docs.every(d => d.p.startsWith('public/') || d.p.startsWith('ledger/b-demo-b') || d.p.startsWith('deliv/b-demo-b_') || d.p.startsWith('data/users/b-demo-b')), 'lhong only sees own ledger (' + lc.docs.length + ' docs)');
const ad = await api('GET', 'users', null, { ok: true }); ok(ad.error, 'lhong cannot open accounts');
lineSrv.close(); console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
