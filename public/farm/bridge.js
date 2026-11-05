// Connects the farm dashboard (built against window.claude.use) to this app's own server.
// Loads every document the signed-in account may see, keeps it fresh by polling, and sends edits to /api/db/write.
(function () {
  const api = async (method, path, body, raw) => {
    const r = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: raw ? { 'content-type': raw.type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}, body: raw || (body ? JSON.stringify(body) : undefined) });
    let j = null; try { j = await r.json(); } catch (e) { }
    if (r.status === 401) { location.replace('/?next=' + encodeURIComponent(location.pathname + location.hash)); throw new Error('ต้องเข้าสู่ระบบ'); }
    if (!r.ok) { const e = new Error((j && j.error) || ('HTTP ' + r.status)); e.code = (j && j.code) || 'error'; throw e; }
    return j;
  };
  const cp = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const STORE = {}; const subs = new Set(); let since = null; let ready; let polling = false;
  const fire = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  // first load and every poll come in pages, so a big farm never hits the size limit of one answer
  async function pull() {
    if (polling) return; polling = true;
    try {
      let changed = false, r, after = null, upto = null;
      do {
        const qs = new URLSearchParams(); if (since) qs.set('since', since); if (upto) qs.set('upto', upto); if (after) qs.set('after', after);
        r = await api('GET', 'db/changes' + (qs.toString() ? '?' + qs : ''));
        for (const d of r.docs) { STORE[d.p] = d.d; changed = true; }
        for (const p of r.deleted || []) { if (p in STORE) { delete STORE[p]; changed = true; } }
        after = r.after; upto = r.upto;
      } while (r.more);
      since = r.now; if (changed) fire();
    } finally { polling = false; }
  }
  const toast = msg => { let t = document.getElementById('pfToast'); if (!t) { t = document.createElement('div'); t.id = 'pfToast'; t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#c2362b;color:#fff;padding:10px 14px;border-radius:10px;z-index:9999;font:14px system-ui;max-width:90vw'; document.body.append(t); } t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 4000); };
  async function write(op) {
    try { await api('POST', 'db/write', op); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); since = null; for (const k of Object.keys(STORE)) delete STORE[k]; await pull(); fire(); throw e; }
  }
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const inCol = c => Object.keys(STORE).filter(p => p.slice(0, p.lastIndexOf('/')) === c);
  const snap = p => { const d = STORE[p]; return { id: p.split('/').pop(), exists: !!d, data: () => cp(d), metadata: { hasPendingWrites: false, fromCache: false }, ref: doc(p) }; };
  const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, 'in': (a, b) => Array.isArray(b) && b.includes(a), 'array-contains': (a, b) => Array.isArray(a) && a.includes(b) };
  function query(c, o) {
    let docs = inCol(c).map(snap);
    for (const [f, op, v] of o.where) docs = docs.filter(d => { const x = d.data()[f]; return (OPS[op] || OPS['=='])(x, v); });
    if (o.order) docs.sort((a, b) => { const x = a.data()[o.order[0]], y = b.data()[o.order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (o.order[1] === 'desc' ? -1 : 1); });
    if (o.limit) docs = docs.slice(0, o.limit);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {}, forEach: f => docs.forEach(f) };
  }
  function doc(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: async () => { await ready; return snap(p); },
      set: async (d, o) => { STORE[p] = o && o.merge ? Object.assign({}, STORE[p] || {}, cp(d)) : cp(d); fire(); await write({ op: o && o.merge ? 'update' : 'set', path: p, data: d }); },
      update: async d => { STORE[p] = Object.assign({}, STORE[p] || {}, cp(d)); fire(); await write({ op: 'update', path: p, data: d }); },
      delete: async () => { delete STORE[p]; fire(); await write({ op: 'delete', path: p }); },
      onSnapshot: (next, err) => { let last; const f = () => { const s = snap(p); const k = JSON.stringify(s.data() ?? null); if (k !== last) { last = k; next(s); } }; subs.add(f); ready.then(() => setTimeout(f, 0)).catch(e => err && err(e)); return () => subs.delete(f); },
      collection: c => col(p + '/' + c),
    };
  }
  function col(c, o = { where: [], order: null, limit: 0 }) {
    const r = {
      path: c, id: c.split('/').pop(),
      doc: id => doc(c + '/' + (id || newId())),
      add: async d => { const x = doc(c + '/' + newId()); await x.set(d); return x; },
      where: (f, op, v) => col(c, Object.assign({}, o, { where: o.where.concat([[f, op, v]]) })),
      orderBy: (f, dir) => col(c, Object.assign({}, o, { order: [f, dir || 'asc'] })),
      limit: n => col(c, Object.assign({}, o, { limit: n })),
      get: async () => { await ready; return query(c, o); },
      onSnapshot: (next, err) => { let last; const f = () => { const s = query(c, o); const k = JSON.stringify(s.docs.map(d => [d.id, STORE[c + '/' + d.id]])); if (k !== last) { last = k; next(s); } }; subs.add(f); ready.then(() => setTimeout(f, 0)).catch(e => err && err(e)); return () => subs.delete(f); },
    };
    return r;
  }
  const db = { doc, collection: c => col(c) };
  let ME = null;
  const blobB64 = b => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = no; fr.readAsDataURL(b); });
  async function shrinkBlob(b, max = 2000) {
    try {
      const bmp = await createImageBitmap(b); const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); if (s === 1 && b.size < 1.5e6) return b;
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', .88));
    } catch (e) { return b; }
  }
  const caps = {
    db,
    user: {
      id: async () => ME.uid, name: async () => ME.name, isOwner: async () => ME.group === 'farm',
      canEdit: async () => ME.group === 'farm', can: async () => ME.group === 'farm' || ME.group === 'work',
      profiles: async ids => { const r = await api('GET', 'profiles'); const m = {}; r.profiles.forEach(p => m[p.id] = { name: p.name }); return Object.fromEntries((ids || []).map(id => [id, m[id] || { name: '' }])); },
      search: async qq => { const r = await api('GET', 'profiles'); qq = (qq || '').toLowerCase(); return r.profiles.filter(p => (p.role === 'lhong' || p.role === 'customer') && (!qq || (p.name || '').toLowerCase().includes(qq))).map(p => ({ id: p.buyer_id || p.id, name: p.name })); },
    },
    assets: { upload: async blob => { const b = await shrinkBlob(blob); return api('POST', 'files', null, b); } },
    sample: {
      limits: async () => ({ images: true, maxCount: 3 }),
      json: async (prompt, opts = {}) => {
        const imgs = []; for (const b of (opts.images || []).slice(0, 3)) { const s = await shrinkBlob(b, 1800); imgs.push({ mime: s.type || 'image/jpeg', b64: await blobB64(s) }); }
        const r = imgs.length ? await api('POST', 'ai/form', { prompt, images: imgs }) : await api('POST', 'ai/translate', { prompt });
        return r.result;
      },
    },
  };
  ready = (async () => {
    const me = await api('GET', 'me');
    if (!me.user) { location.replace('/?next=' + encodeURIComponent('/farm/' + location.hash)); throw new Error('login'); }
    const u = me.user; ME = { uid: (u.group === 'lhong' || u.group === 'cust') && u.buyerId ? u.buyerId : u.id, name: u.name, role: u.role, group: u.group, buyerId: u.buyerId, houses: u.houses, roleLabel: u.roleLabel };
    window.__PF = ME;
    await pull();
    setInterval(() => { if (!document.hidden) pull().catch(() => { }); }, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull().catch(() => { }); });
  })();
  // small floating menu: back office (with documents waiting) + sign out
  function osMenu() {
    const el = document.createElement('div'); el.id = 'pfOs';
    el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9000;display:flex;gap:6px;font:600 13px "IBM Plex Sans Thai",system-ui';
    const b = 'background:#11241a;color:#fff;border:0;border-radius:999px;padding:8px 13px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;display:inline-flex;gap:6px;align-items:center';
    el.innerHTML = (ME.group === 'farm' ? `<a href="/app" style="${b}">⚙️ หลังบ้าน <span id="pfPend" hidden style="background:#e3a21a;color:#2a1b00;border-radius:999px;padding:0 7px"></span></a>` : '') +
      `<button type="button" id="pfOut" style="${b};background:#fff;color:#11241a;border:1px solid #d5ddd8" title="${ME.name} · ${ME.roleLabel || ''}">ออกจากระบบ</button>`;
    document.body.append(el);
    el.querySelector('#pfOut').onclick = async () => { await api('POST', 'logout'); location.replace('/'); };
    if (ME.group === 'farm') { const upd = () => api('GET', 'admin/stats').then(r => { const n = r.pending; const x = document.getElementById('pfPend'); x.hidden = !n; x.textContent = n; }).catch(() => { }); upd(); setInterval(upd, 60000); }
  }
  ready.then(() => { if (document.body) osMenu(); else addEventListener('DOMContentLoaded', osMenu); }).catch(() => { });
  window.__PF_READY = ready;
  window.claude = { use: async name => { await ready; if (!caps[name]) throw Object.assign(new Error('not available'), { code: 'unavailable' }); return caps[name]; } };
})();
