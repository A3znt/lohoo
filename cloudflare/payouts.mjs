import { randomUUID } from 'node:crypto';
import { ordersStore } from './runtime.mjs';
import { createAdminNotification, createRecipientNotification } from './notifications.mjs';

const profileKey = (agentId) => `payout-profile/${agentId}`;
const requestKey = (id) => `payout-request/${id}`;
const clean = (value, max = 120) => String(value || '').trim().slice(0, max);

export function eligibleCommissions(orders, agentId) {
  return orders.filter((order) => order.agentId === agentId && order.status === 'delivered' &&
    order.commissionEarnedAt && !order.commissionPaidAt && Number(order.commissionAmount) > 0);
}

export function validatePayoutProfile(input) {
  const method = clean(input?.method, 20);
  if (!['bank', 'transfer', 'cash'].includes(method)) throw new Error('اختر طريقة استلام صحيحة.');
  const profile = { method, accountHolder: clean(input?.accountHolder), bankName: clean(input?.bankName),
    accountNumber: clean(input?.accountNumber, 80), phone: clean(input?.phone, 20), notes: clean(input?.notes, 250) };
  if (profile.accountHolder.length < 3) throw new Error('اكتبي اسم صاحبة الحساب كاملًا.');
  if (method === 'bank' && (profile.bankName.length < 2 || profile.accountNumber.length < 5))
    throw new Error('أدخلي اسم المصرف ورقم الحساب كاملًا.');
  if (method === 'transfer' && !/^\+?\d{10,15}$/.test(profile.phone))
    throw new Error('أدخلي رقم الحوالة بصيغة صحيحة.');
  return profile;
}

export async function savePayoutProfile(agentId, input) {
  const profile = { ...validatePayoutProfile(input), agentId, updatedAt: new Date().toISOString() };
  await ordersStore().setJSON(profileKey(agentId), profile);
  return profile;
}

export async function getPayoutProfile(agentId) {
  return ordersStore().get(profileKey(agentId));
}

