import crypto from 'node:crypto';
import { getSetting } from './settings.js';
const API = () => (process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/$/, '');
const DATA = () => (process.env.LINE_API_BASE || 'https://api-data.line.me').replace(/\/$/, '');
export async function lineConfig() {
  const { value, secret } = await getSetting('line', true);
  return Object.assign({ enabled: true, intakeChats: [], notifyChats: [], replyOnSuccess: true, threshold: 90, askTimeoutHours: 3, maxQuestions: 3, summaryHour: 18 }, value, { channelSecret: secret.channelSecret || '', accessToken: secret.accessToken || '' });
}
export function verifySignature(raw, signature, channelSecret) {
  if (!channelSecret || !signature) return false;
  const mac = crypto.createHmac('sha256', channelSecret).update(raw).digest();
  let sig; try { sig = Buffer.from(signature, 'base64'); } catch { return false; }
  return sig.length === mac.length && crypto.timingSafeEqual(sig, mac);
}
async function call(cfg, path, body, base = API()) {
  if (!cfg.accessToken) throw new Error('ยังไม่ได้ใส่ Channel access token ของ LINE');
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + cfg.accessToken, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`LINE ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
export async function getContent(cfg, messageId) {
  const r = await call(cfg, `/v2/bot/message/${messageId}/content`, null, DATA());
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
}
const asMsgs = m => (Array.isArray(m) ? m : [m]).map(x => typeof x === 'string' ? { type: 'text', text: x.slice(0, 4900) } : x);
export async function reply(cfg, token, messages) { await call(cfg, '/v2/bot/message/reply', { replyToken: token, messages: asMsgs(messages) }); }
export async function push(cfg, to, messages) { await call(cfg, '/v2/bot/message/push', { to, messages: asMsgs(messages) }); }
// Reply when we still hold a token, otherwise push.
export async function say(cfg, { token, to }, messages) {
  if (token) { try { await reply(cfg, token, messages); return 'reply'; } catch (e) { if (!to) throw e; } }
  if (to) { await push(cfg, to, messages); return 'push'; }
}
export async function botInfo(cfg) { return (await call(cfg, '/v2/bot/info')).json(); }
export async function chatName(cfg, src) {
  try {
    if (src.type === 'group') return (await (await call(cfg, `/v2/bot/group/${src.groupId}/summary`)).json()).groupName;
    if (src.type === 'user') return (await (await call(cfg, `/v2/bot/profile/${src.userId}`)).json()).displayName;
  } catch { } return null;
}
export async function memberName(cfg, src) {
  try {
    if (src.type === 'group' && src.userId) return (await (await call(cfg, `/v2/bot/group/${src.groupId}/member/${src.userId}`)).json()).displayName;
    if (src.userId) return (await (await call(cfg, `/v2/bot/profile/${src.userId}`)).json()).displayName;
  } catch { } return null;
}
export const chatIdOf = s => s.groupId || s.roomId || s.userId;
export function quick(text, items) {
  return { type: 'text', text: text.slice(0, 4900), quickReply: { items: items.slice(0, 13).map(it => ({ type: 'action', action: it.data ? { type: 'postback', label: it.label.slice(0, 20), data: JSON.stringify(it.data).slice(0, 300), displayText: (it.display || it.label).slice(0, 300) } : { type: 'message', label: it.label.slice(0, 20), text: it.text || it.label } })) } };
}
