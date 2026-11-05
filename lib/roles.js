export const ROLES = {
  owner: { label: 'เจ้าของฟาร์ม', group: 'farm' },
  exec: { label: 'ผู้บริหาร', group: 'farm' },
  office: { label: 'ออฟฟิศ / บัญชี', group: 'farm' },
  vet: { label: 'สัตวแพทย์', group: 'work' },
  tech: { label: 'ช่างซ่อม', group: 'work' },
  care: { label: 'คนดูแลไก่', group: 'work' },
  egg: { label: 'คนเก็บไข่', group: 'work' },
  load: { label: 'คนยกของ', group: 'work' },
  lhong: { label: 'ล้ง', group: 'lhong' },
  customer: { label: 'ลูกค้าปลีก', group: 'cust' },
};
export const isAdmin = u => !!u && (u.role === 'owner' || u.role === 'exec');
export const isStaff = u => !!u && ROLES[u.role]?.group === 'farm';
export const isWorker = u => !!u && ROLES[u.role]?.group === 'work';
export const isBuyer = u => !!u && (u.role === 'lhong' || u.role === 'customer');
const MONEY = /^(price|priceKg|prices|total|totalKg_price|amount|value|cost|paid|labor|partsCost|unitPrice|owe|income|revenue|p)$/;
const WORKER_DENY = new Set(['costs', 'mprices', 'api', 'settings']);
const WORKER_WRITE = new Set(['records', 'health', 'repairs', 'deliv', 'stockmov', 'taskdone']);
const collOf = path => { const s = path.split('/'); return s.slice(0, s.length - 1).join('/'); };
export function canRead(u, path) {
  if (!u) return false;
  if (isStaff(u)) return true;
  const top = path.split('/')[0];
  if (path.startsWith('data/users/')) return path.split('/')[2] === uidFor(u);
  if (isWorker(u)) return !WORKER_DENY.has(top) && path !== 'public/prices';
  if (isBuyer(u)) {
    if (top === 'public') return true;
    if (top === 'ledger') return path.split('/')[1] === u.buyer_id;
    if (top === 'deliv') return path.split('/')[1]?.startsWith(u.buyer_id + '_');
    return false;
  }
  return false;
}
export function canWrite(u, path) {
  if (!u) return false;
  if (isStaff(u)) return true;
  if (path.startsWith('data/users/')) return path.split('/')[2] === uidFor(u);
  if (isWorker(u)) return WORKER_WRITE.has(path.split('/')[0]);
  return false;
}
export function redact(u, data) {
  if (!isWorker(u) || data == null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(x => redact(u, x));
  const o = {};
  for (const [k, v] of Object.entries(data)) { if (MONEY.test(k)) continue; o[k] = redact(u, v); }
  return o;
}
// id the prototype dashboard sees: buyers see their buyer id so their ledger lines up
export const uidFor = u => (isBuyer(u) && u.buyer_id) ? u.buyer_id : u.id;
export { collOf };

export function stripMoney(data) {
  if (Array.isArray(data)) return data.map(stripMoney);
  if (data == null || typeof data !== 'object') return data;
  const o = {}; for (const [k, v] of Object.entries(data)) if (!MONEY.test(k)) o[k] = stripMoney(v); return o;
}
