import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { adminPasswordValid, deliveryLocationsView, equal, isAuthenticated, isDeliveredStatus, isOnWayStatus, orderNumberFromId, phone, resalaDeliveryStatus, sameOrigin, sessionCookie, shipmentInput, shipmentNotes, shippingComponents, shippingFeeFromEstimate, smsTemplateRecord, validateOrder, warehouseProductView } from '../netlify/lib/core.mjs';
import { confirmationText } from '../shared/confirmation.mjs';
import auth from '../netlify/functions/auth.mjs';

const testEnv = { APP_TOKEN: 'a-secret-only-on-the-server', ADMIN_PASSWORD_SALT: 'test-salt',
  ADMIN_PASSWORD_HASH: scryptSync('mango-river-cloud-lamp-3184', 'test-salt', 64).toString('hex') };
globalThis.Netlify = { env: { get: (name) => testEnv[name] || '' } };

test('session cookie authenticates only when signed and unexpired', async () => {
  const login = await auth(new Request('https://example.netlify.app/.netlify/functions/auth', {
    method: 'POST', headers: { Origin: 'https://example.netlify.app', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'mango-river-cloud-lamp-3184' }),
  }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie.includes('daftar_session='));
  assert.equal(isAuthenticated(new Request('https://example.netlify.app/', { headers: { Cookie: cookie } })), true);
  assert.equal(isAuthenticated(new Request('https://example.netlify.app/', { headers: { Cookie: `${cookie}x` } })), false);
  assert.equal(adminPasswordValid('a-secret-only-on-the-server'), false);
  assert.equal(adminPasswordValid('mango-river-cloud-lamp-3184'), true);
  assert.equal(sessionCookie('wrong'), null);
  assert.equal(equal('wrong', 'a-secret-only-on-the-server'), false);
});

test('order validation normalizes Libyan numbers and rejects invalid amounts', () => {
  assert.equal(phone('0912345678'), '218912345678');
  assert.equal(phone('+218912345678', true), '+218912345678');
  assert.throws(() => phone('0970000000'));
  const order = { customer: 'أحمد', phone: '0912345678', city: 'طرابلس', area: 'عين زارة', address: 'شارع 1', product: 'حقيبة', quantity: 2, unitPrice: 25, deliveryFee: 8, paid: 0 };
  assert.equal(validateOrder(order).phone, '218912345678');
  assert.throws(() => validateOrder({ ...order, unitPrice: -1 }));
  assert.equal(isOnWayStatus('out_for_delivery'), true);
  assert.equal(isOnWayStatus('processing'), true);
  assert.equal(isDeliveredStatus('completed'), true);
  assert.equal(isDeliveredStatus('pending'), false);
  assert.equal(isOnWayStatus('pending'), false);
});

test('cross-origin mutation is refused', () => {
  assert.equal(sameOrigin(new Request('https://example.netlify.app/', { headers: { Origin: 'https://evil.example' } })), false);
});

test('warehouse variant measurements and identifiers are sent with the shipment', () => {
  const product = warehouseProductView({ _id: 'product-id', productName: 'طاولة', salePrice: 375, currency: 'lyd',
    variants: [{ _id: 'variant-id', sku: 'T1', attributes: [{ key: 'لون', value: 'خشبي' }], width: 30, height: 5, length: 90, isFragile: true }] });
  assert.equal(product.variants[0].heightCM, 5);
  const shipment = shipmentInput({ city: 'طرابلس', area: 'عين زارة', address: 'شارع 1', product: 'طاولة - T1',
    warehouseProductId: product.id, warehouseVariantId: product.variants[0].id, sku: 'T1', quantity: 1, unitPrice: 375,
    widthCM: 30, heightCM: 5, lengthCM: 90, isFragile: true }, 'service-id');
  assert.equal('fromVirtualWarehouse' in shipment, false);
  assert.deepEqual(shipment.products[0].warehouseProductVariant, 'variant-id');
  assert.deepEqual([shipment.products[0].widthCM, shipment.products[0].heightCM, shipment.products[0].lengthCM], [30, 5, 90]);
});

