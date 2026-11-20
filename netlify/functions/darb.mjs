import { timingSafeEqual } from 'node:crypto';

const BASE = 'https://v2.sabil.ly';

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authorized(request, token) {
  const actual = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const left = Buffer.from(actual);
  const right = Buffer.from(token || '');
  return right.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function phone(value) {
  const compact = String(value || '').replace(/[\s()-]/g, '');
  if (/^\+218\d{9}$/.test(compact)) return compact;
  if (/^0\d{9}$/.test(compact)) return `+218${compact.slice(1)}`;
  if (/^218\d{9}$/.test(compact)) return `+${compact}`;
  throw new Error('رقم الهاتف لازم يكون ليبي بصيغة +2189XXXXXXXX.');
}

function validOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('بيانات الطلب ناقصة.');
  for (const key of ['customer', 'city', 'area', 'product']) {
    if (typeof order[key] !== 'string' || !order[key].trim()) throw new Error(`الحقل ${key} مطلوب.`);
  }
  if (!Number.isInteger(order.quantity) || order.quantity < 1) throw new Error('الكمية غير صحيحة.');
  if (!Number.isFinite(order.unitPrice) || order.unitPrice < 0) throw new Error('السعر غير صحيح.');
  return { ...order, phone: phone(order.phone) };
}

async function darb(method, path, body) {
  const key = Netlify.env.get('DARB_API_KEY');
  const accountId = Netlify.env.get('DARB_ACCOUNT_ID');
  if (!key || !accountId) throw new Error('إعدادات درب السبيل غير مكتملة على الخادم.');
  const response = await fetch(new URL(path, BASE), {
    method,
    headers: {
      Authorization: `apikey ${key}`,
      'X-API-VERSION': '1.0.0',
      'X-ACCOUNT-ID': accountId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status === false) {
    const message = result.messages?.[0]?.message || `Darb HTTP ${response.status}`;
    throw new Error(message);
  }
  return result.data;
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request, Netlify.env.get('APP_TOKEN'))) return json({ ok: false, error: 'رمز التطبيق غير صحيح.' }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'طلب غير صالح.' }, 400); }
  try {
    if (input.action === 'packages') {
      return json({ ok: true, data: await darb('GET', '/api/local/service/rates/public/') });
    }
    if (input.action === 'timeline') {
      const reference = String(input.payload?.reference || '');
      if (!/^[\w-]{1,64}$/.test(reference)) throw new Error('رقم التتبع غير صالح.');
      return json({ ok: true, data: await darb('GET', `/api/local/shipments/timeline/${encodeURIComponent(reference)}`) });
    }
    if (input.action === 'calculate') {
      const order = validOrder(input.payload?.order);
      const service = String(input.payload?.service || '');
      if (!/^[\w-]{1,100}$/.test(service)) throw new Error('اختار باقة التوصيل أولًا.');
      return json({ ok: true, data: await darb('POST', '/api/local/shipments/calculate/shipping/', {
        service, paymentBy: 'receiver',
        to: { countryCode: 'lby', city: order.city.trim(), area: order.area.trim(), address: String(order.address || '').trim() },
        products: [{ title: order.product.trim(), quantity: order.quantity, amount: order.unitPrice, currency: 'lyd', isChargeable: true }],
      }) });
    }
    if (input.action === 'createShipment') {
      const order = validOrder(input.payload?.order);
      const service = String(input.payload?.service || '');
      if (!/^[\w-]{1,100}$/.test(service)) throw new Error('اختار باقة التوصيل أولًا.');
      const core = {
        service, paymentBy: 'receiver',
        to: { countryCode: 'lby', city: order.city.trim(), area: order.area.trim(), address: String(order.address || '').trim() },
        products: [{ title: order.product.trim(), quantity: order.quantity, amount: order.unitPrice, currency: 'lyd', isChargeable: true }],
      };
      // Check the shipping price before creating the contact and shipment.
      const estimate = await darb('POST', '/api/local/shipments/calculate/shipping/', core);
      const contact = await darb('POST', '/api/contacts/', { name: order.customer.trim(), phone: order.phone });
      if (!contact?._id) throw new Error('درب السبيل ما رجّعش رقم جهة الاتصال.');
      const shipment = await darb('POST', '/api/local/shipments/', { ...core, contacts: [contact._id], notes: String(order.notes || '').trim() });
      if (!shipment?.reference) throw new Error('درب السبيل ما رجّعش رقم التتبع. راجع لوحة الشركة قبل إعادة الإرسال.');
      return json({ ok: true, data: { reference: shipment.reference, estimate } });
    }
    return json({ ok: false, error: 'إجراء غير معروف.' }, 400);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'تعذر الاتصال بدرب السبيل.' }, 400);
  }
}
