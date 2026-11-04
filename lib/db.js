// Database access. Production: DATABASE_URL (Supabase / Neon / any Postgres) via the `postgres` package.
// Local tests: LOCAL_PG=postgres://postgres@127.0.0.1/farm uses the tiny built-in client.
import { SCHEMA } from './schema.js';
let impl = null, schemaReady = null;
async function getImpl() {
  if (impl) return impl;
  if (process.env.LOCAL_PG) {
    const { miniPg } = await import('./minipg.js');
    impl = miniPg(process.env.LOCAL_PG);
  } else {
    let url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw Object.assign(new Error('ยังไม่ได้ต่อฐานข้อมูล (DATABASE_URL) ใน Vercel'), { status: 500 });
    // Neon/Supabase URLs carry libpq-only options that the server would reject as settings
    const u = new URL(url); ['sslmode', 'channel_binding', 'pgbouncer', 'connection_limit'].forEach(k => u.searchParams.delete(k)); url = u.toString();
    const postgres = (await import('postgres')).default;
    const sql = postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15, ssl: process.env.PGSSL === 'disable' ? false : 'require' });
    // postgres.js learns each parameter's type from the server and encodes JSON itself, so objects pass through untouched
    impl = { query: (t, p = []) => sql.unsafe(t, p) };
  }
  return impl;
}
export async function raw(text, params = []) { return (await getImpl()).query(text, params); }
export async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => { for (const st of SCHEMA.split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) await raw(st); })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}
export async function q(text, params = []) { await ensureSchema(); return raw(text, params); }
export async function one(text, params = []) { const r = await q(text, params); return r[0] || null; }
