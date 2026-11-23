import { ordersStore } from './runtime.mjs';

const MIGRATION_KEY = 'meta/order-codes-v1';
const sequenceKey = (prefix) => `order-sequence/${prefix}`;
const previousCode = (order) => order.legacyOrderNumber || order.orderNumber ||
  (BigInt(`0x${String(order.id).replaceAll('-', '')}`) % 1000000000000n).toString().padStart(12, '0');

export function agentCodePrefix(username) {
  const normalized = String(username || '').trim().toUpperCase();
  if (!/^[A-Z]{2}/.test(normalized)) throw new Error('اسم دخول المندوبة يجب أن يبدأ بحرفين إنجليزيين.');
  const prefix = normalized.slice(0, 2);
  if (prefix === 'ZN') throw new Error('الرمز ZN مخصص لمالك ركن. اختر أول حرفين مختلفين.');
  return prefix;
}

export function creatorCodePrefix(actor) {
  return actor?.role === 'agent' ? agentCodePrefix(actor.username) : 'ZN';
}

export function formatOrderCode(prefix, serial) {
  if (!/^[A-Z]{2}$/.test(prefix) || !Number.isInteger(serial) || serial < 1 || serial > 999) {
    throw new Error('تسلسل أكواد الطلبات غير صالح.');
  }
  return `${prefix}${String(serial).padStart(3, '0')}`;
}

export function planOrderCodeMigration(orders, agents) {
  const agentPrefixes = new Map(agents.map((agent) => [agent.id, agentCodePrefix(agent.username)]));
  const sorted = [...orders].sort((a, b) => {
    const left = Date.parse(a.createdAt || '') || 0;
    const right = Date.parse(b.createdAt || '') || 0;
    return left - right || String(a.id).localeCompare(String(b.id));
  });
  const counters = new Map();
  const assignments = sorted.map((order) => {
    const prefix = agentPrefixes.get(order.createdById) || 'ZN';
    const serial = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, serial);
    return { id: order.id, code: formatOrderCode(prefix, serial) };
  });
  return { assignments, counters: Object.fromEntries(counters) };
}

export async function allocateOrderCode(actor) {
  const store = ordersStore();
  if (!(await store.get(MIGRATION_KEY))) throw new Error('جاري تحديث أكواد الطلبات. حاول مجددًا بعد دقائق.');
  const prefix = creatorCodePrefix(actor);
  const ownerId = actor?.role === 'agent' ? actor.id : 'admin';
  for (let attempt = 0; attempt < 30; attempt++) {
    const entry = await store.getWithMetadata(sequenceKey(prefix));
    if (entry?.data?.ownerId && entry.data.ownerId !== ownerId) throw new Error(`رمز الطلب ${prefix} مرتبط بحساب آخر.`);
    const next = Number(entry?.data?.last || 0) + 1;
    const code = formatOrderCode(prefix, next);
    const result = await store.setJSON(sequenceKey(prefix), { last: next, ownerId }, entry
      ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (result.modified) return code;
  }
  throw new Error('تعذر تخصيص كود للطلب بسبب ازدحام الحفظ. حاول مرة أخرى.');
}

export async function migrateOrderCodes(orders, agents) {
  const store = ordersStore();
  const existing = await store.get(MIGRATION_KEY);
  if (existing) {
    let repaired = 0;
    for (const order of orders.filter((row) => /^[A-Z]{2}\d{3}$/.test(row.orderNumber || '') && !row.legacyOrderNumber)) {
      const key = `orders/${order.id}`;
      const entry = await store.getWithMetadata(key);
      if (!entry?.data || entry.data.legacyOrderNumber) continue;
      const fallback = (BigInt(`0x${String(order.id).replaceAll('-', '')}`) % 1000000000000n).toString().padStart(12, '0');
      const result = await store.setJSON(key, { ...entry.data, legacyOrderNumber: fallback }, { onlyIfMatch: entry.etag });
      if (result.modified) repaired += 1;
    }
    return { alreadyCompleted: true, counts: existing.counts, repaired };
  }
  const { assignments, counters } = planOrderCodeMigration(orders, agents);
  const owners = Object.fromEntries(agents.map((agent) => [agentCodePrefix(agent.username), agent.id]));
  for (const { id, code } of assignments) {
    const key = `orders/${id}`;
    const entry = await store.getWithMetadata(key);
    if (!entry) throw new Error(`سجل الطلب ${id} تغيّر أثناء نقل الأكواد.`);
    const previous = previousCode(entry.data);
    if (entry.data.orderNumber === code && entry.data.legacyOrderNumber) continue;
    const updated = { ...entry.data, legacyOrderNumber: previous, orderNumber: code };
    const result = await store.setJSON(key, updated, { onlyIfMatch: entry.etag });
    if (!result.modified) throw new Error(`سجل الطلب ${id} تغيّر أثناء نقل الأكواد. أعد المحاولة.`);
  }
  for (const [prefix, last] of Object.entries(counters)) await store.setJSON(sequenceKey(prefix), { last, ownerId: owners[prefix] || 'admin' });
  const completed = { counts: counters, completedAt: new Date().toISOString() };
  await store.setJSON(MIGRATION_KEY, completed, { onlyIfNew: true });
  return { alreadyCompleted: false, counts: counters, migrated: assignments.length };
}
