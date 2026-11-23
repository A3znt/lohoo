import { confirmationFields } from '../shared/confirmation.mjs';
import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { binding, ordersStore as getCloudflareStore } from './runtime.mjs';
import { carrierEvent, createAdminNotification, createCarrierNotification } from './notifications.mjs';
import { allocateOrderCode } from './order-codes.mjs';

const DARB_BASE = 'https://v2.sabil.ly';
const RESALA_BASE = 'https://dev.resala.ly/api/v1';
const COOKIE = 'daftar_session';
const THIRTY_DAYS = 30 * 24 * 60 * 60;
export const COMMISSION_LYD = 15;

export function env(name) { return binding(name) || ''; }
export function resalaReady() {
  return Boolean(env('RESALA_API_KEY') && (env('RESALA_CONFIRM_ADDRESS_TEMPLATE_ID') || env('RESALA_CONFIRM_DETAILED_TEMPLATE_ID') || env('RESALA_CONFIRM_TEMPLATE_ID'))
    && (env('RESALA_ON_WAY_DETAILED_TEMPLATE_ID') || env('RESALA_ON_WAY_TEMPLATE_ID')));
}
export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function equal(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return right.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
function signature(value) { return createHmac('sha256', env('APP_TOKEN')).update(value).digest('hex'); }
export function adminPasswordValid(password) {
  if (typeof password !== 'string') return false;
  const salt = env('ADMIN_PASSWORD_SALT');
  const hash = env('ADMIN_PASSWORD_HASH');
  if (salt && hash) return equal(scryptSync(password, salt, 64).toString('hex'), hash);
  return equal(password, env('APP_TOKEN'));
}
export function sessionCookie(token) {
  if (!adminPasswordValid(token)) return null;
  const expires = Math.floor(Date.now() / 1000) + THIRTY_DAYS;
  const value = `${expires}.${signature(String(expires))}`;
  return `${COOKIE}=${value}; Max-Age=${THIRTY_DAYS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookie() { return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
export function isAuthenticated(request) {
  if (!env('APP_TOKEN')) return false;
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer && equal(bearer, env('APP_TOKEN'))) return true;
  const cookies = request.headers.get('Cookie') || '';
  const value = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [expires, mac] = value.split('.');
  return /^\d{10}$/.test(expires || '') && Number(expires) > Date.now() / 1000 && equal(mac, signature(expires));
}
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}
export function phone(value, plus = false) {
  const digits = String(value || '').replace(/[\s()+-]/g, '');
  let local;
  if (/^0(?:91|92|93|94)\d{7}$/.test(digits)) local = digits.slice(1);
  else if (/^218(?:91|92|93|94)\d{7}$/.test(digits)) local = digits.slice(3);
  else throw new Error('رقم الهاتف لازم يكون ليبي مثل 0912345678.');
  return `${plus ? '+' : ''}218${local}`;
}
export function validateOrder(input) {
  if (!input || typeof input !== 'object') throw new Error('بيانات الطلب ناقصة.');
  const required = ['customer', 'city', 'area', 'address'];
  const result = {};
  for (const key of required) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`الحقل ${key} مطلوب.`);
    result[key] = input[key].trim().slice(0, 160);
  }
  result.phone = phone(input.phone);
  const extra = input.additionalPhones ?? [];
  if (!Array.isArray(extra) || extra.length > 4) throw new Error('يمكن إضافة حتى أربعة أرقام هاتف إضافية.');
  result.additionalPhones = extra.map((value) => phone(value));
  if (new Set([result.phone, ...result.additionalPhones]).size !== result.additionalPhones.length + 1) {
    throw new Error('أرقام الهاتف يجب أن تكون مختلفة.');
  }
  result.source = input.source === 'instagram' ? 'instagram' : 'facebook';
  result.notes = String(input.notes || '').trim().slice(0, 500);
  const rawItems = Array.isArray(input.items) && input.items.length ? input.items : [input];
  if (rawItems.length > 8) throw new Error('يمكن إضافة حتى ثمانية منتجات في الطلب الواحد.');
  result.items = rawItems.map((item, index) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error(`كمية المنتج ${index + 1} غير صحيحة.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10000000) throw new Error(`سعر المنتج ${index + 1} غير صحيح.`);
    return { product: String(item.product || input.product || '').trim().slice(0, 160), quantity, unitPrice,
      warehouseProductId: String(item.warehouseProductId || ''), warehouseVariantId: String(item.warehouseVariantId || '') };
  });
  result.product = result.items[0].product;
  result.quantity = result.items[0].quantity;
  result.unitPrice = result.items[0].unitPrice;
  result.deliveryFee = Number(input.deliveryFee || 0);
  result.paid = Number(input.paid || 0);
  result.weightKg = input.weightKg === undefined || input.weightKg === '' ? 0 : Number(input.weightKg);
  for (const key of ['deliveryFee', 'paid']) {
    if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 10000000) throw new Error('المبلغ غير صحيح.');
  }
  if (!Number.isFinite(result.weightKg) || result.weightKg < 0 || result.weightKg > 1000 || Number(result.weightKg.toFixed(2)) !== result.weightKg) {
    throw new Error('الوزن يجب أن يكون بالكيلو، بين 0 و1000، وحتى منزلتين عشريتين.');
  }
  return result;
}
export function orderItems(order) {
  return Array.isArray(order.items) && order.items.length ? order.items : [order];
}
export function productSubtotal(order) {
  return orderItems(order).reduce((total, item) => total + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0);
}
export function ordersStore() { return getCloudflareStore(); }
export const orderKey = (id) => `orders/${id}`;
export function orderNumberFromId(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id || ''))) throw new Error('معرّف الطلب غير صحيح.');
  return (BigInt(`0x${id.replaceAll('-', '')}`) % 1000000000000n).toString().padStart(12, '0');
}
export function shipmentNotes(order) {
  const enteredBy = String(order.createdByName || 'غير مسجل').trim().slice(0, 80);
  return [`رقم الطلب: ${order.orderNumber || orderNumberFromId(order.id)}`, `أُدخل بواسطة: ${enteredBy}`,
    ...(Number(order.weightKg) > 0 ? [`الوزن التقريبي: ${Number(order.weightKg)} كجم`] : []),
    ...(order.notes ? [`ملاحظات: ${String(order.notes).trim()}`] : [])].join(' | ').slice(0, 500);
}
export async function readOrder(id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) return null;
  return ordersStore().getWithMetadata(orderKey(id), { type: 'json' });
}
export async function updateOrder(id, change, expectedEtag) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await readOrder(id);
    if (!entry) throw new Error('الطلب غير موجود.');
    if (expectedEtag && entry.etag !== expectedEtag) throw new Error("تغير الطلب. افتح تفاصيله مجددًا.");
    if (change.agentId !== undefined && entry.data.commissionEarnedAt && change.agentId !== entry.data.agentId) {
      throw new Error('لا يمكن نقل الطلب بعد استحقاق العمولة.');
    }
    if (change.commissionPaidAt && entry.data.commissionPaidAt) throw new Error('هذه العمولة مسجلة كمدفوعة بالفعل.');
    if (change.status === 'creating' && entry.data.status !== 'attention') throw new Error('الطلب قيد المعالجة بالفعل.');
    const now = new Date().toISOString();
    const next = { ...entry.data, ...change, updatedAt: now };
    if (next.status === 'delivered' && next.agentId && !next.commissionEarnedAt) {
      next.commissionAmount = COMMISSION_LYD;
      next.commissionEarnedAt = now;
    }
    const result = await ordersStore().setJSON(orderKey(id), next, { onlyIfMatch: entry.etag });
    if (result.modified) return next;
  }
  throw new Error('تغيّر الطلب أثناء الحفظ. جرّب مرة ثانية.');
}
export async function listOrders() {
  const rows = (await ordersStore().listValues({ prefix: 'orders/' })).map(({ value }) => value);
  return rows.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function settings() {
  return await ordersStore().get('settings/default', { type: 'json' }) || { serviceId: '', autoMessages: true };
}
export async function saveSettings(value) {
  const next = { serviceId: String(value.serviceId || '').trim(), autoMessages: value.autoMessages !== false };
  if (next.serviceId && !/^[\w-]{1,100}$/.test(next.serviceId)) throw new Error('باقة التوصيل غير صالحة.');
  await ordersStore().setJSON('settings/default', next);
  return next;
}
export async function darb(method, path, body) {
  const key = env('DARB_API_KEY');
  const accountId = env('DARB_ACCOUNT_ID');
  if (!key || !accountId) throw new Error('ربط درب السبيل غير مكتمل على الخادم.');
  let response;
  try {
    response = await fetch(new URL(path, DARB_BASE), {
      method,
      headers: { Authorization: `apikey ${key}`, 'X-API-VERSION': '1.0.0', 'X-ACCOUNT-ID': accountId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new Error('اتصال درب السبيل غير مؤكد. راجع لوحة الشركة قبل إعادة الإرسال.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== true) {
    const issue = result.messages?.[0];
    throw new Error(`${issue?.message || `Darb HTTP ${response.status}`}${issue?.location ? ` (${issue.location})` : ''}`);
  }
  return result.data;
}
export function warehouseProductView(product) {
  return {
    id: String(product._id || ''), name: String(product.productName || ''),
    salePrice: Number(product.salePrice || 0), currency: String(product.currency || 'lyd'),
    isPublished: Boolean(product.isPublished), isReviewed: Boolean(product.isReviewed), isBlocked: Boolean(product.isBlocked),
    variants: (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
      id: String(variant._id || ''), sku: String(variant.sku || ''),
      attributes: (Array.isArray(variant.attributes) ? variant.attributes : []).map(({ key, value }) => ({ key: String(key || ''), value: String(value || '') })),
      widthCM: Number(variant.width || 0), heightCM: Number(variant.height || 0), lengthCM: Number(variant.length || 0),
      isFragile: Boolean(variant.isFragile), allowInspection: Boolean(variant.allowInspection), allowTesting: Boolean(variant.allowTesting),
    })),
  };
}
export async function listWarehouseProducts() {
  const products = new Map();
  const pageSize = 10;
  let duplicatePages = 0;
  for (let offset = 0; offset < 1000;) {
    const data = await darb('GET', `/api/warehouse/products/?offset=${offset}&limit=${pageSize}`);
    const page = Array.isArray(data?.results) ? data.results : [];
    let added = 0;
    for (const raw of page) {
      const product = warehouseProductView(raw);
      if (!product.id || products.has(product.id)) continue;
      products.set(product.id, product);
      added += 1;
    }
    duplicatePages = added === 0 ? duplicatePages + 1 : 0;
    if (page.length < pageSize || duplicatePages >= 2) break;
    offset += page.length;
  }
  return [...products.values()];
}
export function deliveryLocationsView(data) {
  const cities = new Map();
  for (const branch of (Array.isArray(data?.results) ? data.results : [])) {
    if (branch.countryCode !== 'lby' || !branch.city) continue;
    const city = String(branch.city).trim();
    if (!cities.has(city)) cities.set(city, new Set());
    const areas = cities.get(city);
    if (branch.area) areas.add(String(branch.area).trim());
    for (const item of (Array.isArray(branch.areas) ? branch.areas : [])) {
      if (item.area) areas.add(String(item.area).trim());
    }
  }
  return [...cities.entries()].map(([city, areas]) => ({ city, areas: [...areas].sort((a, b) => a.localeCompare(b, 'ar')) }))
    .sort((a, b) => a.city.localeCompare(b.city, 'ar'));
}
export async function listDeliveryLocations() {
  return deliveryLocationsView(await darb('GET', '/api/local/branches/public'));
}
export function shippingComponents(estimate) {
  const invoices = Array.isArray(estimate?.invoices) ? estimate.invoices : [];
  const items = invoices.flatMap((invoice) => Array.isArray(invoice.items) ? invoice.items : [])
    .filter((item) => item.type === 'shipping' && String(item.currency).toLowerCase() === 'lyd')
    .map((item) => {
      const amount = Number(item.amount) * Number(item.quantity ?? 1);
      const description = String(item.description || '').trim();
      const label = amount < 0 ? (description && !description.startsWith('خصم') ? `خصم · ${description}` : description || 'خصم التوصيل')
        : description || 'رسوم التوصيل';
      return { label, amount };
    });
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (!items.length || items.some((item) => !Number.isFinite(item.amount)) || !Number.isFinite(total) || total < 0) {
    throw new Error('درب السبيل لم يرجع سعر توصيل واضحًا بالدينار.');
  }
  return items;
}
export function shippingFeeFromEstimate(estimate) {
  return shippingComponents(estimate).reduce((sum, item) => sum + item.amount, 0);
}
export function ensureValidCollection(paid, unitPrice, quantity, deliveryFee, items) {
  const subtotal = Array.isArray(items) && items.length ? productSubtotal({ items }) : unitPrice * quantity;
  if (paid > subtotal + deliveryFee + 0.001) {
    throw new Error('المبلغ المحصّل أكبر من إجمالي الطلب مع التوصيل.');
  }
}
export async function quoteOrder(input) {
  const clean = validateOrder(input);
  const config = await settings();
  const service = String(input.serviceId || config.serviceId || '').trim();
  if (!/^[\w-]{1,100}$/.test(service)) throw new Error('اختار خدمة التوصيل أولًا.');
  const locations = await listDeliveryLocations();
  if (!locations.some((location) => location.city === clean.city && location.areas.includes(clean.area))) {
    throw new Error('اختار المدينة والمنطقة من قائمة درب السبيل.');
  }
  clean.items = await Promise.all(clean.items.map(async (line) => {
    const { product, variant } = await warehouseSelection(line.warehouseProductId, line.warehouseVariantId);
    return { product: `${product.name} - ${variant.sku}`, warehouseProductId: product.id,
      warehouseVariantId: variant.id, quantity: line.quantity, unitPrice: line.unitPrice,
      sku: variant.sku, variantAttributes: variant.attributes,
      widthCM: variant.widthCM, heightCM: variant.heightCM, lengthCM: variant.lengthCM,
      isFragile: variant.isFragile, allowInspection: variant.allowInspection, allowTesting: variant.allowTesting };
  }));
  Object.assign(clean, clean.items[0]);
  const estimate = await darb('POST', '/api/local/shipments/calculate/shipping/', shipmentInput(clean, service));
  return { clean, service, estimate, deliveryFee: shippingFeeFromEstimate(estimate) };
}
export async function warehouseSelection(productId, variantId) {
  if (!/^[a-f0-9]{24}$/.test(productId || '') || !/^[a-f0-9]{24}$/.test(variantId || '')) throw new Error('اختار المنتج والقياس من مخزون درب السبيل.');
  const data = await darb('GET', `/api/warehouse/products/${productId}`);
  const product = data?.results?.[0];
  if (!product || product._id !== productId || !product.isPublished || product.isBlocked) throw new Error('المنتج لم يعد متاحًا في مخزون درب السبيل.');
  const selected = warehouseProductView(product);
  const variant = selected.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('القياس المختار لم يعد متاحًا في درب السبيل.');
  return { product: selected, variant };
}
export function shipmentInput(order, service) {
  return {
    service, paymentBy: 'receiver',
    to: { countryCode: 'lby', city: order.city, area: order.area, address: order.address },
    products: orderItems(order).map((item) => ({ warehouseProduct: item.warehouseProductId, warehouseProductVariant: item.warehouseVariantId,
      sku: item.sku, title: item.product, quantity: item.quantity, amount: item.unitPrice, currency: 'lyd', isChargeable: true,
      widthCM: item.widthCM, heightCM: item.heightCM, lengthCM: item.lengthCM,
      isFragile: item.isFragile, allowInspection: item.allowInspection, allowTesting: item.allowTesting })),
  };
}
export async function createOrder(input, assignedAgent = null, creator = null) {
  const id = /^[a-f0-9-]{36}$/.test(input.id || '') ? input.id : randomUUID();
  const existing = await readOrder(id);
  if (existing) return existing.data;
  const { clean, service, estimate, deliveryFee } = await quoteOrder(input);
  ensureValidCollection(clean.paid, clean.unitPrice, clean.quantity, deliveryFee, clean.items);
  clean.deliveryFee = deliveryFee;
  const config = await settings();
  const orderNumber = await allocateOrderCode(creator);
  const now = new Date().toISOString();
  const initial = { id, orderNumber, ...clean,
    createdById: creator?.id || 'admin', createdByName: creator?.name || 'المدير',
    agentId: assignedAgent?.id || '', agentName: assignedAgent?.name || '',
    commissionAmount: 0, commissionEarnedAt: '', commissionPaidAt: '',
    serviceId: service, status: 'creating', shipmentReference: '', shippingPrice: estimate,
    darbStatus: '', shippingError: '', confirmationSms: 'pending', onWaySms: 'pending', createdAt: now, updatedAt: now };
  const created = await ordersStore().setJSON(orderKey(id), initial, { onlyIfNew: true });
  if (!created.modified) return (await readOrder(id))?.data;
  return submitShipment(id, clean, service, estimate, config);
}
async function submitShipment(id, clean, service, estimate, config) {
  const core = shipmentInput(clean, service);
  try {
    const phones = [clean.phone, ...clean.additionalPhones];
    const stored = (await readOrder(id))?.data;
    const contactIds = [...(stored?.contactIds || (stored?.contactId ? [stored.contactId] : []))];
    for (let index = contactIds.length; index < phones.length; index++) {
      const contact = await darb('POST', '/api/contacts/', { name: clean.customer, phone: phone(phones[index], true) });
      if (!contact?._id) throw new Error('درب السبيل ما رجّعش رقم جهة الاتصال.');
      contactIds.push(contact._id);
      await updateOrder(id, { contactId: contactIds[0], contactIds });
    }
    let shipment;
    try {
      const order = (await readOrder(id))?.data;
      shipment = await darb('POST', '/api/local/shipments/', { ...core, contacts: contactIds, notes: shipmentNotes(order) });
    } catch (error) {
      await updateOrder(id, { status: 'attention', shippingError: `قد تكون الشحنة أُنشئت. ${error.message}` });
      return (await readOrder(id)).data;
    }
    if (!shipment?.reference) throw new Error('الشحنة أُرسلت لكن رقم التتبع لم يرجع. راجع لوحة درب السبيل.');
    const updated = await updateOrder(id, { status: 'confirmed', shipmentReference: String(shipment.reference), shipmentId: String(shipment._id || ''),
      shippingPrice: estimate, darbStatus: String(shipment.status || 'pending') });
    if (config.autoMessages) {
      try { await sendStageSms(id, 'confirmation'); }
      catch (error) { await updateOrder(id, { confirmationSms: 'failed', confirmationSmsError: error.message || 'تعذر إرسال الرسالة.' }); }
    }
    return (await readOrder(id))?.data || updated;
  } catch (error) {
    return updateOrder(id, { status: 'attention', shippingError: error.message || 'تعذر إنشاء الشحنة.' });
  }
}
export async function retryShipment(id, destination = {}) {
  const entry = await readOrder(id);
  if (!entry || entry.data.status !== 'attention' || entry.data.shipmentReference) throw new Error('هذا الطلب غير متاح لإعادة الإرسال.');
  if (!/Unexpected property has been encountered!|Unable to fetch branch/.test(entry.data.shippingError || '')) {
    throw new Error('حالة الشحنة غير مؤكدة. راجع درب السبيل قبل إعادة الإرسال.');
  }
  const input = { ...entry.data, city: destination.city || entry.data.city,
    area: destination.area || entry.data.area, address: destination.address || entry.data.address };
  const { clean, service, estimate, deliveryFee } = await quoteOrder(input);
  ensureValidCollection(entry.data.paid, clean.unitPrice, clean.quantity, deliveryFee, clean.items);
  clean.deliveryFee = deliveryFee;
  await updateOrder(id, { status: 'creating', shippingError: '', city: clean.city, area: clean.area,
    address: clean.address, deliveryFee, shippingPrice: estimate });
  return submitShipment(id, clean, service, estimate, await settings());
}
export function smsTemplateRecord(order, stage, detailed = false) {
  const base = { phone: phone(order.phone), $1: order.orderNumber || orderNumberFromId(order.id) };
  if (detailed) {
    const sku = String(order.sku || '').trim();
    const rawProduct = String(order.product || '').trim();
    const firstProduct = sku && rawProduct.endsWith(` - ${sku}`) ? rawProduct.slice(0, -sku.length - 3) : rawProduct;
    const extraCount = orderItems(order).length - 1;
    const product = extraCount ? `${firstProduct} +${extraCount}` : firstProduct;
    const total = (productSubtotal(order) + Number(order.deliveryFee || 0)).toFixed(2).replace(/\.00$/, '');
    Object.assign(base, { $2: product.length > 20 ? `${product.slice(0, 19).trimEnd()}…` : product, $3: sku, $4: total });
    if (stage === 'onWay') base.$5 = String(order.shipmentReference || '');
  } else if (stage === 'onWay') base.$2 = order.shipmentReference;
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith('$') && String(value || '').length > 20) throw new Error(`${key} يتجاوز حد 20 حرفًا في قالب رِسالة.`);
  }
  return base;
}
export async function sendStageSms(id, stage) {
  const field = stage === 'confirmation' ? 'confirmationSms' : 'onWaySms';
  const entry = await readOrder(id);
  if (!entry) throw new Error('الطلب غير موجود.');
  const order = entry.data;
  if (order.carrierDeletedAt || order.deletedAt || order.darbStatus === 'not_found' ||
    !['pending', 'needs_key'].includes(order[field])) return order;
  const detailedId = env(stage === 'confirmation' ? 'RESALA_CONFIRM_DETAILED_TEMPLATE_ID' : 'RESALA_ON_WAY_DETAILED_TEMPLATE_ID');
  const addressTemplate = stage === 'confirmation' && env('RESALA_CONFIRM_ADDRESS_TEMPLATE_ID');
  const templateId = addressTemplate || detailedId || env(stage === 'confirmation' ? 'RESALA_CONFIRM_TEMPLATE_ID' : 'RESALA_ON_WAY_TEMPLATE_ID');
  if (!env('RESALA_API_KEY') || !templateId) return updateOrder(id, { [field]: 'needs_key' });
  let record;
  try {
    if (addressTemplate) {
      const fields = confirmationFields(order);
      if (!fields.$6 || fields.$6.length > 20) throw new Error('كود درب السبيل غير صالح لقالب رِسالة.');
      for (const key of ['$1', '$2', '$4', '$5']) {
        if (fields[key].length > 20) fields[key] = fields[key].slice(0, 19).trimEnd() + '…';
      }
      record = { phone: phone(order.phone), ...fields };
    } else record = smsTemplateRecord(order, stage, Boolean(detailedId));
  }
  catch (error) { return updateOrder(id, { [field]: 'failed', [`${field}Error`]: error.message }); }
  const marked = await ordersStore().setJSON(orderKey(id), { ...order, [field]: 'sending', [`${field}StartedAt`]: new Date().toISOString(), updatedAt: new Date().toISOString() }, { onlyIfMatch: entry.etag });
  if (!marked.modified) return (await readOrder(id))?.data;
  const uncertain = async () => {
    const saved = await updateOrder(id, { [field]: 'unknown' });
    try {
      await createAdminNotification(`sms-unknown:${id}:${field}`, { kind: 'sms_alert', orderId: id,
        title: 'حالة الرسالة غير مؤكدة',
        body: `تحقق من سجل رِسالة للطلب ${order.orderNumber || orderNumberFromId(id)} قبل إعادة ${stage === 'confirmation' ? 'التأكيد' : 'رسالة الطريق'}؛ قد تكون وصلت.` });
    } catch (error) { console.error('SMS uncertainty notification failed', id, error instanceof Error ? error.message : error); }
    return saved;
  };
  let response;
  try {
    response = await fetch(`${RESALA_BASE}/messages/send-template?sms_template_id=${encodeURIComponent(templateId)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${env('RESALA_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [record] }),
    });
  } catch { return uncertain(); }
  const payload = await response.json().catch(() => null);
  if (response.status >= 500 || (response.ok && !payload)) return uncertain();
  if (!response.ok || payload?.failed > 0 || payload?.invalid_numbers?.length || payload?.failed_numbers?.length) {
    const errorType = payload?.type || `HTTP ${response.status}`;
    const failed = await updateOrder(id, { [field]: 'failed', [`${field}Error`]: errorType });
    if (errorType === 'InsufficientCredit') {
      try {
        await createAdminNotification(`sms-credit:${id}:${field}`, { kind: 'sms_alert', orderId: id,
          title: 'رصيد رِسالة غير كافٍ',
          body: `تعذّر إرسال ${stage === 'confirmation' ? 'تأكيد' : 'تحديث'} الطلب ${order.orderNumber || orderNumberFromId(id)}. اشحن الرصيد ثم أعد الإرسال من تفاصيل الطلب.` });
      } catch (error) { console.error('SMS credit notification failed', id, error instanceof Error ? error.message : error); }
    }
    return failed;
  }
  if (payload?.succeeded !== 1 || payload?.failed !== 0) return uncertain();
  return updateOrder(id, { [field]: 'sent', [`${field}Id`]: payload.sms_template_version?.id || '' });
}
export function resalaDeliveryStatus(rows, order, stage) {
  const numbers = [order.orderNumber || orderNumberFromId(order.id), order.legacyOrderNumber, order.id.slice(0, 8)].filter(Boolean);
  const matching = (Array.isArray(rows) ? rows : []).find((item) => {
    const content = String(item.content || '');
    if (content.includes('تم تأكيد طلبيتك:') && content.includes('كود الطلبية الخاص بدرب السبيل:')) {
      return stage === 'confirmation' && Boolean(order.shipmentReference) && content.split('كود الطلبية الخاص بدرب السبيل:')[1].trim().split(/\s/)[0] === order.shipmentReference;
    }
    return numbers.some((number) => content.includes(number)) && (stage === 'onWay'
      ? Boolean(order.shipmentReference && content.includes(order.shipmentReference))
      : !order.shipmentReference || !content.includes(order.shipmentReference));
  });
  return ['delivered', 'undelivered', 'failed'].includes(matching?.status) ? matching.status : null;
}
export async function syncSmsDelivery(id) {
  const entry = await readOrder(id);
  if (!entry || !env('RESALA_API_KEY') || !['confirmationSms', 'onWaySms'].some((field) => entry.data[field] === 'sent')) return entry?.data || null;
  const order = entry.data;
  const change = {};
  for (const field of ['confirmationSms', 'onWaySms']) {
    const started = Date.parse(order[`${field}StartedAt`] || '');
    if (order[field] === 'sent' && Number.isFinite(started) && Date.now() - started > 3 * 24 * 60 * 60_000) {
      change[field] = 'unknown';
    }
  }
  if (!['confirmationSms', 'onWaySms'].some((field) => order[field] === 'sent' && !change[field])) {
    return Object.keys(change).length ? updateOrder(id, change) : order;
  }
  const url = new URL(`${RESALA_BASE}/sent-view`);
  url.searchParams.set('q', order.phone.slice(-9));
  url.searchParams.set('paginate', '20');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env('RESALA_API_KEY')}` } });
  if (!response.ok) return Object.keys(change).length ? updateOrder(id, change) : order;
  const payload = await response.json().catch(() => ({}));
  for (const [stage, field] of [['confirmation', 'confirmationSms'], ['onWay', 'onWaySms']]) {
    if (order[field] !== 'sent' || change[field]) continue;
    const status = resalaDeliveryStatus(payload.data, order, stage);
    if (status === 'delivered') change[field] = 'delivered';
    if (status === 'undelivered' || status === 'failed') {
      change[field] = 'failed';
      change[`${field}Error`] = 'Resala أبلغت بعدم وصول الرسالة.';
    }
  }
  return Object.keys(change).length ? updateOrder(id, change) : order;
}
export function isOnWayStatus(value) {
  const normalized = String(value || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_');
  return ['processing', 'shipped', 'in_transit', 'out_for_delivery', 'on_the_way', 'on_way', 'dispatched', 'with_driver',
    'في_الطريق', 'قيد_التوصيل', 'قيد_التسليم', 'خرج_للتوصيل', 'خرجت_للتوصيل', 'جاري_التوصيل'].includes(normalized);
}
export function isDeliveredStatus(value) {
  return ['completed', 'delivered', 'تم_التسليم'].includes(String(value || '').toLowerCase().replace(/[\s-]+/g, '_'));
}
export function exactShipment(payload, reference) {
  const rows = Array.isArray(payload) ? payload : payload?.results ?? [payload];
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter(row => row && String(row.reference) === String(reference));
  return matches.length === 1 ? matches[0] : null;
}

async function findStoredShipment(order) {
  const reference = String(order.shipmentReference || '');
  const listed = await darb('GET', `/api/local/shipments/?reference=${encodeURIComponent(reference)}`);
  const rows = Array.isArray(listed) ? listed : listed?.results;
  if (!Array.isArray(rows)) throw new Error('درب السبيل لم يرجع قائمة شحنات واضحة. لم نغيّر الطلب.');
  const matches = rows.filter((row) => String(row?.reference) === reference);
  if (matches.length > 1 || (rows.length > 0 && matches.length !== 1)) {
    throw new Error('تعذر مطابقة الشحنة في درب السبيل. لم نغيّر الطلب.');
  }
  let record = matches[0] || null;
  if (!record && /^[a-f0-9]{24}$/i.test(order.shipmentId || '')) {
    const detail = await darb('GET', `/api/local/shipments/${order.shipmentId}`);
    const directRows = Array.isArray(detail) ? detail : detail?.results;
    if (!Array.isArray(directRows)) throw new Error('درب السبيل لم يؤكد غياب الشحنة. لم نغيّر الطلب.');
    if (directRows.length > 0) record = exactShipment(detail, reference);
    if (directRows.length > 0 && !record) throw new Error('الشحنة ما زالت موجودة في درب السبيل ببيانات مختلفة. لم نغيّر الطلب.');
  }
  if (record && (!/^[a-f0-9]{24}$/i.test(record._id) || (order.shipmentId && record._id !== order.shipmentId))) {
    throw new Error('معرّف الشحنة في درب السبيل لا يطابق طلب ركن. لم نغيّر الطلب.');
  }
  return record;
}

export async function editPendingShipment(id, form, expectedVersion, isAdmin) {
  const entry = await readOrder(id);
  if (!entry || entry.data.deletedAt || entry.data.status !== 'confirmed' || !entry.data.shipmentReference || entry.data.carrierDeletedAt) {
    throw new Error('تعديل الشحنة متاح قبل خروجها للتوصيل فقط.');
  }
  const order = entry.data;
  if (order.updatedAt !== expectedVersion) throw new Error('تغيّر الطلب. افتح تفاصيله مجددًا.');
  const listed = await darb('GET', `/api/local/shipments/?reference=${encodeURIComponent(order.shipmentReference)}`);
  const record = exactShipment(listed, order.shipmentReference);
  if (!record || !/^[a-f0-9]{24}$/i.test(record._id) || (order.shipmentId && record._id !== order.shipmentId)) {
    throw new Error('تعذر تأكيد الشحنة في درب السبيل. لم نحفظ أي تعديل.');
  }
  if (String(record.status).toLowerCase() !== 'pending') throw new Error('درب السبيل يسمح بتعديل الشحنات المعلّقة فقط.');
  const { clean, service, estimate, deliveryFee } = await quoteOrder({ ...order, ...form });
  const paid = isAdmin ? clean.paid : order.paid;
  ensureValidCollection(paid, clean.unitPrice, clean.quantity, deliveryFee, clean.items);
  const oldPhones = [order.phone, ...(order.additionalPhones || [])];
  const oldIds = order.contactIds || (order.contactId ? [order.contactId] : []);
  const phones = [clean.phone, ...clean.additionalPhones];
  const contactIds = [];
  for (let index = 0; index < phones.length; index++) {
    if (clean.customer === order.customer && oldPhones[index] === phones[index] && oldIds[index]) {
      contactIds.push(oldIds[index]);
      continue;
    }
    const contact = await darb('POST', '/api/contacts/', { name: clean.customer, phone: phone(phones[index], true) });
    if (!contact?._id) throw new Error('درب السبيل لم يرجع معرّف الزبون. لم نعدّل الشحنة.');
    contactIds.push(contact._id);
  }
  const latest = await readOrder(id);
  if (!latest || latest.etag !== entry.etag) throw new Error('تغيّر الطلب أثناء المراجعة. افتحه مجددًا.');
  const next = { ...order, ...clean, serviceId: service, deliveryFee, paid };
  const changed = await darb('PATCH', `/api/local/shipments/${record._id}`, {
    ...shipmentInput(next, service), contacts: contactIds, notes: shipmentNotes(next),
  });
  if (changed?.reference && String(changed.reference) !== order.shipmentReference) {
    throw new Error('استجابة درب السبيل لم تطابق رقم الشحنة. راجعها قبل إعادة المحاولة.');
  }
  return updateOrder(id, { ...clean, serviceId: service, deliveryFee, paid, shippingPrice: estimate, contactId: contactIds[0], contactIds,
    shipmentId: record._id, darbStatus: 'pending' }, entry.etag);
}

export async function removeOrder(id) {
  const entry = await readOrder(id);
  if (!entry) throw new Error('الطلب غير موجود.');
  const order = entry.data;
  if (order.status === 'creating') throw new Error('انتظر اكتمال إنشاء الشحنة.');
  if (order.carrierDeletedAt) return updateOrder(id, { deletedAt: new Date().toISOString() });
  if (!order.shipmentReference) {
    if (order.status !== 'attention' || !/Unexpected property has been encountered!|Unable to fetch branch/.test(order.shippingError || '')) {
      throw new Error('تعذر تحديد الشحنة. راجع درب السبيل قبل الحذف.');
    }
    return updateOrder(id, { deletedAt: new Date().toISOString() }, entry.etag);
  }
  const record = await findStoredShipment(order);
  if (record) await darb('DELETE', '/api/local/shipments/' + record._id);
  const now = new Date().toISOString();
  return updateOrder(id, { deletedAt: now, carrierDeletedAt: now, status: 'cancelled',
    darbStatus: record ? 'deleted' : 'already_deleted', shippingError: '' });
}

export async function syncOrder(id, { requireFound = false } = {}) {
  const entry = await readOrder(id);
  if (!entry?.data?.shipmentReference || !['confirmed', 'on_way', 'postponed', 'delivery_failed'].includes(entry.data.status)) return entry?.data || null;
  const record = await findStoredShipment(entry.data);
  const status = String(record?.status || '');
  if (!record) {
    if (requireFound) throw new Error('تعذر العثور على الشحنة في درب السبيل. لم نعتبرها مُراجَعة.');
    if (entry.data.darbStatus === 'not_found') return entry.data;
    const updated = await updateOrder(id, { status: 'attention', darbStatus: 'not_found',
      shippingError: 'لم تعد الشحنة موجودة في درب السبيل. يمكنك حذف سجل الطلب من ركن بعد التحقق.' });
    try {
      await createAdminNotification(`missing-shipment:${id}`, { kind: 'order_attention', orderId: id,
        title: `شحنة غير موجودة للطلب ${updated.orderNumber || orderNumberFromId(id)}`,
        body: 'درب السبيل لم يجد الشحنة برقم التتبع أو معرّفها. راجع الطلب ثم احذف سجله من ركن إذا كانت محذوفة هناك.' });
    } catch (error) { console.error('Missing shipment notification failed', id, error instanceof Error ? error.message : error); }
    return updated;
  }
  if (!status) {
    if (requireFound) throw new Error('درب السبيل لم يرجع حالة الشحنة. لم نعتبرها مُراجَعة.');
    return entry.data;
  }
  const latest = (await readOrder(id))?.data;
  if (!latest || latest.carrierDeletedAt) return latest;
  let event = carrierEvent(record);
  if (event && !event.reason) {
    try {
      const timeline = await darb('GET', `/api/local/shipments/timeline/${encodeURIComponent(entry.data.shipmentReference)}`);
      const rows = Array.isArray(timeline) ? timeline : timeline?.results;
      if (Array.isArray(rows)) event = carrierEvent({ ...record, timeline: rows }) || event;
    } catch { /* Some Darb accounts do not expose the timeline endpoint. */ }
  }
  const updates = {};
  if (status !== latest.darbStatus) updates.darbStatus = status;
  if (event && event.reason !== (latest.carrierReason || '')) updates.carrierReason = event.reason;
  if (event?.kind === 'postponed') updates.status = 'postponed';
  else if (event?.kind === 'delivery_failed') updates.status = 'delivery_failed';
  else if (event?.kind === 'cancelled') updates.status = 'cancelled';
  else if (isOnWayStatus(status) && latest.status !== 'on_way') updates.status = 'on_way';
  else if (status.toLowerCase() === 'pending' && ['postponed', 'delivery_failed'].includes(latest.status)) updates.status = 'confirmed';
  else if (isDeliveredStatus(status)) updates.status = 'delivered';
  else if (status.toLowerCase() === 'returned') updates.status = 'returned';
  if (updates.status === latest.status) delete updates.status;
  if (!event && latest.carrierReason && updates.status) updates.carrierReason = '';
  if (!Object.keys(updates).length) {
    if (event) {
      try { await createCarrierNotification(latest, event); }
      catch (error) { console.error(JSON.stringify({ event: 'notification_failed', message: String(error) })); }
    }
    return latest;
  }
  const saved = await updateOrder(id, updates, entry.etag);
  if (event && (updates.status || updates.carrierReason !== undefined)) {
    try { await createCarrierNotification({ ...latest, ...updates }, event); }
    catch (error) { console.error(JSON.stringify({ event: 'notification_failed', message: String(error) })); }
  }
  if (updates.status && ['on_way', 'delivered', 'returned', 'confirmed'].includes(updates.status)) {
    const titles = { on_way: 'الطلب في الطريق', delivered: 'تم تسليم الطلب', returned: 'الطلب مرتجع', confirmed: 'استؤنف الطلب' };
    try {
      await createAdminNotification(`carrier-status:${id}:${saved.updatedAt}`, { kind: 'carrier_status', orderId: id,
        title: `${titles[updates.status]} رقم ${saved.orderNumber || orderNumberFromId(id)}`,
        body: `${saved.customer} · درب السبيل ${saved.shipmentReference} · أُدخل بواسطة ${saved.createdByName || 'المدير'}` });
    } catch (error) { console.error('Carrier status notification failed', id, error instanceof Error ? error.message : error); }
  }
  if (updates.status === 'on_way' && (await settings()).autoMessages) await sendStageSms(id, 'onWay');
  return (await readOrder(id))?.data;
}

