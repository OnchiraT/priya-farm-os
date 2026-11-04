import { q, one } from './db.js';
import { encrypt, decrypt, rid } from './crypto.js';
import { FARM } from './auth.js';
export async function getSetting(key, withSecret = false) {
  const r = await one('select value, secret from settings where farm_id=$1 and key=$2', [FARM, key]);
  const value = (r && r.value) || {};
  if (!withSecret) return value;
  let secret = {}; try { secret = r && r.secret ? JSON.parse(decrypt(r.secret)) : {}; } catch { secret = {}; }
  return { value, secret };
}
export async function setSetting(key, value, secretPatch) {
  const cur = await getSetting(key, true);
  const secret = Object.assign({}, cur.secret);
  if (secretPatch) for (const [k, v] of Object.entries(secretPatch)) { if (v === null) delete secret[k]; else if (v !== undefined && v !== '') secret[k] = v; }
  await q(`insert into settings(farm_id, key, value, secret) values($1,$2,$3::jsonb,$4)
    on conflict (farm_id, key) do update set value=excluded.value, secret=excluded.secret, updated_at=now()`,
    [FARM, key, value || {}, Object.keys(secret).length ? encrypt(JSON.stringify(secret)) : null]);
}
export async function listKeys() {
  return q('select id, name, provider, last4, created_at from api_keys where farm_id=$1 order by created_at', [FARM]);
}
export async function addKey(name, provider, value) {
  const id = 'k_' + rid(10);
  await q('insert into api_keys(id, farm_id, name, provider, secret, last4) values($1,$2,$3,$4,$5,$6)', [id, FARM, name, provider || null, encrypt(value), String(value).slice(-4)]);
  return id;
}
export async function delKey(id) { await q('delete from api_keys where farm_id=$1 and id=$2', [FARM, id]); }
export async function keyValue(id) {
  if (!id) return null; const r = await one('select secret from api_keys where farm_id=$1 and id=$2', [FARM, id]);
  return r ? decrypt(r.secret) : null;
}
