import { env, listOrders, resalaReady, sendStageSms, settings, syncOrder, syncSmsDelivery, updateOrder } from './core.mjs';
import { maybeSendMorningDigest } from './daily-review.mjs';
import { createAdminNotification } from './notifications.mjs';

export default async function handler() {
  if (!env('APP_TOKEN')) return;
  const config = await settings();
  const orders = await listOrders();
  async function syncOne(order) {
    try {
      if (order.deletedAt) return;
      if (order.status === 'creating') {
        const started = Date.parse(order.createdAt || '');
        if (Number.isFinite(started) && Date.now() - started > 10 * 60_000) {
          await updateOrder(order.id, { status: 'attention',
            shippingError: 'توقف إنشاء الشحنة قبل استلام رقم التتبع. تحقق من درب السبيل قبل أي إعادة إرسال.' });
          await createAdminNotification(`stalled-order:${order.id}`, { kind: 'order_attention', orderId: order.id,
            title: `طلب يحتاج مراجعة رقم ${order.orderNumber || order.id.slice(0, 8)}`,
            body: 'توقف إنشاء الشحنة. تحقق من درب السبيل قبل محاولة الإرسال مجددًا لتجنب تكرارها.' });
        }
        return;
      }
      for (const field of ['confirmationSms', 'onWaySms', 'postponementSms']) {
        const started = Date.parse(order[`${field}StartedAt`] || '');
        if (order[field] === 'sending' && Number.isFinite(started) && Date.now() - started > 5 * 60_000) {
          await updateOrder(order.id, { [field]: 'unknown' });
        }
      }
      if (order.shipmentReference && !order.carrierDeletedAt && order.status !== 'attention') await syncOrder(order.id);
      if (config.autoMessages && resalaReady() && order.confirmationSms === 'needs_key' && order.shipmentReference) {
        await sendStageSms(order.id, 'confirmation');
      }
      if (config.autoMessages && resalaReady() && order.onWaySms === 'needs_key' && order.status === 'on_way') {
        await sendStageSms(order.id, 'onWay');
      }
      await syncSmsDelivery(order.id);
    } catch (error) {
      console.error('Shipment sync failed', order.id, error instanceof Error ? error.message : error);
    }
  }
  for (let index = 0; index < orders.length; index += 6) {
    await Promise.all(orders.slice(index, index + 6).map(syncOne));
  }
  try { await maybeSendMorningDigest(); }
  catch (error) { console.error('Morning digest failed', error instanceof Error ? error.message : error); }
}

