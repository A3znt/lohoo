import { removeOrder, createOrder, darb, editPendingShipment, ensureValidCollection, env, json, listDeliveryLocations, listOrders, listWarehouseProducts, quoteOrder, readOrder, resalaReady, retryShipment, sameOrigin, shippingComponents, syncSmsDelivery,
  saveSettings, sendStageSms, settings, syncOrder, updateOrder } from './core.mjs';
import { agentSessionCookie, changeOwnAgentPassword, createAgent, getActor, listAgents, publicAgent, readAgent, resetAgentPassword, setAgentEnabled, updateAgentProfile } from './team.mjs';
import { createAdminNotification, createManualNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, removePushSubscription, savePushSubscription, testPhonePush } from './notifications.mjs';
import { dailyReviewedIds, reviewShipment, tripoliClock } from './daily-review.mjs';
import { migrateOrderCodes } from './order-codes.mjs';

function commissionSummary(orders) {
  const earned = orders.reduce((sum, order) => sum + (order.commissionEarnedAt ? Number(order.commissionAmount || 0) : 0), 0);
  const paid = orders.reduce((sum, order) => sum + (order.commissionPaidAt ? Number(order.commissionAmount || 0) : 0), 0);
  return { assigned: orders.length, delivered: orders.filter((order) => order.status === 'delivered').length,
    earned, paid, due: Math.max(0, earned - paid) };
}

async function notifyAdminActivity(key, order, title, actorName) {
  try {
    await createAdminNotification(`${key}:${order.id}:${order.updatedAt}`, { kind: 'order_activity', orderId: order.id,
      title: `${title} رقم ${order.orderNumber || order.id.slice(0, 8)}`,
      body: `${order.customer} · بواسطة ${actorName}` });
  } catch (error) { console.error('Order activity notification failed', order.id, error instanceof Error ? error.message : error); }
}

