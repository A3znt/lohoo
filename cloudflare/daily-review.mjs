import { listOrders, readOrder, syncOrder } from './core.mjs';
import { createAdminNotification } from './notifications.mjs';
import { ordersStore } from './runtime.mjs';

export function tripoliClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function reviewable(order) {
  return Boolean(order.shipmentReference && !order.deletedAt && !order.carrierDeletedAt &&
    ['confirmed', 'on_way', 'postponed', 'delivery_failed'].includes(order.status));
}

export async function dailyReviewedIds(date = tripoliClock().date) {
  const prefix = `daily-reviews/${date}/`;
  const { blobs } = await ordersStore().list({ prefix });
  return blobs.map(({ key }) => key.slice(prefix.length));
}

export async function reviewShipment(id) {
  const entry = await readOrder(id);
  if (!entry || !reviewable(entry.data)) throw new Error('هذه الشحنة غير متاحة للمراجعة اليومية.');
  await syncOrder(id, { requireFound: true });
  const updated = (await readOrder(id))?.data;
  if (!updated) throw new Error('تعذر تحديث الطلب.');
  const date = tripoliClock().date;
  await ordersStore().setJSON(`daily-reviews/${date}/${id}`,
    { orderId: id, date, checkedAt: new Date().toISOString(), status: updated.darbStatus, reference: updated.shipmentReference },
    { onlyIfNew: true });
  return { order: updated, date };
}

export async function maybeSendMorningDigest(now = new Date()) {
  const { date, hour } = tripoliClock(now);
  if (hour < 9 || hour >= 12) return null;
  const orders = (await listOrders()).filter((order) => !order.deletedAt);
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const recent = orders.filter((order) => Date.parse(order.createdAt) >= since);
  const reviewed = new Set(await dailyReviewedIds(date));
  const outstanding = orders.filter((order) => reviewable(order) && !reviewed.has(order.id)).length;
  const title = `ملخص صباح ${date}`;
  const body = `${recent.length} طلب جديد خلال آخر 24 ساعة. ${outstanding} شحنة تنتظر فحصك اليوم في درب السبيل.`;
  return createAdminNotification(`morning:${date}`, { kind: 'daily_digest', title, body });
}
