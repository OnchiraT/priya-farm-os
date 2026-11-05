/* Executive overview, laid out after the owner-approved LFOS first page:
   picture tiles → weekly standard-vs-house chart → Hen-day / Hen-house tables → pullets → farm map with a house panel.
   Every label, number and note uses one large size (--xl). Uses the dashboard's globals (records, hdoc, stdFor …). */
(function () {
  // the dashboard's own data and helpers, handed in on every render (they live inside its closure)
  let C = {}, A = {};
  let records,health,stock,SIZES,hdoc,stdFor,stdAt,houseAgeOn,LAYERS,PULLETS,n0,n1,shortD,esc,eggWeightOf,pulletWeighHTML,goodEggsOf,bwStats,weighsOf,days;
  const bind = c => ({ records,health,stock,SIZES,hdoc,stdFor,stdAt,houseAgeOn,LAYERS,PULLETS,n0,n1,shortD,esc,eggWeightOf,pulletWeighHTML,goodEggsOf,bwStats,weighsOf,days } = c);
  const WEEKLY = {};            // weekly/h{n} docs: whole-flock history from the house's own Excel
  let chartHouse = null, sel = null, last = null; const HID = new Set();
  const OPEN = { lay: true, pul: true }; try { Object.assign(OPEN, JSON.parse(localStorage.getItem('pf-zone-open') || '{}')); } catch (e) { }

  // ---------- small helpers ----------
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : 0; };
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
  const fx = (v, d = 1) => v == null || !isFinite(v) ? '–' : n1(v, d);
  const latestRec = (h, D) => records.filter(r => r.house === h && r.date <= D).sort((a, b) => a.date < b.date ? 1 : -1)[0] || null;
  const weekOf = (h, D) => { const a = houseAgeOn(h, D); return a == null ? null : Math.floor(a / 7); };
  // breed standard for one house on one day: the farm's own Excel standard for Lohmann birds, else the published table
  // breed standard for one house on one day, from the breed's standard table (หลังบ้าน → มาตรฐานและข้อมูลอ้างอิง)
  function stdOf(h, D) {
    const s = stdFor(h, D); if (!s) return null;
    return { hd: s.hd, hh: s.surv != null ? s.hd * s.surv / 100 : null, ew: s.ew, week: s.week };
  }
  const cls = (a, b) => a == null || b == null ? '' : a - b >= -A.stdNear ? 'up' : a - b >= -A.stdWarn ? 'mid' : 'down';
  const dif = (a, b) => a == null || b == null ? '–' : `<span class="${cls(a, b)}">${a - b >= 0 ? '+' : '−'}${n1(Math.abs(a - b))}</span>`;

  // ---------- pictures ----------
  const HEN = `<svg viewBox="0 0 140 140" class="pic" aria-hidden="true"><path d="M22 70c-10-18-6-40 6-50 4 14 10 22 20 26" fill="#7a3d1c"/><path d="M16 64c-2-16 6-30 14-34 0 12 6 22 14 26" fill="#9a5226"/>
    <ellipse cx="70" cy="82" rx="46" ry="38" fill="#b0622b"/><path d="M40 80c10 14 34 22 54 14-6 14-30 20-46 10" fill="#8a4a20"/>
    <circle cx="100" cy="46" r="20" fill="#b0622b"/><path d="M92 26c2-8 8-10 10-4 3-7 10-6 10 1 6-3 10 3 5 8z" fill="#d6332a"/>
    <path d="M118 46l14 5-14 5z" fill="#f2b233"/><path d="M110 60c4 6 2 12-3 12-4 0-5-6-2-12z" fill="#d6332a"/><circle cx="106" cy="42" r="3.6" fill="#1a1a1a"/>
    <path d="M58 118v14M80 118v14M52 132h12M74 132h12" stroke="#f2b233" stroke-width="5" stroke-linecap="round"/></svg>`;
  const CHICK = `<svg viewBox="0 0 140 140" class="pic sm" aria-hidden="true"><ellipse cx="66" cy="92" rx="36" ry="30" fill="#f7cf3d"/><circle cx="86" cy="56" r="22" fill="#f9d851"/>
    <path d="M106 56l14 5-14 5z" fill="#ef8a1f"/><circle cx="92" cy="51" r="3.4" fill="#1a1a1a"/><path d="M44 88c8 10 22 12 32 6-4 10-22 12-32 4z" fill="#e8b92b"/>
    <path d="M80 34c0-8 6-10 8-4 2-6 8-4 6 2" fill="none" stroke="#e8b92b" stroke-width="4" stroke-linecap="round"/>
    <path d="M56 120v10M76 120v10M50 130h12M70 130h12" stroke="#ef8a1f" stroke-width="5" stroke-linecap="round"/></svg>`;
  const EGG = `<svg viewBox="0 0 140 140" class="pic" aria-hidden="true"><ellipse cx="54" cy="80" rx="30" ry="40" fill="#e7c49a"/><ellipse cx="92" cy="88" rx="30" ry="40" fill="#f1d7b4"/>
    <ellipse cx="82" cy="70" rx="7" ry="12" fill="#fff" opacity=".55"/><ellipse cx="44" cy="62" rx="6" ry="10" fill="#fff" opacity=".45"/></svg>`;

  // ---------- weekly series for the chart ----------
  function weekly(h) {
    const H = hdoc(h); const out = {};
    const ex = WEEKLY['h' + h]; if (ex && ex.rows) ex.rows.forEach(r => out[r.w] = Object.assign({}, r));
    if (H.hatch) {
      const rs = records.filter(r => r.house === h && (r.calc || {}).birds).sort((a, b) => a.date < b.date ? -1 : 1);
      const g = {}; rs.forEach(r => { const w = Math.floor(days(H.hatch, r.date) / 7); (g[w] = g[w] || []).push(r); });
      const housed = num(H.birdsIn) || null;
      const fromStart = housed && rs.length && H.placed && days(H.placed, rs[0].date) <= 7; let cum = 0;
      Object.keys(g).map(Number).sort((a, b) => a - b).forEach(w => {
        const L = g[w], o = out[w] = out[w] || { w };
        const eggs = sum(L, goodEggsOf), birds = sum(L, r => r.calc.birds);
        if (o.lay == null && birds) o.lay = eggs / birds * 100;
        const fe = L.map(r => r.calc.feedPer).filter(x => x > 0); if (o.feed == null && fe.length) o.feed = fe.reduce((a, b) => a + b, 0) / fe.length;
        const ew = L.map(eggWeightOf).filter(Boolean); if (o.ew == null && ew.length) o.ew = ew.reduce((a, e) => a + e.g, 0) / ew.length;
        if (o.surv == null && housed) o.surv = L[L.length - 1].calc.birds / housed * 100;
        cum += eggs; if (o.cum == null && fromStart) o.cum = cum / housed;
      });
    }
    // standards: the farm's Excel standard for Lohmann birds, the published table for the rest
    for (let w = 16; w <= 100; w++) {
      const o = out[w] = out[w] || { w }; const t = stdAt(H.breed, w * 7); if (!t) continue;
      if (o.layStd == null) o.layStd = t.hd; if (o.ewStd == null && t.ew != null) o.ewStd = t.ew; if (o.survStd == null && t.surv != null) o.survStd = t.surv; if (o.cumStd == null && t.cum != null) o.cumStd = t.cum;
    }
    // vaccine, medicine and vitamin notes from the health log
    health.filter(e => e.house === h && (e.type === 'vac' || e.type === 'med') && H.hatch).forEach(e => {
      const w = Math.floor(days(H.hatch, e.date) / 7); const o = out[w] = out[w] || { w };
      const vit = /วิตามิน|vitamin|อิเล็กโทรไลต์/i.test(e.name || '');
      const k = e.type === 'vac' ? 'vac' : vit ? 'vit' : 'med'; (o[k] = o[k] || []).push(e.name || '');
    });
    return out;
  }
  const chartable = () => LAYERS.filter(h => hdoc(h).hatch && (WEEKLY['h' + h] || records.some(r => r.house === h)));

  function drawChart() {
    const host = document.getElementById('xoChart'); if (!host) return;
    const list = chartable(); if (!list.length) { host.innerHTML = '<div class="xo-empty">ยังไม่มีเล้าที่มีข้อมูลพอทำกราฟ</div>'; return; }
    // default: the house with the longest history
    if (!list.includes(chartHouse)) chartHouse = list.slice().sort((a, b) => ((WEEKLY['h' + b] || {}).rows || []).length - ((WEEKLY['h' + a] || {}).rows || []).length || records.filter(r => r.house === b).length - records.filter(r => r.house === a).length)[0];
    document.querySelectorAll('#xoHouses button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.h === chartHouse)));
    const S = weekly(chartHouse); const W = []; for (let w = 16; w <= 100; w++) W.push(w);
    const g = k => W.map(w => S[w] && S[w][k] != null ? Math.round(S[w][k] * 100) / 100 : null);
    const mark = k => W.map(w => S[w] && S[w][k] ? 4 : null);
    const ff = getComputedStyle(document.body).fontFamily; const fs = innerWidth < 640 ? 22 : Math.round(Math.min(36, Math.max(24, innerWidth * 0.024)));
    const ln = (label, data, color, dash, axis, extra) => Object.assign({ label, data, borderColor: color, backgroundColor: color, borderWidth: dash ? 3 : 4, borderDash: dash ? [10, 7] : [], pointRadius: 0, pointHoverRadius: 6, spanGaps: true, tension: .25, yAxisID: axis || 'y' }, extra || {});
    const pt = (label, data, color, style) => ({ type: 'line', label, data, showLine: false, pointStyle: style, pointRadius: 11, pointHoverRadius: 13, borderColor: color, backgroundColor: color, yAxisID: 'y' });
    const ds = [
      ln('%เลี้ยงรอด มาตรฐาน', g('survStd'), '#2f8a5b', true), ln('%เลี้ยงรอด', g('surv'), '#2f8a5b'),
      ln('%ไข่ มาตรฐาน', g('layStd'), '#d97a12', true), ln('%ไข่', g('lay'), '#d97a12'),
      ln('น้ำหนักไข่ มาตรฐาน (กรัม)', g('ewStd'), '#8a4a20', true), ln('น้ำหนักไข่ (กรัม)', g('ew'), '#8a4a20'),
      ln('ไข่สะสมต่อแม่ มาตรฐาน (ฟอง)', g('cumStd'), '#2c6fb5', true, 'y2'), ln('ไข่สะสมต่อแม่ (ฟอง)', g('cum'), '#2c6fb5', false, 'y2'),
      ln('อาหาร (กรัม/ตัว/วัน)', g('feed'), '#7b4fb0', false, 'y2'),
      pt('ให้วัคซีน', mark('vac'), '#c2362b', 'triangle'), pt('ให้ยา', mark('med'), '#17231d', 'rectRot'), pt('ให้วิตามิน', mark('vit'), '#e3a21a', 'circle'),
    ];
    const leg = document.getElementById('xoLeg');
    if (leg) leg.innerHTML = ds.map((d, i) => `<button type="button" data-i="${i}" aria-pressed="${!HID.has(i)}"><i class="${d.showLine === false ? 'pt' : d.borderDash.length ? 'dash' : 'line'}" style="--c:${d.borderColor}"></i>${d.label}</button>`).join('');
    ds.forEach((d, i) => { d.hidden = HID.has(i); });
    const cv = document.getElementById('xoCv'); if (!cv || !window.Chart) { host.querySelector('.cbig').innerHTML = '<div class="xo-empty">โหลดกราฟไม่ได้ในตอนนี้</div>'; return; }
    if (cv._c) cv._c.destroy();
    const tick = { font: { size: fs - 4, weight: '700', family: ff }, color: '#4c5a52' };
    cv._c = new Chart(cv, {
      type: 'line', data: { labels: W.map(String), datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { titleFont: { size: fs - 6 }, bodyFont: { size: fs - 8 }, callbacks: { title: it => 'อายุ ' + it[0].label + ' สัปดาห์', label: c => { const w = W[c.dataIndex]; const k = { 9: 'vac', 10: 'med', 11: 'vit' }[c.datasetIndex]; if (k) return c.dataset.label + ': ' + ((S[w] || {})[k] || []).join(', '); return c.dataset.label + ': ' + n1(c.parsed.y); } } },
        },
        scales: {
          x: { title: { display: true, text: 'อายุไก่ (สัปดาห์)', font: tick.font, color: '#17231d' }, ticks: Object.assign({ autoSkip: true, maxTicksLimit: innerWidth < 640 ? 7 : 18, maxRotation: 0 }, tick), grid: { color: '#eef1ef' } },
          y: { min: 0, max: 120, title: { display: innerWidth >= 640, text: '% และ กรัม/ฟอง', font: tick.font, color: '#17231d' }, ticks: Object.assign({ stepSize: 20 }, tick), grid: { color: '#e3e8e5' } },
          y2: { position: 'right', min: 0, max: 500, title: { display: innerWidth >= 640, text: 'ฟอง/แม่ และ กรัมอาหาร', font: tick.font, color: '#17231d' }, ticks: Object.assign({ stepSize: 100 }, tick), grid: { drawOnChartArea: false } },
        },
      },
    });
    const H = hdoc(chartHouse); const ex = WEEKLY['h' + chartHouse];
    document.getElementById('xoChartNote').innerHTML = `เล้า ${chartHouse} ${esc(H.breed || 'ไม่ระบุสายพันธุ์')} ${ex ? 'ข้อมูลรายสัปดาห์จากไฟล์ Excel ของเล้า' : 'คำนวณจากใบบันทึกรายวัน'} เส้นประคือมาตรฐาน เส้นทึบคือเล้าของเรา กดชื่อเส้นด้านล่างเพื่อซ่อนหรือแสดง`;
  }

  // ---------- farm map ----------
  function houseState(h, D) {
    const H = hdoc(h); const r = latestRec(h, D); const pul = PULLETS.includes(h);
    if (H.depop) return { k: 'depop', t: 'กำลังปลดไก่', r };
    if (!(num(H.birds) > 0) && !r) return { k: 'empty', t: pul ? 'ยังไม่มีไก่เล็ก' : 'ยังไม่มีไก่', r };
    if (!r || r.date !== D) return { k: 'late', t: r ? 'ใบล่าสุด ' + shortD(r.date) : 'ยังไม่มีใบบันทึก', r };
    if (pul) return { k: 'ok', t: 'ปกติ', r };
    const s = stdOf(h, D), p = (r.calc || {}).pct; const c = cls(p, s && s.hd);
    return { k: c === 'down' ? 'bad' : c === 'mid' ? 'warn' : 'ok', t: c === 'down' ? 'ต่ำกว่ามาตรฐานมาก' : c === 'mid' ? 'ต่ำกว่ามาตรฐานเล็กน้อย' : 'ตามมาตรฐาน', r };
  }
  const DOT = { ok: '#2f8a5b', warn: '#e3a21a', bad: '#c2362b', late: '#9aa6a0', depop: '#7b4fb0', empty: 'none' };
  // houses are placed from the saved houses: pullets two to a row in the pullet zone, layers one per row with the
  // in-farm pond and Stock room in the middle; a house's mapOrder (set in ตั้งค่าฟาร์ม) overrides the default order
  function layoutMap() {
    const ord = h => { const o = hdoc(h).mapOrder; return o == null || o === '' ? null : +o; };
    const sortBy = (list, desc) => list.slice().sort((a, b) => { const oa = ord(a), ob = ord(b); if (oa != null && ob != null) return oa - ob; if (oa != null) return -1; if (ob != null) return 1; return desc ? b - a : a - b; });
    const M = C.map || {}, top = M.top || [], H = 78, G = 10, X = 170, W = 540;
    let y = 44; const bands = top.map((t, i) => { const b = { t, y, water: i === 0 && /บ่อ|น้ำ/.test(t) }; y += 78; return b; });
    const slots = []; const pz = { y0: y - 6 };
    const pl = sortBy(PULLETS, false);
    for (let i = 0; i < pl.length; i += 2) {
      if (i + 1 < pl.length) { slots.push({ s: pl[i], x: X, y: y + 6, w: (W - G) / 2 }, { s: pl[i + 1], x: X + (W + G) / 2, y: y + 6, w: (W - G) / 2 }); }
      else slots.push({ s: pl[i], x: X, y: y + 6, w: W });
      y += H + G;
    }
    pz.y1 = y + 4; y += pl.length ? 24 : 0;
    const lz = { y0: y - 4 }; const ll = sortBy(LAYERS, true); const mid = Math.floor(ll.length / 2); let midY = null;
    ll.forEach((h, i) => { if (i === mid && M.showStock !== false) { midY = y + 10; y += 124; } slots.push({ s: h, x: X, y: y + 10, w: W }); y += H + G; });
    if (midY == null && M.showStock !== false) { midY = y + 10; y += 124; }
    lz.y1 = y + 14;
    return { bands, slots, pz: pl.length ? pz : null, lz: ll.length ? lz : null, midY, MH: y + 110 };
  }
  function mapSVG(D) {
    const L = layoutMap(), M = C.map || {}, MH = L.MH;
    const VB = innerWidth < 640 ? `92 20 724 ${MH - 40}` : `0 0 1000 ${MH}`;
    let g = `<svg viewBox="${VB}" class="xo-map" role="img" aria-label="ผังฟาร์มและสถานะของแต่ละเล้า"><defs><pattern id="xwv" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#cfe3ef"/><path d="M0 8 Q4 5 8 8 T16 8" stroke="#fff" stroke-opacity=".5" fill="none" stroke-width="1.5"/></pattern><pattern id="xdp" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="#e9e4f3"/><path d="M0 0V14" stroke="#b9a9d9" stroke-width="5"/></pattern></defs>`;
    g += `<rect width="1000" height="${MH}" rx="28" fill="url(#xwv)"/><rect x="90" y="24" width="720" height="${MH - 48}" rx="22" fill="#eef3e6" stroke="#d6d2c4" stroke-width="16"/>`;
    g += `<rect x="742" y="40" width="44" height="${MH - 110}" fill="#d6d2c4"/><rect x="905" y="0" width="70" height="${MH}" fill="#d6d2c4"/>`;
    const side = (x, t, cls) => t ? `<text x="${x}" y="${MH / 2}" class="${cls}" transform="rotate(-90 ${x} ${MH / 2})">${esc(t)}</text>` : '';
    g += side(940, M.road, 'm-t') + side(48, M.left, 'm-m') + side(858, M.right, 'm-m');
    L.bands.forEach(b => { g += b.water ? `<rect x="170" y="${b.y}" width="540" height="62" rx="8" fill="url(#xwv)" stroke="#e3a21a" stroke-width="4" stroke-dasharray="12 8"/><text x="440" y="${b.y + 43}" class="m-t">${esc(b.t)}</text>` : `<rect x="200" y="${b.y}" width="480" height="62" rx="8" fill="#5ba34a"/><text x="440" y="${b.y + 43}" class="m-t" fill="#fff">${esc(b.t)}</text>`; });
    const zone = (z, col, label, ink) => { if (!z) return ''; const hgt = z.y1 - z.y0, tag = Math.min(170, hgt - 20), ty = z.y0 + (hgt - tag) / 2; return `<rect x="156" y="${z.y0}" width="568" height="${hgt}" rx="12" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="14 8"/><rect x="100" y="${ty}" width="48" height="${tag}" rx="8" fill="${col}"/><text x="132" y="${ty + tag / 2}" class="m-z" fill="${ink}" transform="rotate(-90 132 ${ty + tag / 2})">${label}</text>`; };
    g += zone(L.pz, '#c2362b', 'ไก่เล็ก', '#fff') + zone(L.lz, '#e3a21a', 'ไก่ไข่', '#2a1b00');
    if (L.midY != null) {
      g += `<rect x="172" y="${L.midY + 6}" width="262" height="104" rx="44" fill="url(#xwv)"/><text x="303" y="${L.midY + 68}" class="m-m">${esc(M.pond || '')}</text>`;
      g += `<g class="xo-hs" role="button" tabindex="0" data-h="stock" aria-label="ห้อง Stock"><rect x="452" y="${L.midY}" width="258" height="116" rx="10" fill="#fff" stroke="${sel === 'stock' ? '#17231d' : '#2f6fd6'}" stroke-width="${sel === 'stock' ? 6 : 4}"/><text x="581" y="${L.midY + 50}" class="m-h" fill="#173b8c">Stock</text><text x="581" y="${L.midY + 94}" class="m-s">ห้องเก็บไข่</text></g>`;
    }
    g += `<rect x="786" y="${MH - 104}" width="119" height="34" fill="#d6d2c4"/>${M.gate ? `<rect x="600" y="${MH - 66}" width="140" height="50" rx="8" fill="#fff" stroke="#7a8f2c" stroke-width="3"/><text x="670" y="${MH - 31}" class="m-m" fill="#55661c">${esc(M.gate)}</text>` : ''}${M.entrance ? `<text x="845" y="${MH - 40}" class="m-m">${esc(M.entrance)}</text>` : ''}`;
    L.slots.forEach(sl => {
      const h = sl.s, H = hdoc(h), s = houseState(h, D), pul = PULLETS.includes(h), r = s.r, Hh = 78, on = sel === h;
      const fill = s.k === 'empty' ? 'none' : s.k === 'depop' ? 'url(#xdp)' : pul ? '#f7d3cc' : '#f8dc98';
      const half = sl.w < 400;
      const val = !r ? '' : pul ? n0((r.calc || {}).birds || num(r.f && r.f.birds)) + ' ตัว' : (r.calc || {}).pct != null ? n1(r.calc.pct) + '%' : '';
      const right = s.k === 'depop' ? 'ปลดไก่' : s.k === 'empty' ? s.t : half ? '' : val;
      g += `<g class="xo-hs" role="button" tabindex="0" data-h="${h}" aria-label="เล้า ${h} ${s.t}"><rect x="${sl.x}" y="${sl.y}" width="${sl.w}" height="${Hh}" rx="10" fill="${fill}" stroke="${on ? '#17231d' : s.k === 'empty' ? '#8c978f' : 'rgba(0,0,0,.25)'}" stroke-width="${on ? 6 : 2}" ${s.k === 'empty' ? 'stroke-dasharray="8 6"' : ''}/>`
        + `<text x="${sl.x + 18}" y="${sl.y + 54}" class="m-h ts">เล้า ${h}</text>`
        + (right ? `<text x="${sl.x + sl.w - (DOT[s.k] !== 'none' ? 56 : 18)}" y="${sl.y + 54}" class="m-v te">${right}</text>` : '')
        + (DOT[s.k] !== 'none' ? `<circle cx="${sl.x + sl.w - 28}" cy="${sl.y + 39}" r="15" fill="${DOT[s.k]}" stroke="#fff" stroke-width="3"/>` : '')
        + `</g>`;
    });
    return g + '</svg>';
  }
  function detailHTML(D) {
    if (sel == null) return '<div class="xo-empty">กดเล้าบนผังเพื่อดูรายละเอียดของเล้านั้น</div>';
    if (sel === 'stock') {
      const rows = SIZES && stock ? SIZES.filter(([k]) => stock[k] && stock[k].t > 0).map(([k, l]) => `<tr><td>${esc(l)}</td><td>${n0(stock[k].t)}</td><td>${stock[k].oldest ? shortD(stock[k].oldest) : '–'}</td></tr>`) : [];
      return `<h3 class="xo-dh">ห้อง Stock</h3>${rows.length ? `<div class="xtw"><table class="xtab"><thead><tr><th>ไข่</th><th>แผง</th><th>ล็อตเก่าสุด</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="xo-empty">ไม่มีไข่ค้างในห้อง</div>'}`;
    }
    const h = sel, H = hdoc(h), s = houseState(h, D), r = s.r, pul = PULLETS.includes(h), f = (r && r.f) || {}, c = (r && r.calc) || {};
    const age = houseAgeOn(h, D); const sd = stdOf(h, D);
    const t = (k, v, u, ex) => `<div class="xt"><span>${k}</span><b>${v}${u ? ` ${u}` : ''}</b>${ex ? `<em>${ex}</em>` : ''}</div>`;
    let tiles = [t('สถานะ', s.t), t('อายุ', age != null ? n1(age / 7) : '–', 'สัปดาห์'), t('สายพันธุ์', esc(H.breed || 'ไม่ระบุ'))];
    if (r) {
      const day = r.date === D ? '' : `จากใบวันที่ ${shortD(r.date)}`;
      tiles.push(t('ไก่', n0(c.birds || num(f.birds)), 'ตัว', day));
      if (!pul) {
        tiles.push(t('Hen-day', fx(c.pct), '%', sd ? `มาตรฐาน ${n1(sd.hd)}%` : 'ยังไม่มีมาตรฐาน'));
        if (c.hh != null) tiles.push(t('Hen-house', fx(c.hh), '%', sd && sd.hh ? `มาตรฐาน ${n1(sd.hh)}%` : ''));
        tiles.push(t('ไข่ดี', n0(goodEggsOf(r)), 'ฟอง'));
        const e = eggWeightOf(r); if (e) tiles.push(t('น้ำหนักไข่', n1(e.g), 'กรัม/ฟอง', sd && sd.ew ? `มาตรฐาน ${n1(sd.ew)}` : ''));
        if (c.waterPer) tiles.push(t('น้ำ', n0(c.waterPer), 'มล./ตัว'));
      }
      tiles.push(t('ไก่ตาย', n0(num(f.h_dead)), 'ตัว'), t('ไก่คัด', n0(num(f.h_culled)), 'ตัว'));
      if (!pul) tiles.push(t('ไก่จิก', n0(num(f.h_pecked)), 'ตัว'));
      tiles.push(t('อาหาร', n0(num(f.f_used)), 'กก.', c.feedPer ? `${n0(c.feedPer)} กรัม/ตัว` : f.g_bird ? `${n1(num(f.g_bird))} กรัม/ตัว${f.std ? ' (มาตรฐาน ' + esc(f.std) + ')' : ''}` : ''));
      if (pul) { const w = weighsOf(h).slice(-1)[0]; if (w && (w.weights || []).length) { const b = bwStats(w.weights.map(Number).filter(x => x > 0)); tiles.push(t('น้ำหนักตัวเฉลี่ย', n0(b.m), 'กรัม', `สม่ำเสมอ ${n1(b.uni)}% · ชั่ง ${shortD(w.date)}`)); } }
    }
    const hist = records.filter(x => x.house === h && x.date <= D).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 7);
    const tab = !pul && hist.length ? `<div class="xtw"><table class="xtab"><caption>7 ใบล่าสุด</caption><thead><tr><th>วันที่</th><th>Hen-day</th><th>ไข่ดี</th></tr></thead><tbody>${hist.map(x => `<tr><td>${shortD(x.date)}</td><td>${fx((x.calc || {}).pct)}%</td><td>${n0(goodEggsOf(x))}</td></tr>`).join('')}</tbody></table></div>` : '';
    const btn = !pul && chartable().includes(h) ? `<button type="button" class="xo-go" data-chart="${h}">ดูกราฟเทียบมาตรฐานของเล้า ${h}</button>` : '';
    return `<h3 class="xo-dh">เล้า ${h} · ${pul ? 'ไก่เล็ก' : 'ไก่ไข่'}</h3><div class="xo-dg">${tiles.join('')}</div>${btn}${tab}`;
  }
  function paintMap(D) { const m = document.getElementById('xoMap'), d = document.getElementById('xoDetail'); if (m) m.innerHTML = mapSVG(D); if (d) d.innerHTML = detailHTML(D); }

  // ---------- main render ----------
  function render(D, cur, pv, ctx) {
    if (ctx) { bind(ctx); C = ctx.cfg || C; A = C.alerts || {}; }
    const el = document.getElementById('execBento'); if (!el) return; last = { D, cur, pv };
    const rs = records.filter(r => r.date === D), lay = rs.filter(r => LAYERS.includes(r.house));
    const layNow = LAYERS.filter(h => !hdoc(h).status || hdoc(h).status === 'active').map(h => ({ h, r: latestRec(h, D) })).filter(x => x.r || num(hdoc(x.h).birds) > 0);
    const henLeft = sum(layNow, x => x.r ? ((x.r.calc || {}).birds || num(x.r.f && x.r.f.birds)) : num(hdoc(x.h).birds));
    const pulNow = PULLETS.map(h => ({ h, r: latestRec(h, D) })).filter(x => x.r || num(hdoc(x.h).birds) > 0);
    const pulLeft = sum(pulNow, x => x.r ? ((x.r.calc || {}).birds || num(x.r.f && x.r.f.birds)) : num(hdoc(x.h).birds));
    const pulRs = pulNow.map(x => x.r).filter(Boolean);
    // farm standard, weighted by birds
    let tb = 0, wb = 0, th = 0, hb = 0;
    lay.forEach(r => { const b = (r.calc || {}).birds || 0, s = stdOf(r.house, D); if (s && b) { tb += s.hd * b; wb += b; const hs = (r.calc || {}).housed || num(r.f && r.f.housed); if (hs && s.hh) { th += s.hh * hs; hb += hs; } } });
    const stdHd = wb ? tb / wb : null, stdHh = hb ? th / hb : null;
    const fl = lay.filter(r => num(r.f && r.f.f_used) && (r.calc || {}).birds), wl = lay.filter(r => num(r.f && r.f.w_used) && (r.calc || {}).birds);
    const feedKg = sum(fl, r => num(r.f.f_used)), feedPer = fl.length ? feedKg * 1000 / sum(fl, r => r.calc.birds) : null;
    const eggsFl = sum(fl, goodEggsOf), perDozen = eggsFl ? feedKg / (eggsFl / 12) : null;
    const waterPer = wl.length ? sum(wl, r => num(r.f.w_used)) * 1000 / sum(wl, r => r.calc.birds) : null;
    const pFeed = sum(pulRs, r => num(r.f && r.f.f_used)), pBirds = sum(pulRs.filter(r => num(r.f && r.f.f_used)), r => (r.calc || {}).birds || num(r.f && r.f.birds));
    const ew = lay.map(r => ({ r, e: eggWeightOf(r) })).filter(x => x.e); const eggW = ew.length ? ew.reduce((a, x) => a + x.e.g * (goodEggsOf(x.r) || 1), 0) / ew.reduce((a, x) => a + (goodEggsOf(x.r) || 1), 0) : null;
    let ab = 0, aw = 0; lay.forEach(r => { const ag = houseAgeOn(r.house, D), b = (r.calc || {}).birds || 0; if (ag != null && b) { ab += ag / 7 * b; aw += b; } });
    const cnt = (list, k) => sum(list, r => num(r.f && r.f[k]));
    const pulD = pulRs.length ? pulRs.map(r => r.date).sort().pop() : null;
    const vs = (our, std) => our == null || std == null ? '' : `<em class="${cls(our, std)}">${our >= std ? 'สูงกว่า' : 'ต่ำกว่า'}มาตรฐาน ${n1(Math.abs(our - std))}</em>`;
    const delta = (a, b) => a == null || b == null ? '' : `<em class="${a - b >= 0 ? 'up' : 'down'}">${a - b >= 0 ? '▲' : '▼'} ${n1(Math.abs(a - b))} จากใบก่อน</em>`;
    const tile = (c, label, val, unit, ex) => `<div class="xt ${c || ''}"><span>${label}</span><b>${val}${unit ? ` <small>${unit}</small>` : ''}</b>${ex || ''}</div>`;
    const hero = (pic, label, val, unit, ex, c) => `<div class="xo-hero ${c || ''}">${pic}<div><span>${label}</span><b>${val} <small>${unit}</small></b>${ex ? `<em>${ex}</em>` : ''}</div></div>`;

    const EPC = C.eggsPerTray * C.traysPerCrate;
    const pulOf = k => sum(pulRs, r => num(r.f && r.f[k]));
    const pulStd = pulRs.map(r => r.f && r.f.std).filter(Boolean);
    const lastW = PULLETS.map(h => (weighsOf(h) || []).slice(-1)[0]).filter(w => w && (w.weights || []).length).sort((x, y) => x.date < y.date ? 1 : -1)[0];
    const bw = lastW ? bwStats(lastW.weights.map(Number).filter(x => x > 0)) : null;
    const pulAge = (() => { let s = 0, w = 0; pulNow.forEach(x => { const a = houseAgeOn(x.h, D), b = x.r ? ((x.r.calc || {}).birds || num(x.r.f && x.r.f.birds)) : num(hdoc(x.h).birds); if (a != null && b) { s += a / 7 * b; w += b; } }); return w ? s / w : null; })();
    const onDate = pulD && pulD !== D ? `<em>จากใบวันที่ ${shortD(pulD)}</em>` : '';
    const layTiles = [
      `<div class="xt t-egg wide">${EGG}<div><span>ไข่ดีวันนี้</span><b>${n0(cur.eggs)} <small>ฟอง</small></b><em>${n0(cur.eggs / EPC)} ลัง หรือ ${n0(cur.eggs / C.eggsPerTray)} แผง</em></div></div>`,
      tile('t-hd', 'Hen-day ของเรา', fx(cur.hd), '%', delta(cur.hd, pv && pv.hd)),
      tile('t-std', 'มาตรฐาน Hen-day', fx(stdHd), '%', vs(cur.hd, stdHd)),
      tile('t-hh', 'Hen-house ของเรา', fx(cur.hh), '%', delta(cur.hh, pv && pv.hh)),
      tile('t-std', 'มาตรฐาน Hen-house', fx(stdHh), '%', vs(cur.hh, stdHh)),
      tile('t-warn', 'ไก่ตาย', n0(cnt(lay, 'h_dead')), 'ตัว'),
      tile('t-warn', 'ไก่คัด', n0(cnt(lay, 'h_culled')), 'ตัว'),
      tile('t-warn', 'ไก่จิก', n0(cnt(lay, 'h_pecked')), 'ตัว'),
      tile('', 'ไข่แตก', n0(cnt(lay, 'd_cracked')), 'ฟอง'),
      tile('t-feed', 'อาหาร', feedKg ? n0(feedKg) : '–', 'กก.', feedPer ? `<em>${n0(feedPer)} กรัม/ตัว</em>` : ''),
      tile('', 'อาหารต่อไข่ 1 โหล', perDozen == null ? '–' : n1(perDozen, 2), 'กก.'),
      tile('', 'น้ำ', waterPer == null ? '–' : n0(waterPer), 'มล./ตัว'),
      tile('', 'น้ำหนักไข่เฉลี่ย', eggW == null ? '–' : n1(eggW), 'กรัม/ฟอง', ew.length ? `<em>จาก ${ew.length} เล้าที่ชั่ง</em>` : ''),
      tile('', 'อายุเฉลี่ย', aw ? n1(ab / aw) : '–', 'สัปดาห์'),
    ];
    const pulTilesTop = pulNow.length ? [
      tile('', 'อายุเฉลี่ย', pulAge == null ? '–' : n1(pulAge), 'สัปดาห์'),
      tile('t-warn', 'ไก่ตาย', n0(pulOf('h_dead')), 'ตัว', onDate),
      tile('t-warn', 'ไก่คัด', n0(pulOf('h_culled')), 'ตัว', onDate),
      tile('t-feed', 'อาหาร', pFeed ? n0(pFeed) : '–', 'กก.', pFeed && pBirds ? `<em>${n1(pFeed * 1000 / pBirds)} กรัม/ตัว${pulStd.length ? ' มาตรฐาน ' + esc(pulStd[0]) : ''}</em>` : ''),
      bw ? tile('', 'น้ำหนักตัวเฉลี่ย', n0(bw.m), 'กรัม', `<em>เล้า ${lastW.house} ชั่ง ${shortD(lastW.date)}</em>`) : '',
      bw ? tile(bw.uni >= 80 ? 't-hd' : 't-hh', 'ความสม่ำเสมอ', n1(bw.uni), '%', '<em>เป้าหมาย 80% ขึ้นไป</em>') : '',
    ] : [];
    // zone headers fold their section open/closed (remembered on this device)
    const band = (k, cls, pic, title, list, count) => `<header class="xo-band ${cls}"><button type="button" class="xo-tog" data-zone="${k}" aria-expanded="${OPEN[k]}" aria-controls="xoBody-${k}">${pic}<div><h2>${title}</h2><p>${list.length ? 'เล้า ' + list.join(', ') : 'ยังไม่มีเล้า'}</p></div><b>${n0(count)} <small>ตัว</small></b><svg class="xo-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>`;

    // Hen-day / Hen-house vs breed standard, one table each
    const rows = LAYERS.map(h => {
      const H = hdoc(h), r = rs.find(x => x.house === h), s = stdOf(h, D), a = houseAgeOn(h, D);
      if (!r) return { h, none: H.depop ? 'กำลังปลดไก่' : num(H.birds) > 0 ? 'ยังไม่ส่งใบวันนี้' : 'ยังไม่มีไก่' };
      const c = r.calc || {}; return { h, age: a != null ? n1(a / 7) : '–', hd: c.pct, hh: c.hh, sHd: s && s.hd, sHh: s && s.hh };
    });
    const tab = (cap, k, sk, foot) => `<div class="xtw"><table class="xtab"><caption>${cap}</caption><thead><tr><th>เล้า</th><th>อายุ (สป.)</th><th>ของเรา</th><th>มาตรฐาน</th><th>ต่าง</th></tr></thead><tbody>${rows.map(x => x.none ? `<tr class="none"><td>${x.h}</td><td colspan="4">${x.none}</td></tr>` : `<tr><td>${x.h}</td><td>${x.age}</td><td>${x[k] != null ? n1(x[k]) + '%' : '–'}</td><td>${x[sk] != null ? n1(x[sk]) + '%' : '–'}</td><td>${dif(x[k], x[sk])}</td></tr>`).join('')}</tbody><tfoot><tr><td>รวม</td><td>${aw ? n1(ab / aw) : '–'}</td><td>${foot[0] != null ? n1(foot[0]) + '%' : '–'}</td><td>${foot[1] != null ? n1(foot[1]) + '%' : '–'}</td><td>${dif(foot[0], foot[1])}</td></tr></tfoot></table></div>`;
    const above = rows.filter(x => !x.none && x.sHd != null && x.hd - x.sHd >= 0).length, within = rows.filter(x => !x.none && x.sHd != null && x.hd - x.sHd < 0 && x.hd - x.sHd >= -A.stdWarn).length, below = rows.filter(x => !x.none && x.sHd != null && x.hd - x.sHd < -A.stdWarn).length, nostd = rows.filter(x => !x.none && x.sHd == null).length;
    const sumTiles = `<div class="xgrid">${tile('t-hd', 'สูงกว่ามาตรฐาน', n0(above), 'เล้า')}${tile('t-hh', `ต่ำกว่าไม่เกิน ${A.stdWarn} จุด`, n0(within), 'เล้า')}${tile('t-warn', `ต่ำกว่าเกิน ${A.stdWarn} จุด`, n0(below), 'เล้า')}${tile('t-std', 'ยังไม่มีมาตรฐาน', n0(nostd), 'เล้า', nostd ? `<em>เล้า ${rows.filter(x => !x.none && x.sHd == null).map(x => x.h).join(', ')}</em>` : '')}</div>`;
    const ewRows = lay.map(r => ({ h: r.house, e: eggWeightOf(r), s: stdOf(r.house, D) })).filter(x => x.e).sort((a, b) => a.h - b.h);
    const ewTab = ewRows.length ? `<div class="xtw"><table class="xtab"><caption>น้ำหนักไข่จากใบชั่ง</caption><thead><tr><th>เล้า</th><th>ชั่ง (ลัง)</th><th>ต่อลัง (กก.)</th><th>ต่อฟอง (กรัม)</th><th>มาตรฐาน</th></tr></thead><tbody>${ewRows.map(x => `<tr><td>${x.h}</td><td>${x.e.n || '–'}</td><td>${x.e.crate ? x.e.crate.toFixed(2) : '–'}</td><td>${n1(x.e.g)}</td><td>${x.s && x.s.ew ? n1(x.s.ew) : '–'}</td></tr>`).join('')}</tbody></table></div><p class="xo-note">ต่อฟอง = (น้ำหนักลัง − แผงเปล่า ${n1(C.trayKg)} กก.) ÷ ${n0(C.eggsPerTray * C.traysPerCrate)} ฟอง</p>` : '';

    // pullets
    const pulTiles = PULLETS.map(h => {
      const H = hdoc(h), r = latestRec(h, D), a = houseAgeOn(h, D);
      if (!r && !(num(H.birds) > 0)) return `<div class="xo-pul none"><h4>${CHICK}เล้า ${h}</h4><p>ยังไม่มีไก่เล็ก</p></div>`;
      const f = (r && r.f) || {}; const b = r ? ((r.calc || {}).birds || num(f.birds)) : num(H.birds);
      return `<div class="xo-pul"><h4>${CHICK}เล้า ${h}</h4><dl><dt>ไก่</dt><dd>${n0(b)} ตัว</dd><dt>อายุ</dt><dd>${a != null ? n1(a / 7) : esc(f.age || '–')} สัปดาห์</dd>${r ? `<dt>ตาย / คัด</dt><dd>${n0(num(f.h_dead))} / ${n0(num(f.h_culled))} ตัว</dd><dt>อาหาร</dt><dd>${n0(num(f.f_used))} กก.</dd><dt>กรัมต่อตัว</dt><dd>${f.g_bird ? n1(num(f.g_bird)) : '–'}${f.std ? ' (มาตรฐาน ' + esc(f.std) + ')' : ''}</dd><dt>ใบล่าสุด</dt><dd>${shortD(r.date)}</dd>` : ''}</dl></div>`;
    }).join('');

    const houses = chartable();
    // keep things the dashboard renders into the zones (daily chart, house cards) across re-renders
    const henBox = document.querySelector('#vFOverview .henbox'); if (henBox && el.contains(henBox)) el.after(henBox);
    const keep = { lay: (document.getElementById('foHousesLay') || {}).innerHTML || '', pul: (document.getElementById('foHousesPul') || {}).innerHTML || '' };
    el.innerHTML = `<div class="xo-top"><h2>ภาพรวมฟาร์ม</h2><p>ข้อมูลวันที่ ${shortD(D)} มีใบบันทึก ${cur.n} เล้า ไก่ทั้งฟาร์ม ${n0(henLeft + pulLeft)} ตัว</p></div>
      <section class="xo-side s-lay" aria-label="ไก่ไข่">
        ${band('lay', 'b-lay', HEN, 'ไก่ไข่', layNow.map(x => x.h), henLeft)}
        <div class="xo-body" id="xoBody-lay" ${OPEN.lay ? '' : 'hidden'}>
        <div class="xgrid">${layTiles.join('')}</div>
        <section class="xo-panel" id="xoChart"><h3>เทียบมาตรฐานสายพันธุ์ รายสัปดาห์</h3>
          <div class="xo-seg" id="xoHouses">${houses.map(h => `<button type="button" data-h="${h}" aria-pressed="false">เล้า ${h}</button>`).join('')}</div>
          <div class="cbig"><canvas id="xoCv" role="img" aria-label="กราฟเส้นเทียบมาตรฐานกับเล้าที่เลือก รายสัปดาห์ตามอายุไก่"></canvas></div>
          <div class="xo-leg2" id="xoLeg"></div>
          <p class="xo-note" id="xoChartNote"></p></section>
        <section class="xo-panel"><h3>สรุป Hen-day และ Hen-house เทียบมาตรฐานสายพันธุ์</h3>${sumTiles}
          <div class="xtabs">${tab('Hen-day (ไก่ที่มีชีวิต)', 'hd', 'sHd', [cur.hd, stdHd])}${tab('Hen-house (ไก่ตั้งต้น)', 'hh', 'sHh', [cur.hh, stdHh])}</div>${ewTab}</section>
        <div id="xoDaily"></div>
        <section class="xo-panel"><h3>ไก่ไข่รายเล้า</h3><div class="hgrid xo-cards" id="foHousesLay"></div></section>
        </div>
      </section>
      <section class="xo-side s-pul" aria-label="ไก่เล็ก">
        ${band('pul', 'b-pul', CHICK, 'ไก่เล็ก–ไก่สาว', pulNow.map(x => x.h), pulLeft)}
        <div class="xo-body" id="xoBody-pul" ${OPEN.pul ? '' : 'hidden'}>
        ${pulTilesTop.length ? `<div class="xgrid">${pulTilesTop.join('')}</div>` : '<div class="xo-empty">ยังไม่มีไก่เล็กในฟาร์ม</div>'}
        <div class="xo-puls">${pulTiles}</div>${pulletWeighHTML()}
        <section class="xo-panel"><h3>ไก่เล็กรายเล้า</h3><div class="hgrid xo-cards" id="foHousesPul"></div></section>
        </div>
      </section>
      <section class="xo-mapwrap"><div class="xo-panel"><h2>ผังฟาร์ม</h2><p class="xo-note">กดที่เล้าเพื่อดูรายละเอียด</p><div id="xoMap"></div>
        <div class="xo-leg"><span><i style="background:#2f8a5b"></i>ตามมาตรฐาน</span><span><i style="background:#e3a21a"></i>ต่ำกว่าเล็กน้อย</span><span><i style="background:#c2362b"></i>ต่ำกว่ามาก</span><span><i style="background:#9aa6a0"></i>ยังไม่ส่งใบวันนี้</span><span><i style="background:#7b4fb0"></i>ปลดไก่</span></div></div>
        <div class="xo-panel" id="xoDetail"></div></section>`;
    if (henBox) { henBox.classList.add('xo-panel'); document.getElementById('xoDaily').replaceWith(henBox); }
    document.getElementById('foHousesLay').innerHTML = keep.lay; document.getElementById('foHousesPul').innerHTML = keep.pul;
    paintMap(D); drawChart();
    // phones: open the sideways-scrolling weight chart on the average, not on the empty left edge
    el.querySelectorAll('.xo-scroll').forEach(b => { const m = b.querySelector('.mline'), sv = b.querySelector('svg'); if (!m || !sv || b.scrollWidth <= b.clientWidth) return; const vb = sv.viewBox.baseVal; b.scrollLeft = (+m.getAttribute('x1') - vb.x) / vb.width * b.scrollWidth - b.clientWidth / 2; });
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('#xoHouses button'); if (b) { chartHouse = +b.dataset.h; drawChart(); return; }
    const tg = e.target.closest('.xo-tog'); if (tg) {
      const k = tg.dataset.zone; OPEN[k] = !OPEN[k]; tg.setAttribute('aria-expanded', String(OPEN[k])); const body = document.getElementById('xoBody-' + k); if (body) body.hidden = !OPEN[k];
      try { localStorage.setItem('pf-zone-open', JSON.stringify(OPEN)); } catch (er) { }
      if (OPEN[k]) { if (k === 'lay') drawChart(); (body || document).querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart && Chart.getChart(c); if (ch) ch.resize(); }); }
      else tg.closest('.xo-side').scrollIntoView({ block: 'nearest' });
      return; }
    const lg = e.target.closest('#xoLeg button'); if (lg) { const i = +lg.dataset.i, c = (document.getElementById('xoCv') || {})._c; if (HID.has(i)) HID.delete(i); else HID.add(i); lg.setAttribute('aria-pressed', String(!HID.has(i))); if (c) { c.setDatasetVisibility(i, !HID.has(i)); c.update(); } return; }
    const g = e.target.closest('#xoMap .xo-hs'); if (g && last) { const v = g.dataset.h; sel = v === 'stock' ? 'stock' : +v; paintMap(last.D); if (innerWidth < 1000) document.getElementById('xoDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const c = e.target.closest('.xo-go'); if (c) { chartHouse = +c.dataset.chart; drawChart(); document.getElementById('xoChart').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#xoMap .xo-hs')) { e.preventDefault(); e.target.closest('.xo-hs').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (document.getElementById('xoCv')) drawChart(); if (last) paintMap(last.D); }, 250); });

  // weekly history docs
  (async () => {
    try {
      const db = await window.claude.use('db');
      db.collection('weekly').onSnapshot(s => { s.docs.forEach(d => WEEKLY[d.id] = d.data()); if (last && records) render(last.D, last.cur, last.pv); });
    } catch (e) { }
  })();
  window.PFX = { render, weekly, WEEKLY };
})();
