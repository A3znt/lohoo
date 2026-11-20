import { env, listOrders, resalaReady, sendStageSms, settings, syncOrder, syncSmsDelivery, updateOrder } from '../lib/core.mjs';

export const config = { schedule: '*/15 * * * *' };

export default async function handler() {
  if (!env('APP_TOKEN')) return;
  const config = await settings();
  const orders = await listOrders();
  async function syncOne(order) {
    try {
      for (const field of ['confirmationSms', 'onWaySms']) {
        const started = Date.parse(order[`${field}StartedAt`] || '');
        if (order[field] === 'sending' && Number.isFinite(started) && Date.now() - started > 5 * 60_000) {
          await updateOrder(order.id, { [field]: 'unknown' });
        }
      }
      if (order.status === 'confirmed' || order.status === 'on_way') await syncOrder(order.id);
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
}
