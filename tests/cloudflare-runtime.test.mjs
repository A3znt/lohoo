import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { binding, ordersStore, withContext } from '../cloudflare/runtime.mjs';
import { adminPasswordValid, editPendingShipment, isAuthenticated, removeOrder, sameOrigin, sessionCookie } from '../cloudflare/core.mjs';

function fakeD1() {
  const records = new Map();
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              const record = records.get(values[0]);
              if (!record) return null;
              if (sql.startsWith('SELECT data, etag')) return { ...record };
              if (sql.startsWith('SELECT data')) return { data: record.data };
              throw new Error(`Unexpected query: ${sql}`);
            },
            async all() {
              const prefix = String(values[0]).replace(/%$/, '');
              return {
                results: [...records.keys()].filter((key) => key.startsWith(prefix))
                  .sort().map((key) => ({ key })),
              };
            },
            async run() {
              if (sql.startsWith('UPDATE records SET')) {
                const [data, etag, key, previousEtag] = values;
                if (records.get(key)?.etag !== previousEtag) return { meta: { changes: 0 } };
                records.set(key, { data, etag });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('INSERT INTO records')) {
                const [key, data, etag] = values;
                if (sql.includes('DO NOTHING') && records.has(key)) return { meta: { changes: 0 } };
                records.set(key, { data, etag });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected mutation: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test('Cloudflare D1 stores JSON and rejects duplicate creates and stale writes', async () => {
  await withContext({ DB: fakeD1() }, async () => {
    const store = ordersStore();
    assert.deepEqual(await store.get('orders/one'), null);
    assert.deepEqual(await store.setJSON('orders/one', { status: 'confirmed' }, { onlyIfNew: true }), { modified: true });
    assert.deepEqual(await store.setJSON('orders/one', { status: 'duplicate' }, { onlyIfNew: true }), { modified: false });

    const original = await store.getWithMetadata('orders/one');
    assert.deepEqual(original.data, { status: 'confirmed' });
    assert.deepEqual(await store.setJSON('orders/one', { status: 'on_way' }, { onlyIfMatch: original.etag }), { modified: true });
    assert.deepEqual(await store.setJSON('orders/one', { status: 'stale' }, { onlyIfMatch: original.etag }), { modified: false });
    assert.deepEqual(await store.get('orders/one'), { status: 'on_way' });

    assert.deepEqual(await store.setJSON('orders/two', { status: 'delivered' }), { modified: true });
    await store.setJSON('agents/one', { enabled: true });
    assert.deepEqual((await store.list({ prefix: 'orders/' })).blobs, [{ key: 'orders/one' }, { key: 'orders/two' }]);
  });
});

test('Cloudflare bindings remain isolated between overlapping requests', async () => {
  assert.equal(binding('APP_TOKEN'), undefined);
  assert.throws(() => ordersStore(), /قاعدة بيانات/);
  const [first, second] = await Promise.all([
    withContext({ DB: fakeD1(), APP_TOKEN: 'first' }, async () => {
      await Promise.resolve();
      await ordersStore().setJSON('orders/id', { owner: 'first' });
      return { token: binding('APP_TOKEN'), row: await ordersStore().get('orders/id') };
    }),
    withContext({ DB: fakeD1(), APP_TOKEN: 'second' }, async () => {
      await Promise.resolve();
      await ordersStore().setJSON('orders/id', { owner: 'second' });
      return { token: binding('APP_TOKEN'), row: await ordersStore().get('orders/id') };
    }),
  ]);
  assert.deepEqual(first, { token: 'first', row: { owner: 'first' } });
  assert.deepEqual(second, { token: 'second', row: { owner: 'second' } });
});

test('Cloudflare admin sessions use signed cookies and enforce same-origin mutations', async () => {
  const password = 'example-test-password';
  const salt = 'test-salt';
  await withContext({
    APP_TOKEN: 'server-only-key',
    ADMIN_PASSWORD_SALT: salt,
    ADMIN_PASSWORD_HASH: scryptSync(password, salt, 64).toString('hex'),
  }, async () => {
    assert.equal(adminPasswordValid(password), true);
    assert.equal(adminPasswordValid('wrong'), false);
    assert.equal(sessionCookie('wrong'), null);
    const cookie = sessionCookie(password).split(';')[0];
    const request = (headers) => new Request('https://lohoo.example/api/orders', { headers });
    assert.equal(isAuthenticated(request({ Cookie: cookie })), true);
    assert.equal(isAuthenticated(request({ Cookie: cookie + 'x' })), false);
    assert.equal(sameOrigin(request({ Origin: 'https://lohoo.example' })), true);
    assert.equal(sameOrigin(request({ Origin: 'https://other.example' })), false);
  });
});

test('pending edits reach Darb before local save; missing shipments are never silently deleted', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const productId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const variantId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const shipmentId = 'cccccccccccccccccccccccc';
  const original = { id, orderNumber: '111111111111', customer: 'زبون', phone: '218912345678',
    city: 'طرابلس', area: 'عين زارة', address: 'شارع 1', product: 'منتج - SKU', quantity: 1,
    unitPrice: 25, deliveryFee: 10, paid: 0, notes: '', source: 'facebook', serviceId: 'service-1',
    warehouseProductId: productId, warehouseVariantId: variantId, contactId: 'old-contact',
    shipmentId, shipmentReference: '1234567', status: 'confirmed', darbStatus: 'pending',
    updatedAt: '2026-11-20T00:00:00Z', createdAt: '2026-11-20T00:00:00Z', createdByName: 'المدير' };
  const previousFetch = globalThis.fetch;
  let rejectPatch = false;
  let missing = false;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body && JSON.parse(init.body) });
    if (path === '/api/local/shipments/') return Response.json({ status: true, data: { results: missing ? [] : [{ _id: shipmentId, reference: original.shipmentReference, status: 'pending' }] } });
    if (path === '/api/local/branches/public') return Response.json({ status: true, data: { results: [{ countryCode: 'lby', city: 'طرابلس', area: 'عين زارة' }] } });
    if (path === `/api/warehouse/products/${productId}`) return Response.json({ status: true, data: { results: [{ _id: productId, productName: 'منتج', salePrice: 25, isPublished: true, isBlocked: false, variants: [{ _id: variantId, sku: 'SKU' }] }] } });
    if (path === '/api/local/shipments/calculate/shipping/') return Response.json({ status: true, data: { invoices: [{ items: [{ type: 'shipping', currency: 'lyd', amount: 12, quantity: 1 }] }] } });
    if (path === `/api/local/shipments/${shipmentId}` && init.method === 'PATCH') return Response.json(rejectPatch ? { status: false, messages: [{ message: 'Rejected' }] } : { status: true, data: { reference: original.shipmentReference } });
    throw new Error(`Unexpected Darb request ${init.method} ${path}`);
  };
  try {
    await withContext({ DB: fakeD1(), DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const store = ordersStore();
      await store.setJSON(`orders/${id}`, original);
      const input = { ...original, address: 'شارع 2', notes: 'اتصل قبل الوصول' };
      rejectPatch = true;
      await assert.rejects(editPendingShipment(id, input, original.updatedAt, true), /Rejected/);
      assert.equal((await store.get(`orders/${id}`)).address, 'شارع 1');
      rejectPatch = false;
      const saved = await editPendingShipment(id, input, original.updatedAt, true);
      assert.equal(saved.address, 'شارع 2');
      assert.equal(saved.deliveryFee, 12);
      const patch = calls.findLast(call => call.method === 'PATCH');
      assert.equal(patch.body.to.address, 'شارع 2');
      assert.match(patch.body.notes, /اتصل قبل الوصول/);
      missing = true;
      await assert.rejects(removeOrder(id), /لم نحذف السجل/);
      assert.equal((await store.get(`orders/${id}`)).deletedAt, undefined);
    });
  } finally { globalThis.fetch = previousFetch; }
});