export async function listPayoutRequests(agentId = '') {
  const rows = (await ordersStore().listValues({ prefix: 'payout-request/' })).map(({ value }) => value).filter(Boolean);
  return rows.filter((item) => !agentId || item.agentId === agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function openPayoutForOrder(orderId) {
  return (await listPayoutRequests()).find((item) => ['pending', 'processing'].includes(item.status) && item.orderIds.includes(orderId));
}

export async function requestPayout(agent, orders) {
  const profile = await getPayoutProfile(agent.id);
  if (!profile) throw new Error('احفظي بيانات استلام العمولة أولًا.');
  const active = (await listPayoutRequests(agent.id)).find((item) => ['pending', 'processing'].includes(item.status));
  if (active) throw new Error('لديك طلب سحب قيد المراجعة بالفعل.');
  const eligible = eligibleCommissions(orders, agent.id);
  if (!eligible.length) throw new Error('لا توجد عمولات مستحقة للسحب الآن.');
  const amount = eligible.reduce((sum, order) => sum + Number(order.commissionAmount), 0);
  const request = { id: randomUUID(), agentId: agent.id, agentName: agent.name, orderIds: eligible.map((item) => item.id),
    amount, profile, status: 'pending', createdAt: new Date().toISOString(), completedAt: '', transferReference: '' };
  const saved = await ordersStore().setJSON(requestKey(request.id), request, { onlyIfNew: true });
  if (!saved.modified) throw new Error('تعذر حفظ طلب السحب.');
  try { await createAdminNotification(`payout:${request.id}`, { kind: 'payout_request',
    title: `طلب سحب من ${agent.name}`, body: `${amount} د.ل عن ${eligible.length} طلبية مسلّمة. راجع بيانات الاستلام في المالية.` }); }
  catch (error) { console.error('Payout request notification failed', error instanceof Error ? error.message : error); }
  return request;
}

export async function completePayout(id, transferReference, readOrder, updateOrder) {
  const key = requestKey(id);
  const entry = await ordersStore().getWithMetadata(key);
  if (!entry) throw new Error('طلب السحب غير موجود.');
  if (entry.data.status === 'completed') throw new Error('طلب السحب صُرف بالفعل.');
  if (entry.data.status === 'cancelled') throw new Error('طلب السحب ملغي.');
  const reference = clean(transferReference, 100);
  if (reference.length < 3) throw new Error('اكتب رقم الحوالة أو سند الصرف للرجوع إليه.');
  const request = entry.data;
  const currentOrders = await Promise.all(request.orderIds.map(async (orderId) => (await readOrder(orderId))?.data));
  const validOrders = currentOrders.every((order) => order && order.agentId === request.agentId &&
    ((order.commissionPaidAt && order.payoutRequestId === id) ||
      (order.status === 'delivered' && order.commissionEarnedAt && !order.commissionPaidAt)));
  if (!validOrders || currentOrders.reduce((sum, order) => sum + Number(order?.commissionAmount || 0), 0) !== request.amount) {
    throw new Error('تغيّر استحقاق إحدى الطلبيات. لا تسجّل الصرف؛ ألغِ طلب السحب ثم أنشئ طلبًا جديدًا بالمبلغ الصحيح.');
  }
  if (request.status === 'pending') {
    const locked = await ordersStore().setJSON(key, { ...request, status: 'processing', transferReference: reference }, { onlyIfMatch: entry.etag });
    if (!locked.modified) throw new Error('تغير طلب السحب. حدّث الصفحة وحاول مجددًا.');
  } else if (request.transferReference !== reference) throw new Error('أكمل السحب بنفس سند الصرف المسجل.');
  let count = 0;
  let amount = 0;
  const paidAt = new Date().toISOString();
  for (const orderId of request.orderIds) {
    const orderEntry = await readOrder(orderId);
    const order = orderEntry?.data;
    if (!order || order.agentId !== request.agentId) continue;
    if (order.commissionPaidAt && order.payoutRequestId === id) { count++; amount += Number(order.commissionAmount || 0); continue; }
    if (order.commissionPaidAt || order.status !== 'delivered' || !order.commissionEarnedAt) continue;
    const saved = await updateOrder(orderId, { commissionPaidAt: paidAt, payoutRequestId: id }, orderEntry.etag);
    if (saved.commissionPaidAt && saved.payoutRequestId === id) { count++; amount += Number(saved.commissionAmount || 0); }
  }
  const current = await ordersStore().getWithMetadata(key);
  const completed = { ...current.data, status: 'completed', completedAt: new Date().toISOString(),
    paidAmount: amount, paidOrders: count, transferReference: reference };
  const result = await ordersStore().setJSON(key, completed, { onlyIfMatch: current.etag });
  if (!result.modified) throw new Error('تعذر إغلاق طلب السحب. أعد المحاولة بنفس سند الصرف.');
  try { await createRecipientNotification(request.agentId, `payout-paid:${id}`, { kind: 'payout_paid',
    title: 'تم تسجيل صرف عمولتك', body: `${amount} د.ل · سند ${reference}` }); }
  catch (error) { console.error('Payout paid notification failed', error instanceof Error ? error.message : error); }
  return completed;
}

export async function cancelPayout(id, actor) {
  const key = requestKey(id);
  const entry = await ordersStore().getWithMetadata(key);
  if (!entry || (actor.role !== 'admin' && entry.data.agentId !== actor.id)) throw new Error('طلب السحب غير موجود.');
  if (entry.data.status !== 'pending') throw new Error('لا يمكن إلغاء طلب بعد بدء تسجيل الصرف.');
  const cancelled = { ...entry.data, status: 'cancelled', cancelledAt: new Date().toISOString() };
  const saved = await ordersStore().setJSON(key, cancelled, { onlyIfMatch: entry.etag });
  if (!saved.modified) throw new Error('تغيّر طلب السحب. حدّث الصفحة.');
  try {
    await createRecipientNotification(entry.data.agentId, `payout-cancelled:${id}`, { kind: 'payout_cancelled',
      title: 'أُلغي طلب السحب', body: 'يمكنك مراجعة الرصيد وطلب السحب من جديد.' });
    if (actor.role !== 'admin') await createAdminNotification(`payout-cancelled:${id}`, { kind: 'payout_cancelled',
      title: `ألغت ${entry.data.agentName} طلب السحب`, body: 'يمكن مراجعة الطلبات والعمولات في المالية.' });
  } catch (error) { console.error('Payout cancellation notification failed', error instanceof Error ? error.message : error); }
  return cancelled;
}
