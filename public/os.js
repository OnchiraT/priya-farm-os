// shared helpers for the back-office pages
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function api(method, path, body) {
  const r = await fetch('/api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let j = null; try { j = await r.json(); } catch { }
  if (!r.ok) { const e = new Error((j && j.error) || ('เกิดข้อผิดพลาด ' + r.status)); e.status = r.status; throw e; }
  return j;
}
let tt; export function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); } t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }
// shrink a photo so it fits the 4.5 MB upload limit but keeps handwriting sharp
export async function shrink(file, max = 2200, q = .88) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', q); return { mime: 'image/jpeg', b64: data.split(',')[1], preview: data };
  } finally { URL.revokeObjectURL(url); }
}
export const confCls = c => c == null ? '' : c >= 90 ? 'ok' : c >= 70 ? 'warn' : 'crit';
export const thTime = iso => iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '';
