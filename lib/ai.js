// AI routing: every feature picks its own provider / model / API key in Settings → AI.
import { getSetting, keyValue } from './settings.js';
import { q } from './db.js';
import { FARM } from './auth.js';
import fs from 'node:fs';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], vision: true },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', models: ['gpt-4.1', 'gpt-4.1-mini'], vision: true },
  gemini: { label: 'Google Gemini', kind: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], vision: true },
  typhoon: { label: 'Typhoon OCR (ไทย, เรียกผ่าน API)', kind: 'openai', base: 'https://api.opentyphoon.ai/v1', models: ['typhoon-ocr'], ocrOnly: true },
  datalab: { label: 'Datalab Chandra (เรียกผ่าน API)', kind: 'datalab', models: ['balanced', 'accurate', 'fast'], ocrOnly: true },
  vllm: { label: 'เซิร์ฟเวอร์ของเราเอง (vLLM / OpenAI-compatible) เช่น dots.mocr, Chandra, Typhoon', kind: 'openai', base: '', models: ['rednote-hilab/dots.mocr', 'datalab-to/chandra', 'typhoon-ai/typhoon-ocr1.5-2b'], vision: true, needsBase: true },
};
export const FEATURES = {
  classify: { label: 'แยกประเภทเอกสาร', hint: 'ดูรูปแล้วบอกว่าเป็นใบอะไร ต้องใช้โมเดลที่ดูรูปได้', needsVision: true, def: { provider: 'anthropic', model: 'claude-haiku-5-5' } },
  ocr: { label: 'อ่านตัวหนังสือจากรูป (OCR)', hint: 'ถอดข้อความทั้งหมดในรูปก่อน แล้วส่งต่อให้ขั้นแปลงข้อมูล เลือก "ไม่ใช้" ถ้าจะให้โมเดลขั้นถัดไปอ่านรูปเอง', ocr: true, optional: true, def: { provider: '' } },
  extract: { label: 'แปลงเป็นข้อมูลตามแบบฟอร์ม + ให้คะแนนความมั่นใจ', hint: 'รับรูป (และข้อความจาก OCR ถ้ามี) แล้วตอบเป็นช่องข้อมูลพร้อมความมั่นใจรายช่อง', needsVision: true, def: { provider: 'anthropic', model: 'claude-sonnet-5-5' } },
  verify: { label: 'อ่านซ้ำรอบที่ 2 เพื่อเทียบ', hint: 'ควรใช้คนละโมเดลกับขั้นแปลงข้อมูล ถ้าอ่านได้ไม่ตรงกัน ระบบจะถามคนก่อน เลือก "ไม่ใช้" เพื่อปิด', needsVision: true, optional: true, def: { provider: '' } },
  form_read: { label: 'ปุ่ม "อ่านจากรูป" ในฟอร์มบนเว็บ', hint: 'ใช้ตอนกรอกฟอร์มเองแล้วกดให้ AI ช่วยกรอก', needsVision: true, def: { provider: 'anthropic', model: 'claude-sonnet-5-5' } },
  translate: { label: 'แปลภาษาหน้าจอ (เขมร พม่า อังกฤษ)', hint: 'ใช้ตอนเปลี่ยนภาษาในแดชบอร์ด', def: { provider: 'anthropic', model: 'claude-haiku-5-5' } },
};
export async function featureConfig(feature) {
  const s = await getSetting('ai');
  return Object.assign({}, FEATURES[feature]?.def || {}, (s.features || {})[feature] || {});
}
const err = (m, code) => Object.assign(new Error(m), { code });
async function post(url, headers, body, ms = 55000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw err(`${r.status} ${text.slice(0, 300)}`, r.status === 429 ? 'rate_limited' : 'provider_error');
    return text;
  } finally { clearTimeout(t); }
}
const imgPart = {
  openai: i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }),
  anthropic: i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } }),
  gemini: i => ({ inline_data: { mime_type: i.mime, data: i.b64 } }),
};
function mockReply(feature, prompt) {
  const file = process.env.AI_MOCK; const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  let v = all[feature]; if (v && typeof v === 'object' && !Array.isArray(v) && v.__byPrompt) { const k = Object.keys(v).find(k => k !== '__byPrompt' && prompt.includes(k)); v = v[k || 'default']; }
  return typeof v === 'string' ? v : JSON.stringify(v ?? {});
}
// Send a prompt (+ images) to the configured chat/vision model. Returns text.
export async function chat(cfg, { system, prompt, images = [], json = false, maxTokens = 4096, feature = '' }) {
  if (process.env.AI_MOCK) return mockReply(feature, prompt);
  const P = PROVIDERS[cfg.provider]; if (!P) throw err('ยังไม่ได้เลือกผู้ให้บริการ AI สำหรับ ' + (FEATURES[feature]?.label || feature), 'not_configured');
  const key = await keyValue(cfg.keyId);
  if (!key && cfg.provider !== 'vllm') throw err(`ยังไม่ได้ใส่ API key สำหรับ ${FEATURES[feature]?.label || feature}`, 'not_configured');
  if (P.kind === 'openai') {
    const base = (cfg.baseUrl || P.base || '').replace(/\/$/, ''); if (!base) throw err('ยังไม่ได้ใส่ Base URL ของเซิร์ฟเวอร์', 'not_configured');
    const content = [{ type: 'text', text: prompt }, ...images.map(imgPart.openai)];
    const body = { model: cfg.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }], max_tokens: maxTokens, temperature: 0 };
    if (json && cfg.provider === 'openai') body.response_format = { type: 'json_object' };
    const t = await post(`${base}/chat/completions`, { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, JSON.stringify(body));
    return JSON.parse(t).choices?.[0]?.message?.content || '';
  }
  if (P.kind === 'anthropic') {
    const body = { model: cfg.model, max_tokens: maxTokens, temperature: 0, ...(system ? { system } : {}), messages: [{ role: 'user', content: [...images.map(imgPart.anthropic), { type: 'text', text: prompt }] }] };
    const t = await post('https://api.anthropic.com/v1/messages', { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, JSON.stringify(body));
    return (JSON.parse(t).content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  }
  if (P.kind === 'gemini') {
    const body = { contents: [{ role: 'user', parts: [...images.map(imgPart.gemini), { text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) };
    const t = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { 'content-type': 'application/json', 'x-goog-api-key': key }, JSON.stringify(body));
    return (JSON.parse(t).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  }
  throw err(P.label + ' ใช้ได้เฉพาะขั้น OCR', 'not_supported');
}
const OCR_PROMPT = 'Read this document image and return all of its text exactly as written, keeping the table layout as Markdown tables. Do not translate. Keep Thai text and handwritten digits exactly. Output only the text.';
// OCR: return plain text / markdown of an image.
export async function ocr(cfg, image) {
  if (process.env.AI_MOCK) return mockReply('ocr', '');
  const P = PROVIDERS[cfg.provider]; if (!P) throw err('ยังไม่ได้เลือก OCR', 'not_configured');
  if (P.kind === 'datalab') {
    const key = await keyValue(cfg.keyId); if (!key) throw err('ยังไม่ได้ใส่ API key ของ Datalab', 'not_configured');
    const fd = new FormData(); fd.append('file', new Blob([Buffer.from(image.b64, 'base64')], { type: image.mime }), 'page.' + (image.mime.split('/')[1] || 'jpg'));
    fd.append('output_format', 'markdown'); fd.append('mode', cfg.model || 'balanced');
    const r = await fetch('https://www.datalab.to/api/v1/convert', { method: 'POST', headers: { 'X-API-Key': key }, body: fd });
    const j = await r.json(); if (!r.ok || !j.request_check_url) throw err('Datalab: ' + JSON.stringify(j).slice(0, 300), 'provider_error');
    for (let i = 0; i < 25; i++) {
      await new Promise(s => setTimeout(s, 2000));
      const c = await (await fetch(j.request_check_url, { headers: { 'X-API-Key': key } })).json();
      if (c.status === 'complete') { if (c.success === false) throw err('Datalab: ' + (c.error || 'failed'), 'provider_error'); return c.markdown || ''; }
    }
    throw err('Datalab ใช้เวลานานเกินไป', 'timeout');
  }
  const text = await chat(cfg, { prompt: OCR_PROMPT, images: [image], feature: 'ocr', maxTokens: 8000 });
  try { const j = JSON.parse(text); if (j && typeof j.natural_text === 'string') return j.natural_text; } catch { }
  return text;
}
export function parseJson(text) {
  if (typeof text !== 'string') return text;
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { } }
  throw err('AI ตอบกลับมาไม่ใช่ JSON', 'bad_json');
}
export async function runFeature(feature, args) {
  const cfg = await featureConfig(feature); const t0 = Date.now();
  if (!cfg.provider) return null;
  try {
    const out = feature === 'ocr' ? await ocr(cfg, args.images[0]) : await chat(cfg, Object.assign({ feature }, args));
    q('insert into ai_calls(farm_id, feature, provider, model, ms, ok) values($1,$2,$3,$4,$5,true)', [FARM, feature, cfg.provider, cfg.model || '', Date.now() - t0]).catch(() => { });
    return out;
  } catch (e) {
    q('insert into ai_calls(farm_id, feature, provider, model, ms, ok, error) values($1,$2,$3,$4,$5,false,$6)', [FARM, feature, cfg.provider, cfg.model || '', Date.now() - t0, String(e.message).slice(0, 500)]).catch(() => { });
    throw e;
  }
}
