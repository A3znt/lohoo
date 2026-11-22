import { removeOrder, createOrder, darb, editPendingShipment, json, listDeliveryLocations, listOrders, listWarehouseProducts, quoteOrder, readOrder, resalaReady, retryShipment, sameOrigin, shippingComponents, syncSmsDelivery,
  saveSettings, sendStageSms, settings, syncOrder, updateOrder } from './core.mjs';
import { createAgent, getActor, listAgents, publicAgent, readAgent, resetAgentPassword, setAgentEnabled } from './team.mjs';

function commissionSummary(orders) {
  const earned = orders.reduce((sum, order) => sum + (order.commissionEarnedAt ? Number(order.commissionAmount || 0) : 0), 0);
  const paid = orders.reduce((sum, order) => sum + (order.commissionPaidAt ? Number(order.commissionAmount || 0) : 0), 0);
  return { assigned: orders.length, delivered: orders.filter((order) => order.status === 'delivered').length,
    earned, paid, due: Math.max(0, earned - paid) };
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
    if (!isAdmin && entry.data.agentId !== actor.id) throw new Error('ليس لديك صلاحية لهذا الطلب.');
    return entry;
  };
  try {
    switch (input.action) {
      case 'bootstrap': {
        const allOrders = await listOrders();
        const orders = isAdmin ? allOrders : allOrders.filter((order) => order.agentId === actor.id);
        const agents = isAdmin ? await listAgents() : [];
        return json({ ok: true, data: { actor, orders: orders.filter(o => !o.deletedAt), settings: await settings(), resalaConfigured: resalaReady(),
          agents: agents.map((agent) => ({ ...publicAgent(agent), ...commissionSummary(allOrders.filter((order) => order.agentId === agent.id)) })),
          commission: commissionSummary(orders) } });
      }
      case 'trash':
        requireAdmin();
        return json({ ok: true, data: (await listOrders()).filter(o => o.deletedAt) });
      case 'deleteOrder':
        requireAdmin();
        return json({ ok: true, data: await removeOrder(input.id) });
      case 'restoreOrder': {
        requireAdmin();
        const { data, etag } = await requireOwnOrder(input.id);
        if (data.status === 'creating') throw new Error('انتظر اكتمال إنشاء الشحنة.');
        return json({ ok: true, data: await updateOrder(input.id, { deletedAt: '' }, etag) });
      }
      case 'editOrder': {
        const { data, etag } = await requireOwnOrder(input.id);
        if (data.updatedAt !== input.version || data.deletedAt || data.status === 'creating') throw new Error('تغير الطلب. افتح تفاصيله مجددًا.');
        const form = input.order || {};
        if (data.shipmentReference && data.status === 'confirmed' && data.darbStatus === 'pending') {
          return json({ ok: true, data: await editPendingShipment(input.id, form, input.version, isAdmin) });
        }
        const patch = { notes: String(form.notes || '').trim().slice(0, 500), source: form.source === 'instagram' ? 'instagram' : 'facebook' };
        if (data.status === 'attention' && !data.shipmentReference && /Unexpected property has been encountered!|Unable to fetch branch/.test(data.shippingError || '')) {
          const { clean, service, estimate, deliveryFee } = await quoteOrder({ ...data, ...form });
          Object.assign(patch, clean, { serviceId: service, deliveryFee, shippingPrice: estimate });
          if (clean.customer !== data.customer || clean.phone !== data.phone) patch.contactId = '';
          if (!isAdmin) patch.paid = data.paid;
        }
        return json({ ok: true, data: await updateOrder(input.id, patch, etag) });
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
      case 'createOrder': {
        const requestedId = isAdmin ? String(input.order?.agentId || '') : actor.id;
        const agent = requestedId ? await readAgent(requestedId) : null;
        if (requestedId && (!agent || !agent.enabled)) throw new Error('المندوبة المختارة غير متاحة.');
        const order = await createOrder(input.order || {}, agent, actor);
        if (!isAdmin && order.agentId !== actor.id) throw new Error('معرّف الطلب مستخدم. أنشئي طلبًا جديدًا.');
        return json({ ok: true, data: order });
      }
      case 'updateOrder': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        const patch = {};
        if (input.paid !== undefined) {
          const paid = Number(input.paid);
          if (!Number.isFinite(paid) || paid < 0 || paid > 10000000) throw new Error('المبلغ غير صحيح.');
          patch.paid = paid;
        }
        if (input.status !== undefined) throw new Error('حالة الشحنة تأتي من درب السبيل. حدّث حالة الشحنة.');
        const saved = await updateOrder(input.id, patch);
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
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        const stage = input.stage === 'onWay' ? 'onWay' : 'confirmation';
        const field = stage === 'onWay' ? 'onWaySms' : 'confirmationSms';
        if (entry.data[field] !== 'failed') throw new Error('راجع سجل الرسائل قبل إعادة الإرسال؛ قد تكون الرسالة وصلت.');
        await updateOrder(input.id, { [field]: 'pending' });
        return json({ ok: true, data: await sendStageSms(input.id, stage) });
      }
      case 'createAgent':
        requireAdmin();
        return json({ ok: true, data: await createAgent(input.agent || {}) });
      case 'resetAgentPassword':
        requireAdmin();
        return json({ ok: true, data: await resetAgentPassword(input.id, input.password) });
      case 'setAgentEnabled':
        requireAdmin();
        return json({ ok: true, data: await setAgentEnabled(input.id, input.enabled) });
      case 'assignAgent': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        const agent = input.agentId ? await readAgent(input.agentId) : null;
        if (input.agentId && (!agent || !agent.enabled)) throw new Error('المندوبة المختارة غير متاحة.');
        if (entry.data.commissionPaidAt && agent?.id !== entry.data.agentId) throw new Error('لا يمكن نقل طلب صُرفت عمولته.');
        return json({ ok: true, data: await updateOrder(input.id, { agentId: agent?.id || '', agentName: agent?.name || '' }) });
      }
      case 'payCommission': {
        requireAdmin();
        const entry = await requireOwnOrder(input.id);
        if (!entry.data.commissionEarnedAt || !entry.data.agentId) throw new Error('العمولة لا تُستحق إلا بعد التسليم.');
        if (entry.data.commissionPaidAt) throw new Error('هذه العمولة مسجلة كمدفوعة بالفعل.');
        return json({ ok: true, data: await updateOrder(input.id, { commissionPaidAt: new Date().toISOString() }) });
      }
      default:
        return json({ ok: false, error: 'إجراء غير معروف.' }, 400);
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'تعذر تنفيذ الطلب.' }, 400);
  }
}