test('delivery places follow Darb branches and duplicate areas are merged', () => {
  const places = deliveryLocationsView({ results: [
    { countryCode: 'lby', city: 'طرابلس', area: 'زناتة', areas: [{ area: 'عين زارة' }, { area: 'زناتة' }] },
    { countryCode: 'lby', city: 'طرابلس', area: 'حي الأندلس', areas: [] },
    { countryCode: 'are', city: 'Dubai', area: 'Deira', areas: [] },
  ] });
  assert.deepEqual(places, [{ city: 'طرابلس', areas: ['حي الأندلس', 'زناتة', 'عين زارة'] }]);
});

test('delivery price includes every Darb shipping charge but excludes product value', () => {
  const estimate = { invoices: [{ items: [
    { type: 'product', amount: 25, quantity: 2, currency: 'lyd' },
    { type: 'shipping', amount: 20, currency: 'lyd' },
    { type: 'shipping', amount: 5, currency: 'lyd', description: 'رسوم إضافية' },
  ] }] };
  assert.equal(shippingFeeFromEstimate(estimate), 25);
  assert.deepEqual(shippingComponents(estimate).map((item) => item.amount), [20, 5]);
  assert.throws(() => shippingFeeFromEstimate({ invoices: [{ items: [{ type: 'product', amount: 10, currency: 'lyd' }] }] }));
});

test('message delivery receipt matches the right order and stage', () => {
  const order = { id: '12345678-0000-0000-0000-000000000000', shipmentReference: 'SH123' };
  const rows = [
    { content: 'طلبك 12345678 في الطريق. رقم التتبع SH123', status: 'delivered' },
    { content: 'تم تأكيد طلبك 12345678', status: 'delivered' },
    { content: 'طلبك 99999999 في الطريق. رقم التتبع SH999', status: 'failed' },
  ];
  assert.equal(resalaDeliveryStatus(rows, order, 'confirmation'), 'delivered');
  assert.equal(resalaDeliveryStatus(rows, order, 'onWay'), 'delivered');
  assert.equal(resalaDeliveryStatus(rows, { ...order, id: '88888888-0000-0000-0000-000000000000' }, 'confirmation'), null);
});

test('numeric order number, Darb attribution and customer message stay consistent', () => {
  const order = { id: '0468af5d-0000-4000-8000-000000000001', createdByName: 'منى', notes: 'اتصل قبل الوصول',
    product: 'مدخل روما رخامي - C2', sku: 'C2', quantity: 2, unitPrice: 475, deliveryFee: 10 };
  const number = orderNumberFromId(order.id);
  assert.match(number, /^\d{12}$/);
  assert.ok(shipmentNotes(order).includes(`رقم الطلب: ${number} | أُدخل بواسطة: منى`));
  assert.ok(shipmentNotes(order).includes('اتصل قبل الوصول'));
  const preview = confirmationText({ ...order, customer: 'أحمد', city: 'طرابلس', area: 'عين زارة', shipmentReference: 'SH2607713' });
  assert.match(preview, /ركن للأثاث/);
  assert.match(preview, /كود الطلبية الخاص بدرب السبيل: SH2607713/);
  const multiPreview = confirmationText({ ...order, customer: 'أحمد', city: 'طرابلس', area: 'عين زارة', shipmentReference: 'SH2607713',
    items: [{ product: order.product, quantity: 2, unitPrice: 475 }, { product: 'طاولة', quantity: 1, unitPrice: 50 }] });
  assert.match(multiPreview, /الإجمالي: 1010 د\.ل/);
  assert.match(multiPreview, /\+ 1 منتج/);
  assert.doesNotMatch(preview, /لوحو|LOHO/i);
  assert.equal(smsTemplateRecord({ ...order, phone: '0912345678' }, 'confirmation').$1, number);
  const detailed = smsTemplateRecord({ ...order, phone: '0912345678', shipmentReference: 'SH2607713' }, 'onWay', true);
  assert.deepEqual(detailed, { phone: '218912345678', $1: number, $2: 'مدخل روما رخامي', $3: 'C2', $4: '960', $5: 'SH2607713' });
  assert.ok(Object.entries(detailed).every(([key, value]) => !key.startsWith('$') || value.length <= 20));
  assert.throws(() => smsTemplateRecord({ ...order, phone: '0912345678', sku: 'VERY-LONG-PRODUCT-CODE-123' }, 'confirmation', true), /20 حرفًا/);
  assert.equal(resalaDeliveryStatus([{ content: `تم تأكيد طلبك رقم ${number}`, status: 'delivered' }], order, 'confirmation'), 'delivered');
});
