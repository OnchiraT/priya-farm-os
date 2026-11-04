// Tiny Postgres client used only for local development/tests (trust auth, simple query protocol).
// Production uses the `postgres` package (see lib/db.js).
import net from 'node:net';
const OID = { BOOL: 16, BYTEA: 17, INT8: 20, INT2: 21, INT4: 23, FLOAT4: 700, FLOAT8: 701, NUMERIC: 1700, JSON: 114, JSONB: 3802 };
export function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'::bytea`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
export function interpolate(text, params) {
  return text.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
}
function conv(oid, s) {
  if (s === null) return null;
  switch (oid) {
    case OID.BOOL: return s === 't';
    case OID.INT2: case OID.INT4: return parseInt(s, 10);
    case OID.INT8: { const n = Number(s); return Number.isSafeInteger(n) ? n : s; }
    case OID.FLOAT4: case OID.FLOAT8: case OID.NUMERIC: return parseFloat(s);
    case OID.JSON: case OID.JSONB: return JSON.parse(s);
    case OID.BYTEA: return Buffer.from(s.slice(2), 'hex');
    default: return s;
  }
}
export function miniPg(url) {
  const u = new URL(url);
  let sock, buf = Buffer.alloc(0), waiters = [], ready, chain = Promise.resolve();
  function msg(type, body) { const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4); return Buffer.concat([Buffer.from(type), len, body]); }
  function connect() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      sock = net.connect({ host: u.hostname, port: Number(u.port || 5432) });
      sock.on('error', reject);
      sock.on('connect', () => {
        const params = Buffer.from(`user\0${decodeURIComponent(u.username || 'postgres')}\0database\0${u.pathname.slice(1) || 'postgres'}\0\0`);
        const head = Buffer.alloc(8); head.writeInt32BE(params.length + 8); head.writeInt32BE(196608, 4);
        sock.write(Buffer.concat([head, params]));
      });
      let started = false;
      sock.on('data', d => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 5) {
          const type = String.fromCharCode(buf[0]); const len = buf.readInt32BE(1);
          if (buf.length < len + 1) break;
          const body = buf.subarray(5, len + 1); buf = buf.subarray(len + 1);
          if (!started) {
            if (type === 'R' && body.readInt32BE(0) !== 0) return reject(new Error('minipg: only trust auth supported'));
            if (type === 'E') return reject(new Error('minipg: ' + body.toString()));
            if (type === 'Z') { started = true; resolve(); }
            continue;
          }
          waiters[0] && waiters[0](type, body);
        }
      });
    });
    return ready;
  }
  function run(text) {
    return new Promise((resolve, reject) => {
      let fields = [], rows = [], err = null;
      waiters.push((type, body) => {
        if (type === 'T') {
          const n = body.readInt16BE(0); let o = 2; fields = [];
          for (let i = 0; i < n; i++) { const e = body.indexOf(0, o); const name = body.toString('utf8', o, e); o = e + 1; const oid = body.readInt32BE(o + 6); o += 18; fields.push({ name, oid }); }
        } else if (type === 'D') {
          const n = body.readInt16BE(0); let o = 2; const row = {};
          for (let i = 0; i < n; i++) { const l = body.readInt32BE(o); o += 4; if (l < 0) { row[fields[i].name] = null; } else { row[fields[i].name] = conv(fields[i].oid, body.toString('utf8', o, o + l)); o += l; } }
          rows.push(row);
        } else if (type === 'E') {
          const parts = {}; let o = 0; while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]); const e = body.indexOf(0, o + 1); parts[k] = body.toString('utf8', o + 1, e); o = e + 1; }
          err = new Error(parts.M || 'query failed'); err.code = parts.C;
        } else if (type === 'Z') { waiters.shift(); err ? reject(err) : resolve(rows); }
      });
      sock.write(msg('Q', Buffer.from(text + '\0')));
    });
  }
  return {
    query(text, params = []) {
      const p = chain.then(() => connect()).then(() => run(interpolate(text, params)));
      chain = p.catch(() => {});
      return p;
    }
  };
}
