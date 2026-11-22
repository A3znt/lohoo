import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, scryptSync } from 'node:crypto';
import { binding, ordersStore, withContext } from '../cloudflare/runtime.mjs';
import { adminPasswordValid, editPendingShipment, isAuthenticated, removeOrder, sameOrigin, sessionCookie, syncOrder } from '../cloudflare/core.mjs';
import { carrierEvent, createCarrierNotification, listNotifications, markNotificationRead, removePushSubscription, savePushSubscription } from '../cloudflare/notifications.mjs';
import ordersApi from '../cloudflare/api.mjs';
import { agentSessionCookie, loginAgent } from '../cloudflare/team.mjs';

test('admin manages agent credentials and pays only delivered unpaid commissions', async () => {
  await withContext({ DB: fakeD1(), APP_TOKEN: 'test-admin-token' }, async () => {
    const call = async (action, input = {}) => {
      const response = await ordersApi(new Request('https://rukn.example/api/orders', {
        method: 'POST', headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...input }),
      }));
      return { status: response.status, ...(await response.json()) };
    };
    const created = await call('createAgent', { agent: { name: 'منى', username: 'muna', password: 'muna@123' } });
    assert.equal(created.ok, true);
    assert.equal(created.data.password, undefined);
    assert.equal((await call('createAgent', { agent: { name: 'سجى', username: 'saja' } })).ok, false);
    const id = created.data.id;
    assert.ok(await loginAgent('muna', 'muna@123'));
    const renamed = await call('updateAgentProfile', { id, agent: { name: 'منى الجديدة', username: 'muna2' } });
    assert.equal(renamed.data.username, 'muna2');
    const changed = await call('resetAgentPassword', { id, password: 'muna#456' });
    assert.equal(changed.data.password, undefined);
    assert.equal(await loginAgent('muna2', 'muna@123'), null);
    const agent = await loginAgent('muna2', 'muna#456');
    assert.ok(agent);
    assert.equal((await call('resetAgentPassword', { id, password: '123' })).ok, false);
    assert.equal((await call('resetAgentPassword', { id })).ok, false);
    const oldCookie = agentSessionCookie(agent).split(';')[0];
    const agentCall = async (cookie, currentPassword, newPassword) => {
      const response = await ordersApi(new Request('https://rukn.example/api/orders', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'changeMyPassword', currentPassword, newPassword }),
      }));
      return { response, body: await response.json() };
    };
    assert.equal((await agentCall(oldCookie, 'wrong-old', 'new!pass9')).body.ok, false);
    assert.equal((await agentCall(oldCookie, 'muna#456', 'muna#456')).body.ok, false);
    const selfChanged = await agentCall(oldCookie, 'muna#456', 'new!pass9');
    assert.equal(selfChanged.body.ok, true);
    assert.equal(await loginAgent('muna2', 'muna#456'), null);
    assert.ok(await loginAgent('muna2', 'new!pass9'));
    const newCookie = selfChanged.response.headers.getSetCookie().find(value => value.startsWith('daftar_agent_session='))?.split(';')[0];
    assert.ok(newCookie && newCookie !== oldCookie);
    assert.equal((await agentCall(oldCookie, 'new!pass9', 'another99')).response.status, 401);
    assert.equal((await agentCall(newCookie, 'new!pass9', 'another99')).body.ok, true);
    const delivered = '11111111-1111-4111-8111-111111111111';
    const pending = '22222222-2222-4222-8222-222222222222';
    await ordersStore().setJSON(`orders/${delivered}`, { id: delivered, createdAt: '2026-11-22', agentId: id, status: 'delivered', commissionAmount: 15, commissionEarnedAt: '2026-11-22', commissionPaidAt: '' });
    await ordersStore().setJSON(`orders/${pending}`, { id: pending, createdAt: '2026-11-22', agentId: id, status: 'confirmed', commissionAmount: 0, commissionEarnedAt: '', commissionPaidAt: '' });
    const payout = await call('payAgentCommissions', { agentId: id });
    assert.equal(payout.ok, true, payout.error);
    assert.deepEqual(payout.data, { count: 1, amount: 15 });
    assert.ok((await ordersStore().get(`orders/${delivered}`)).commissionPaidAt);
    assert.equal((await ordersStore().get(`orders/${pending}`)).commissionPaidAt, '');
    assert.equal((await call('payAgentCommissions', { agentId: id })).ok, false);
  });
});

test('agent wallet includes only their ledger and preserves paid archived orders', async () => {
  await withContext({ DB: fakeD1(), APP_TOKEN: 'test-admin-token' }, async () => {
    const adminCall = async (agent) => {
      const response = await ordersApi(new Request('https://rukn.example/api/orders', {
        method: 'POST', headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createAgent', agent }),
      }));
      return (await response.json()).data;
    };
    const muna = await adminCall({ name: 'منى', username: 'muna', password: 'muna@123' });
    const saja = await adminCall({ name: 'سجى', username: 'saja', password: 'saja@123' });
    const rows = [
      { id: '11111111-1111-4111-8111-111111111111', agentId: muna.id, status: 'delivered', commissionAmount: 15, commissionEarnedAt: '2026-11-22', commissionPaidAt: '2026-11-23', deletedAt: '2026-11-24' },
      { id: '22222222-2222-4222-8222-222222222222', agentId: muna.id, status: 'confirmed', commissionAmount: 0, commissionEarnedAt: '', commissionPaidAt: '' },
      { id: '33333333-3333-4333-8333-333333333333', agentId: saja.id, status: 'delivered', commissionAmount: 15, commissionEarnedAt: '2026-11-22', commissionPaidAt: '' },
    ];
    for (const row of rows) await ordersStore().setJSON(`orders/${row.id}`, { ...row, createdAt: '2026-11-20', customer: 'زبون', product: 'منتج' });
    const cookie = agentSessionCookie(await loginAgent('muna', 'muna@123')).split(';')[0];
    const response = await ordersApi(new Request('https://rukn.example/api/orders', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bootstrap' }),
    }));
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.data.orders.length, 1);
    assert.deepEqual(result.data.walletEntries.map((entry) => entry.orderId).sort(), rows.slice(0, 2).map((row) => row.id).sort());
    assert.deepEqual({ earned: result.data.commission.earned, paid: result.data.commission.paid, due: result.data.commission.due }, { earned: 15, paid: 15, due: 0 });
    assert.ok(result.data.walletEntries.every((entry) => !('phone' in entry) && !('address' in entry)));
  });
});

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
              const prefix = String(values[0]);
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

