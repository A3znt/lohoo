import { buildPushPayload } from '@block65/webcrypto-web-push';
import { binding, ordersStore } from './runtime.mjs';

const agentIdValid = (id) => /^[a-f0-9-]{36}$/i.test(String(id || ''));
const recipientValid = (id) => id === 'admin' || agentIdValid(id);
const notificationKey = (agentId, id) => `notifications/${agentId}/${id}`;
const pushKey = async (endpoint) => `push/${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
const safeText = (value) => {
  const text = typeof value === 'string' ? value : value && typeof value === 'object'
    ? value.name || value.title || value.description || value.message || '' : '';
  return String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 280);
};
const normalizeStatus = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function carrierEvent(record) {
  const entries = Array.isArray(record?.timeline) ? record.timeline : [];
  const latest = entries.at(-1);
  const status = normalizeStatus(record?.status);
  const timelineStatus = normalizeStatus(latest?.status || latest?.type);
  const selected = [status, ...(status ? [] : [timelineStatus])].find((value) =>
    ['postponed', 'deferred', 'rescheduled', 'delayed', 'مؤجل', 'مؤجلة', 'تم_التأجيل',
      'failed', 'undelivered', 'delivery_failed', 'attempt_failed', 'تعذر', 'تعذر_التسليم', 'فشل_التوصيل',
      'cancelled', 'canceled', 'ملغي', 'ملغية', 'تم_الإلغاء'].includes(value));
  if (!selected) return null;
  const kind = ['postponed', 'deferred', 'rescheduled', 'delayed', 'مؤجل', 'مؤجلة', 'تم_التأجيل'].includes(selected)
    ? 'postponed' : ['cancelled', 'canceled', 'ملغي', 'ملغية', 'تم_الإلغاء'].includes(selected) ? 'cancelled' : 'delivery_failed';
  const matchingTimeline = timelineStatus === selected ? latest : entries.findLast((item) => normalizeStatus(item?.status || item?.type) === selected);
  const candidates = [record?.statusReason, record?.failureReason, record?.postponementReason,
    record?.cancellationReason, record?.reason, matchingTimeline?.remarks, matchingTimeline?.reason, matchingTimeline?.description,
    record?.lastEvent?.reason, record?.lastEvent?.description];
  const reason = candidates.map(safeText).find(Boolean) || '';
  const eventId = safeText(matchingTimeline?._id || matchingTimeline?.id || matchingTimeline?.timestamp || matchingTimeline?.createdAt ||
    record?.statusUpdatedAt || record?.statusChangedAt || '');
  return { kind, reason, eventId, status: selected };
}

export async function listNotifications(agentId) {
  if (!recipientValid(agentId)) return [];
  const rows = (await ordersStore().listValues({ prefix: `notifications/${agentId}/` })).map(({ value }) => value);
  return rows.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function markNotificationRead(agentId, id) {
  if (!recipientValid(agentId) || !/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('الإشعار غير صحيح.');
  const key = notificationKey(agentId, id);
  const entry = await ordersStore().getWithMetadata(key);
  if (!entry) throw new Error('الإشعار غير موجود.');
  if (entry.data.readAt) return entry.data;
  const next = { ...entry.data, readAt: new Date().toISOString() };
  const result = await ordersStore().setJSON(key, next, { onlyIfMatch: entry.etag });
  return result.modified ? next : (await ordersStore().get(key));
}

function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com'));
  } catch { return false; }
}

export async function savePushSubscription(agentId, value) {
  if (!recipientValid(agentId) || !validEndpoint(value?.endpoint) ||
    !/^[\w-]{80,120}$/.test(value?.keys?.p256dh || '') || !/^[\w-]{15,40}$/.test(value?.keys?.auth || '')) {
    throw new Error('بيانات إشعارات الهاتف غير صالحة.');
  }
  const subscription = { endpoint: value.endpoint, expirationTime: value.expirationTime || null,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  await ordersStore().setJSON(await pushKey(subscription.endpoint), { agentId, subscription, updatedAt: new Date().toISOString() });
  return { enabled: true };
}

export async function removePushSubscription(agentId, endpoint) {
  if (!recipientValid(agentId) || !validEndpoint(endpoint)) return { enabled: false };
  const key = await pushKey(endpoint);
  const entry = await ordersStore().getWithMetadata(key);
  if (entry?.data?.agentId === agentId) await ordersStore().setJSON(key, { agentId: '', subscription: null, updatedAt: new Date().toISOString() }, { onlyIfMatch: entry.etag });
  return { enabled: false };
}

async function sendPush(agentId, notification) {
  const vars = binding('VAPID_PRIVATE_KEY');
  if (!vars || !binding('VAPID_PUBLIC_KEY')) return;
  const vapid = { subject: binding('VAPID_SUBJECT'), publicKey: binding('VAPID_PUBLIC_KEY'), privateKey: vars };
  const devices = (await ordersStore().listValues({ prefix: 'push/' })).map(({ value }) => value)
    .filter((item) => item?.agentId === agentId && item.subscription);
  await Promise.all(devices.map(async (device) => {
    try {
      const payload = await buildPushPayload({ data: JSON.stringify({ title: notification.title,
        body: notification.body, url: '/?notifications=1', tag: notification.id }), options: { ttl: 3600 } }, device.subscription, vapid);
      const response = await fetch(device.subscription.endpoint, { ...payload, signal: AbortSignal.timeout(8000) });
      if (response.status === 404 || response.status === 410) await removePushSubscription(agentId, device.subscription.endpoint);
      else if (!response.ok) console.error(JSON.stringify({ event: 'push_rejected', status: response.status }));
    } catch (error) { console.error(JSON.stringify({ event: 'push_failed', type: error?.name || 'Error' })); }
  }));
}

async function dispatchPush(agentId, notification) {
  const execution = binding('__EXECUTION_CONTEXT');
  if (execution?.waitUntil) {
    execution.waitUntil(sendPush(agentId, notification).catch((error) => {
      console.error(JSON.stringify({ event: 'push_dispatch_failed', type: error?.name || 'Error' }));
    }));
    return;
  }
  await sendPush(agentId, notification);
}

export async function createManualNotifications(recipientIds, title, body) {
  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanTitle || cleanTitle.length > 80 || !cleanBody || cleanBody.length > 500) {
    throw new Error('اكتب عنوانًا حتى 80 حرفًا ورسالة حتى 500 حرف.');
  }
  const recipients = [...new Set(recipientIds)];
  if (!recipients.length || recipients.length > 50 || recipients.some((id) => !recipientValid(id))) {
    throw new Error('المستلمون غير صالحين.');
  }
  const createdAt = new Date().toISOString();
  await Promise.all(recipients.map(async (agentId) => {
    const id = (await pushKey(crypto.randomUUID())).slice(5);
    const notification = { id, agentId, orderId: '', kind: 'manual', title: cleanTitle, body: cleanBody,
      reason: '', createdAt, readAt: '' };
    await ordersStore().setJSON(notificationKey(agentId, id), notification, { onlyIfNew: true });
    await dispatchPush(agentId, notification);
  }));
  return { count: recipients.length };
}

export async function createAdminNotification(key, { kind, orderId = '', title, body }) {
  const id = (await pushKey(`admin:${key}`)).slice(5);
  const notification = { id, agentId: 'admin', orderId, kind, title, body, reason: '',
    createdAt: new Date().toISOString(), readAt: '' };
  const result = await ordersStore().setJSON(notificationKey('admin', id), notification, { onlyIfNew: true });
  if (result.modified) await dispatchPush('admin', notification);
  return notification;
}

export async function createCarrierNotification(order, event) {
  const agentId = agentIdValid(order.agentId) ? order.agentId : agentIdValid(order.createdById) ? order.createdById : '';
  const signature = `${order.id}\n${event.kind}\n${event.reason}\n${event.eventId}`;
  const id = (await pushKey(signature)).slice(5);
  const title = event.kind === 'postponed' ? 'طلبية مؤجّلة' : event.kind === 'cancelled' ? 'طلبية ملغية' : 'تعذّر توصيل الطلبية';
  const number = order.orderNumber || order.id.slice(0, 8);
  const body = `طلبية ${number} · ${order.customer}${event.reason ? ` — السبب: ${event.reason}` : ' — لم يذكر درب السبيل سببًا بعد.'}`;
  const createdAt = new Date().toISOString();
  const recipients = agentId ? [agentId, 'admin'] : ['admin'];
  const notifications = await Promise.all(recipients.map(async (recipient) => {
    const notification = { id, agentId: recipient, orderId: order.id, kind: event.kind, title, body,
      reason: event.reason, createdAt, readAt: '' };
    const result = await ordersStore().setJSON(notificationKey(recipient, id), notification, { onlyIfNew: true });
    if (result.modified) await dispatchPush(recipient, notification);
    return notification;
  }));
  return notifications[0];
}