export default async function handler(request) {
  const actor = await getActor(request);
  if (!actor) return json({ ok: false, error: 'سجّل الدخول من جديد.' }, 401);
  if (request.method !== 'POST' || !sameOrigin(request)) return json({ ok: false, error: 'طلب غير مسموح.' }, 403);
  const input = await request.json().catch(() => ({}));
  const isAdmin = actor.role === 'admin';
  const requireAdmin = () => { if (!isAdmin) throw new Error('هذا الإجراء متاح للمدير فقط.'); };
  const requireOwnOrder = async (id) => {
    const entry = await readOrder(id);
    if (!entry) throw new Error('الطلب غير موجود.');
    if (!isAdmin && entry.data.agentId !== actor.id && entry.data.createdById !== actor.id) throw new Error('ليس لديك صلاحية لهذا الطلب.');
    return entry;
  };
  try {
    switch (input.action) {
      case 'bootstrap': {
        const allOrders = await listOrders();
        const orders = isAdmin ? allOrders : allOrders.filter((order) => order.agentId === actor.id || order.createdById === actor.id);
        const assignedOrders = isAdmin ? allOrders : allOrders.filter((order) => order.agentId === actor.id);
        const agents = isAdmin ? await listAgents() : [];
        const walletEntries = isAdmin ? [] : assignedOrders.filter((order) => !order.deletedAt || order.commissionEarnedAt || order.commissionPaidAt).map((order) => ({
          orderId: order.id, orderNumber: order.orderNumber, customer: order.customer, product: order.product,
          status: order.status, createdAt: order.createdAt, deletedAt: order.deletedAt || '',
          commissionAmount: Number(order.commissionAmount || 0), commissionEarnedAt: order.commissionEarnedAt || '',
          commissionPaidAt: order.commissionPaidAt || '',
        }));
        return json({ ok: true, data: { actor, orders: orders.filter(o => !o.deletedAt), settings: await settings(), resalaConfigured: resalaReady(),
          notifications: await listNotifications(actor.id), vapidPublicKey: env('VAPID_PUBLIC_KEY'),
          agents: agents.map((agent) => ({ ...publicAgent(agent), ...commissionSummary(allOrders.filter((order) => order.agentId === agent.id)) })),
          commission: commissionSummary(assignedOrders), walletEntries,
          dailyReviewDate: tripoliClock().date, dailyReviewedIds: isAdmin ? await dailyReviewedIds() : [] } });
      }
      case 'markNotificationRead':
        return json({ ok: true, data: await markNotificationRead(actor.id, input.id) });
      case 'markAllNotificationsRead':
        return json({ ok: true, data: await markAllNotificationsRead(actor.id) });
      case 'notifications':
        return json({ ok: true, data: await listNotifications(actor.id) });
      case 'testPhonePush':
        return json({ ok: true, data: await testPhonePush(actor.id) });
      case 'savePushSubscription':
        return json({ ok: true, data: await savePushSubscription(actor.id, input.subscription) });
      case 'removePushSubscription':
        return json({ ok: true, data: await removePushSubscription(actor.id, input.endpoint) });
      case 'sendNotification': {
        requireAdmin();
        const recipient = String(input.recipient || '');
        const agents = await listAgents();
        const recipients = recipient === 'team' ? ['admin', ...agents.filter((agent) => agent.enabled).map((agent) => agent.id)]
          : recipient === 'all' ? agents.filter((agent) => agent.enabled).map((agent) => agent.id)
          : recipient === 'admin' ? ['admin'] : agents.some((agent) => agent.id === recipient && agent.enabled) ? [recipient] : [];
        if (!recipients.length) throw new Error('اختر مستلمًا متاحًا.');
        return json({ ok: true, data: await createManualNotifications(recipients, input.title, input.body) });
      }
      case 'trash':
        requireAdmin();
        return json({ ok: true, data: (await listOrders()).filter(o => o.deletedAt) });
      case 'deleteOrder':
        requireAdmin();
        {
          const saved = await removeOrder(input.id);
          await notifyAdminActivity('deleted', saved, 'حُذف الطلب', actor.name);
          return json({ ok: true, data: saved });
        }
      case 'restoreOrder': {
        requireAdmin();
        const { data, etag } = await requireOwnOrder(input.id);
        if (data.status === 'creating') throw new Error('انتظر اكتمال إنشاء الشحنة.');
        const saved = await updateOrder(input.id, { deletedAt: '' }, etag);
        await notifyAdminActivity('restored', saved, 'استُعيد الطلب', actor.name);
        return json({ ok: true, data: saved });
      }
      case 'editOrder': {
        const { data, etag } = await requireOwnOrder(input.id);
        if (data.updatedAt !== input.version || data.deletedAt || data.status === 'creating') throw new Error('تغير الطلب. افتح تفاصيله مجددًا.');
        const form = input.order || {};
        if (data.shipmentReference && data.status === 'confirmed' && data.darbStatus === 'pending') {
          const saved = await editPendingShipment(input.id, form, input.version, isAdmin);
          await notifyAdminActivity('edited', saved, 'عُدّل الطلب', actor.name);
          return json({ ok: true, data: saved });
        }
        const patch = { notes: String(form.notes || '').trim().slice(0, 500), source: form.source === 'instagram' ? 'instagram' : 'facebook' };
        if (data.status === 'attention' && !data.shipmentReference && /Unexpected property has been encountered!|Unable to fetch branch/.test(data.shippingError || '')) {
          const { clean, service, estimate, deliveryFee } = await quoteOrder({ ...data, ...form });
          Object.assign(patch, clean, { serviceId: service, deliveryFee, shippingPrice: estimate });
          if (clean.customer !== data.customer || clean.phone !== data.phone ||
            JSON.stringify(clean.additionalPhones) !== JSON.stringify(data.additionalPhones || [])) {
            patch.contactId = '';
            patch.contactIds = [];
          }
          if (!isAdmin) patch.paid = data.paid;
        }
        const saved = await updateOrder(input.id, patch, etag);
        await notifyAdminActivity('edited', saved, 'عُدّل الطلب', actor.name);
        return json({ ok: true, data: saved });
      }
      case 'packages': {
        const data = await darb('GET', '/api/local/service/rates/public/');
        return json({ ok: true, data: Array.isArray(data) ? data : data?.results || [] });
      }
      case 'deliveryLocations':
        return json({ ok: true, data: await listDeliveryLocations() });
      case 'warehouseProducts':
        return json({ ok: true, data: await listWarehouseProducts() });
      case 'quoteOrder': {
        const { service, deliveryFee, estimate } = await quoteOrder(input.order || {});
        return json({ ok: true, data: { serviceId: service, deliveryFee, components: shippingComponents(estimate) } });
      }
      case 'saveSettings':
        requireAdmin();
        return json({ ok: true, data: await saveSettings(input.settings || {}) });
      case 'migrateOrderCodes':
        requireAdmin();
        return json({ ok: true, data: await migrateOrderCodes(await listOrders(), await listAgents()) });
      case 'createOrder': {
        const requestedId = isAdmin ? String(input.order?.agentId || '') : actor.id;
        const agent = requestedId ? await readAgent(requestedId) : null;
        if (requestedId && (!agent || !agent.enabled)) throw new Error('المندوبة المختارة غير متاحة.');
        const order = await createOrder(input.order || {}, agent, actor);
        if (!isAdmin && order.agentId !== actor.id) throw new Error('معرّف الطلب مستخدم. أنشئي طلبًا جديدًا.');
        try {
          await createAdminNotification(`new-order:${order.id}`, { kind: 'new_order', orderId: order.id,
            title: `${isAdmin ? 'سجّلت' : `${order.createdByName || 'المندوبة'} سجّلت`} طلبًا رقم ${order.orderNumber}`,
            body: `${order.customer} · ${order.product}${order.shipmentReference ? ` · تأكد في درب السبيل برقم ${order.shipmentReference}` : ' · الشحنة تحتاج مراجعة'}` });
        } catch (error) { console.error('New order notification failed', order.id, error instanceof Error ? error.message : error); }
        return json({ ok: true, data: order });
      }
      case 'reviewShipment': {
        requireAdmin();
        await requireOwnOrder(input.id);
        return json({ ok: true, data: await reviewShipment(input.id) });
      }
      case 'updateOrder': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        const patch = {};
        if (input.paid !== undefined) {
          const paid = Number(input.paid);
          if (!Number.isFinite(paid) || paid < 0 || paid > 10000000) throw new Error('المبلغ غير صحيح.');
          ensureValidCollection(paid, Number(entry.data.unitPrice || 0), Number(entry.data.quantity || 0), Number(entry.data.deliveryFee || 0));
          patch.paid = paid;
        }
        if (input.status !== undefined) throw new Error('حالة الشحنة تأتي من درب السبيل. حدّث حالة الشحنة.');
        const saved = await updateOrder(input.id, patch);
        if (patch.paid !== undefined && Number(entry.data.paid || 0) !== patch.paid) {
          await notifyAdminActivity('collection', saved, 'تحدّث تحصيل الطلب', actor.name);
        }
        return json({ ok: true, data: (await readOrder(input.id))?.data || saved });
      }
      case 'syncOrder': {
        await requireOwnOrder(input.id);
        await syncOrder(input.id);
        return json({ ok: true, data: await syncSmsDelivery(input.id) });
      }
      case 'retryShipment': {
        await requireOwnOrder(input.id);
        return json({ ok: true, data: await retryShipment(input.id, input.destination || {}) });
      }
      case 'retryMessage': {
        let entry = await requireOwnOrder(input.id);
        const stage = input.stage === 'onWay' ? 'onWay' : 'confirmation';
        const field = stage === 'onWay' ? 'onWaySms' : 'confirmationSms';
        if (!entry.data.shipmentReference || entry.data.carrierDeletedAt || entry.data.darbStatus === 'not_found') {
          throw new Error('لا يمكن إرسال الرسالة؛ الشحنة غير موجودة حاليًا في درب السبيل.');
        }
        if (stage === 'onWay' && !['on_way', 'delivered'].includes(entry.data.status)) throw new Error('رسالة الطريق متاحة بعد خروج الشحنة للتوصيل.');
        if (!['pending', 'needs_key', 'failed'].includes(entry.data[field])) throw new Error('راجع حالة الرسالة في رِسالة قبل محاولة ثانية؛ قد تكون وصلت بالفعل.');
        if (env('DARB_API_KEY')) {
          await syncOrder(input.id, { requireFound: true });
          entry = await requireOwnOrder(input.id);
          if (entry.data.carrierDeletedAt || entry.data.darbStatus === 'not_found') throw new Error('لا يمكن إرسال الرسالة؛ الشحنة غير موجودة حاليًا في درب السبيل.');
        }
        if (entry.data[field] === 'failed') await updateOrder(input.id, { [field]: 'pending', [`${field}Error`]: '' }, entry.etag);
        return json({ ok: true, data: await sendStageSms(input.id, stage) });
      }
      case 'createAgent':
        requireAdmin();
        return json({ ok: true, data: await createAgent(input.agent || {}) });
      case 'resetAgentPassword':
        requireAdmin();
        return json({ ok: true, data: await resetAgentPassword(input.id, input.password) });
      case 'changeMyPassword': {
        if (isAdmin) throw new Error('هذا الإجراء مخصص للمندوبات.');
        const agent = await changeOwnAgentPassword(actor.id, input.currentPassword, input.newPassword);
        const response = json({ ok: true, data: { changed: true } });
        response.headers.append('Set-Cookie', agentSessionCookie(agent));
        return response;
      }
      case 'updateAgentProfile':
        requireAdmin();
        return json({ ok: true, data: await updateAgentProfile(input.id, input.agent) });
      case 'setAgentEnabled':
        requireAdmin();
        return json({ ok: true, data: await setAgentEnabled(input.id, input.enabled) });
      case 'assignAgent': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        const agent = input.agentId ? await readAgent(input.agentId) : null;
        if (input.agentId && (!agent || !agent.enabled)) throw new Error('المندوبة المختارة غير متاحة.');
        if (entry.data.commissionEarnedAt && (agent?.id || '') !== entry.data.agentId) throw new Error('لا يمكن نقل الطلب بعد استحقاق العمولة.');
        const saved = await updateOrder(input.id, { agentId: agent?.id || '', agentName: agent?.name || '' });
        await notifyAdminActivity('assigned', saved, 'تغيّرت مندوبة الطلب', actor.name);
        return json({ ok: true, data: saved });
      }
      case 'payCommission': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        if (!entry.data.commissionEarnedAt || !entry.data.agentId) throw new Error('العمولة لا تُستحق إلا بعد التسليم.');
        if (entry.data.commissionPaidAt) throw new Error('هذه العمولة مسجلة كمدفوعة بالفعل.');
        const saved = await updateOrder(input.id, { commissionPaidAt: new Date().toISOString() });
        await notifyAdminActivity('commission', saved, 'صُرفت عمولة الطلب', actor.name);
        return json({ ok: true, data: saved });
      }
      case 'payAgentCommissions': {
        requireAdmin();
        const agent = await readAgent(input.agentId);
        if (!agent) throw new Error('حساب المندوبة غير موجود.');
        const unpaid = (await listOrders()).filter((order) => order.agentId === agent.id && order.commissionEarnedAt && !order.commissionPaidAt);
        if (!unpaid.length) throw new Error('لا توجد عمولات مستحقة للصرف.');
        let count = 0;
        let amount = 0;
        for (const order of unpaid) {
          const saved = await updateOrder(order.id, { commissionPaidAt: new Date().toISOString() });
          await notifyAdminActivity('commission', saved, 'صُرفت عمولة الطلب', actor.name);
          count += 1;
          amount += Number(order.commissionAmount || 0);
        }
        return json({ ok: true, data: { count, amount } });
      }
      default:
        return json({ ok: false, error: 'إجراء غير معروف.' }, 400);
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'تعذر تنفيذ الطلب.' }, 400);
  }
}