test('Darb postponement, failed delivery and cancellation notify only the responsible agent once', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const muna = '22222222-2222-4222-8222-222222222222';
  const saja = '33333333-3333-4333-8333-333333333333';
  const previousFetch = globalThis.fetch;
  let status = 'delayed';
  let reason = 'طلب الزبون التأجيل';
  globalThis.fetch = async () => Response.json({ status: true, data: { results: [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', reference: '1234567', status,
    timeline: [{ type: status, remarks: reason, _id: `event-${status}` }] }] } });
  try {
    await withContext({ DB: fakeD1(), DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      await ordersStore().setJSON(`orders/${id}`, { id, orderNumber: '123456789012', customer: 'زبون', agentId: muna,
        shipmentReference: '1234567', shipmentId: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'confirmed', darbStatus: 'pending',
        updatedAt: '2026-11-20T00:00:00Z' });
      await syncOrder(id);
      let notices = await listNotifications(muna);
      assert.equal(notices.length, 1);
      assert.match(notices[0].body, /طلب الزبون التأجيل/);
      assert.equal((await ordersStore().get(`orders/${id}`)).status, 'postponed');
      await syncOrder(id);
      assert.equal((await listNotifications(muna)).length, 1);
      assert.deepEqual(await listNotifications(saja), []);
      await assert.rejects(markNotificationRead(saja, notices[0].id), /غير موجود/);
      assert.ok((await markNotificationRead(muna, notices[0].id)).readAt);
      status = 'pending'; reason = '';
      await syncOrder(id);
      assert.equal((await ordersStore().get(`orders/${id}`)).status, 'confirmed');
      status = 'undelivered'; reason = 'تعذر التواصل مع الزبون';
      await syncOrder(id);
      notices = await listNotifications(muna);
      assert.equal(notices.length, 2);
      assert.ok(notices.some((item) => item.kind === 'delivery_failed' && item.reason === reason));
      status = 'cancelled'; reason = 'إلغاء من شركة التوصيل';
      await syncOrder(id);
      notices = await listNotifications(muna);
      assert.equal(notices.length, 3);
      assert.equal((await ordersStore().get(`orders/${id}`)).status, 'cancelled');
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('phone push registrations are scoped to an agent and carrier reasons are extracted safely', async () => {
  const muna = '22222222-2222-4222-8222-222222222222';
  const saja = '33333333-3333-4333-8333-333333333333';
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/example', expirationTime: null,
    keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
  await withContext({ DB: fakeD1() }, async () => {
    await savePushSubscription(muna, subscription);
    await removePushSubscription(saja, subscription.endpoint);
    const pushRows = await ordersStore().list({ prefix: 'push/' });
    assert.equal((await ordersStore().get(pushRows.blobs[0].key)).agentId, muna);
    await removePushSubscription(muna, subscription.endpoint);
    assert.equal((await ordersStore().get(pushRows.blobs[0].key)).agentId, '');
    await assert.rejects(savePushSubscription(muna, { ...subscription, endpoint: 'https://example.com/push' }), /غير صالحة/);
  });
  assert.equal(carrierEvent({ status: 'delayed', timeline: [{ type: 'delayed', description: 'تم التأجيل', remarks: 'الزبون غير متاح', _id: 'event-1' }] }).reason, 'الزبون غير متاح');
  assert.equal(carrierEvent({ status: 'delayed', timeline: [{ type: 'delayed', remarks: 'الزبون غير متاح', _id: 'event-1' }] }).eventId, 'event-1');
  assert.equal(carrierEvent({ status: 'pending', timeline: [{ status: 'مؤجل', description: 'حالة سابقة' }] }), null);
});

test('a new carrier notification sends an encrypted web push to the subscribed agent', async () => {
  const agentId = '22222222-2222-4222-8222-222222222222';
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const vapidPublicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', receiver.publicKey)).toString('base64url');
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh, auth } };
  const previousFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => { sent = { url, options }; return new Response(null, { status: 201 }); };
  try {
    await withContext({ DB: fakeD1(), VAPID_PUBLIC_KEY: vapidPublicKey, VAPID_PRIVATE_KEY: jwk.d,
      VAPID_SUBJECT: 'https://example.com' }, async () => {
      await savePushSubscription(agentId, subscription);
      await createCarrierNotification({ id: '11111111-1111-4111-8111-111111111111', orderNumber: '123456789012',
        customer: 'زبون', agentId }, { kind: 'postponed', reason: 'طلب تأجيل', eventId: '' });
      assert.equal(sent.url, subscription.endpoint);
      assert.equal(sent.options.method.toUpperCase(), 'POST');
      assert.match(String(sent.options.headers.authorization), /^vapid /);
      assert.ok(sent.options.body.byteLength > 0);
      assert.equal((await listNotifications(agentId)).length, 1);
    });
  } finally { globalThis.fetch = previousFetch; }
});
