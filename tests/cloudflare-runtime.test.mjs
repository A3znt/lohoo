import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, scryptSync } from 'node:crypto';
import { binding, ordersStore, withContext } from '../cloudflare/runtime.mjs';
import { adminPasswordValid, editPendingShipment, ensureValidCollection, isAuthenticated, listWarehouseProducts, removeOrder, sameOrigin, sendStageSms, sessionCookie, syncOrder, syncSmsDelivery, warehouseSelection } from '../cloudflare/core.mjs';
import { carrierEvent, createAdminNotification, createCarrierNotification, listNotifications, markNotificationRead, removePushSubscription, savePushSubscription } from '../cloudflare/notifications.mjs';
import { dailyReviewedIds, maybeSendMorningDigest, reviewShipment, tripoliClock } from '../cloudflare/daily-review.mjs';
import sync from '../cloudflare/sync.mjs';
import ordersApi from '../cloudflare/api.mjs';
import { agentSessionCookie, createAgent, loginAgent } from '../cloudflare/team.mjs';

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

test('earned commissions cannot be moved and collection cannot exceed order total', async () => {
  assert.throws(() => ensureValidCollection(401, 350, 1, 50), /أكبر من إجمالي/);
  assert.doesNotThrow(() => ensureValidCollection(400, 350, 1, 50));
  await withContext({ DB: fakeD1(), APP_TOKEN: 'test-admin-token' }, async () => {
    const first = await createAgent({ name: 'منى', username: 'muna', password: 'muna@123' });
    const second = await createAgent({ name: 'سجى', username: 'saja', password: 'saja@123' });
    const id = '11111111-1111-4111-8111-111111111111';
    await ordersStore().setJSON(`orders/${id}`, { id, createdAt: '2026-11-23', updatedAt: '2026-11-23',
      customer: 'زبون', agentId: first.id, agentName: first.name, status: 'delivered',
      commissionEarnedAt: '2026-11-23', commissionAmount: 15, commissionPaidAt: '',
      unitPrice: 350, quantity: 1, deliveryFee: 50, paid: 0 });
    const call = async (action, input) => (await ordersApi(new Request('https://rukn.example/api/orders', {
      method: 'POST', headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...input }),
    }))).json();
    assert.equal((await call('assignAgent', { id, agentId: second.id })).ok, false);
    assert.equal((await call('updateOrder', { id, paid: 401 })).ok, false);
    assert.equal((await call('updateOrder', { id, paid: 400 })).ok, true);
    assert.equal((await ordersStore().get(`orders/${id}`)).agentId, first.id);
  });
});

test('background sync skips archived orders and flags stalled shipment creation without retrying', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Unexpected carrier request'); };
  try {
    await withContext({ DB: fakeD1(), APP_TOKEN: 'fixture', DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const archived = '11111111-1111-4111-8111-111111111111';
      const stalled = '22222222-2222-4222-8222-222222222222';
      await ordersStore().setJSON(`orders/${archived}`, { id: archived, createdAt: '2026-11-22T00:00:00Z',
        status: 'confirmed', shipmentReference: '1234567', deletedAt: '2026-11-22T12:00:00Z' });
      await ordersStore().setJSON(`orders/${stalled}`, { id: stalled, orderNumber: '223344556677',
        createdAt: '2026-11-22T00:00:00Z', status: 'creating', shipmentReference: '' });
      await sync();
      assert.equal(calls, 0);
      assert.equal((await ordersStore().get(`orders/${stalled}`)).status, 'attention');
      assert.equal((await ordersStore().get(`orders/${archived}`)).status, 'confirmed');
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'order_attention').length, 1);
      await sync();
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'order_attention').length, 1);
    });
  } finally { globalThis.fetch = previousFetch; }
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

test('admin sends private notifications to herself or agents, while agents cannot send', async () => {
  await withContext({ DB: fakeD1(), APP_TOKEN: 'test-admin-token' }, async () => {
    const muna = await createAgent({ name: 'منى', username: 'muna', password: 'muna@123' });
    const saja = await createAgent({ name: 'سجى', username: 'saja', password: 'saja@123' });
    const call = async (action, input = {}, cookie = '') => {
      const response = await ordersApi(new Request('https://rukn.example/api/orders', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : { Authorization: 'Bearer test-admin-token' }) },
        body: JSON.stringify({ action, ...input }) }));
      return response.json();
    };
    const agentCookie = agentSessionCookie(await loginAgent('muna', 'muna@123')).split(';')[0];
    assert.equal((await call('sendNotification', { recipient: 'admin', title: 'تنبيه', body: 'تجربة' }, agentCookie)).ok, false);
    assert.equal((await call('sendNotification', { recipient: 'missing', title: 'تنبيه', body: 'تجربة' })).ok, false);
    assert.equal((await call('sendNotification', { recipient: 'admin', title: ' ', body: 'تجربة' })).ok, false);
    assert.deepEqual((await call('sendNotification', { recipient: 'admin', title: 'تنبيه', body: 'تجربة' })).data, { count: 1 });
    assert.equal((await listNotifications('admin')).length, 1);
    assert.equal((await call('sendNotification', { recipient: 'all', title: 'متابعة', body: 'راجعوا الطلبات' })).data.count, 2);
    assert.equal((await listNotifications(muna.id)).length, 1);
    assert.equal((await listNotifications(saja.id)).length, 1);
    assert.deepEqual((await call('bootstrap')).data.notifications.map((item) => item.title), ['تنبيه']);
    const own = (await listNotifications('admin'))[0];
    assert.equal((await call('markNotificationRead', { id: own.id }, agentCookie)).ok, false);
    assert.ok((await call('markNotificationRead', { id: own.id })).data.readAt);
    assert.equal((await call('sendNotification', { recipient: muna.id, title: 'خاص', body: 'مراجعة الطلب' })).data.count, 1);
    assert.equal((await listNotifications(muna.id)).length, 2);
    assert.equal((await listNotifications(saja.id)).length, 1);
    assert.equal((await call('sendNotification', { recipient: 'team', title: 'للجميع', body: 'اجتماع اليوم' })).data.count, 3);
    assert.equal((await listNotifications('admin')).length, 2);
    assert.equal((await listNotifications(muna.id)).length, 3);
    assert.equal((await listNotifications(saja.id)).length, 2);
  });
});

test('an agent can retry only their failed SMS, and a successful send cannot be duplicated', async () => {
  const originalFetch = globalThis.fetch;
  let balanceAvailable = false;
  let sends = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /resala\.ly\/api\/v1\/messages\/send-template/);
    sends += 1;
    return Response.json(balanceAvailable
      ? { succeeded: 1, failed: 0, failed_numbers: [], invalid_numbers: [], sms_template_version: { id: 'approved-version' } }
      : { status: 400, type: 'InsufficientCredit' }, { status: balanceAvailable ? 201 : 400 });
  };
  try {
    await withContext({ DB: fakeD1(), APP_TOKEN: 'test-admin-token', RESALA_API_KEY: 'test-resala-key', RESALA_CONFIRM_TEMPLATE_ID: 'approved-template' }, async () => {
      const muna = await createAgent({ name: 'منى', username: 'muna', password: 'muna@123' });
      const saja = await createAgent({ name: 'سجى', username: 'saja', password: 'saja@123' });
      const id = '77777777-7777-4777-8777-777777777777';
      await ordersStore().setJSON(`orders/${id}`, { id, agentId: muna.id, status: 'confirmed', shipmentReference: '2384360',
        phone: '218910001234', orderNumber: '123456789012', confirmationSms: 'failed', confirmationSmsError: 'InsufficientCredit' });
      const call = async (agent) => {
        const cookie = agentSessionCookie(await loginAgent(agent.username, agent.password)).split(';')[0];
        const response = await ordersApi(new Request('https://rukn.example/api/orders', { method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'retryMessage', id, stage: 'confirmation' }) }));
        return response.json();
      };
      assert.equal((await call({ username: saja.username, password: 'saja@123' })).ok, false);
      assert.equal(sends, 0);
      const blocked = await call({ username: muna.username, password: 'muna@123' });
      assert.equal(blocked.data.confirmationSms, 'failed');
      assert.equal(blocked.data.confirmationSmsError, 'InsufficientCredit');
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'sms_alert').length, 1);
      balanceAvailable = true;
      const sent = await call({ username: muna.username, password: 'muna@123' });
      assert.equal(sent.data.confirmationSms, 'sent');
      assert.equal(sent.data.confirmationSmsError, '');
      assert.equal((await call({ username: muna.username, password: 'muna@123' })).ok, false);
      assert.equal(sends, 2);
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'sms_alert').length, 1);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('ambiguous Resala response remains unknown so a retry cannot duplicate the SMS', async () => {
  const previousFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => { sends += 1; return new Response('temporary server error', { status: 502 }); };
  try {
    await withContext({ DB: fakeD1(), APP_TOKEN: 'fixture', RESALA_API_KEY: 'fixture',
      RESALA_CONFIRM_TEMPLATE_ID: 'approved-template' }, async () => {
      const id = '77777777-7777-4777-8777-777777777777';
      await ordersStore().setJSON(`orders/${id}`, { id, status: 'confirmed', shipmentReference: '2384360',
        phone: '218910001234', orderNumber: '123456789012', confirmationSms: 'pending' });
      assert.equal((await sendStageSms(id, 'confirmation')).confirmationSms, 'unknown');
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'sms_alert').length, 1);
      const response = await ordersApi(new Request('https://rukn.example/api/orders', { method: 'POST',
        headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retryMessage', id, stage: 'confirmation' }) }));
      assert.equal((await response.json()).ok, false);
      assert.equal(sends, 1);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('old accepted SMS stops receipt polling after three days and stays safe from automatic resend', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Unexpected Resala request'); };
  try {
    await withContext({ DB: fakeD1(), RESALA_API_KEY: 'fixture' }, async () => {
      const id = '77777777-7777-4777-8777-777777777777';
      await ordersStore().setJSON(`orders/${id}`, { id, phone: '218910001234',
        confirmationSms: 'sent', confirmationSmsStartedAt: '2026-11-01T00:00:00Z', onWaySms: 'pending' });
      assert.equal((await syncSmsDelivery(id)).confirmationSms, 'unknown');
      assert.equal(calls, 0);
      assert.equal((await syncSmsDelivery(id)).confirmationSms, 'unknown');
    });
  } finally { globalThis.fetch = previousFetch; }
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
                  .sort().map((key) => sql.includes('data FROM records') ? { key, data: records.get(key).data } : { key }),
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
    assert.deepEqual((await store.listValues({ prefix: 'orders/' })).map(({ value }) => value),
      [{ status: 'on_way' }, { status: 'delivered' }]);
  });
});

test('a Darb product awaiting review is visible in the catalog but cannot be used for a shipment', async () => {
  const previousFetch = globalThis.fetch;
  const productId = '6b0371d3eb14e65ff5b4e9cc';
  const variantId = '6b0371d3eb14e65ff5b4e9c9';
  const product = { _id: productId, productName: 'طاولة كومبو', salePrice: 350, currency: 'lyd',
    isPublished: false, isReviewed: false, isBlocked: false,
    variants: [{ _id: variantId, sku: 'COMBO-1', width: 10, height: 10, length: 10 }] };
  globalThis.fetch = async () => Response.json({ status: true, data: { results: [product] } });
  try {
    await withContext({ DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const catalog = await listWarehouseProducts();
      assert.equal(catalog[0].name, 'طاولة كومبو');
      assert.equal(catalog[0].isPublished, false);
      assert.deepEqual([catalog[0].variants[0].widthCM, catalog[0].variants[0].heightCM, catalog[0].variants[0].lengthCM], [10, 10, 10]);
      await assert.rejects(warehouseSelection(productId, variantId), /لم يعد متاحًا/);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('Darb product pagination requests a fixed limit and removes repeated product IDs', async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  const product = (number) => ({ _id: String(number).padStart(24, '0'), productName: `منتج ${number}`,
    salePrice: 350, isPublished: true, isBlocked: false, variants: [] });
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed.search);
    assert.equal(parsed.searchParams.get('limit'), '10');
    const offset = Number(parsed.searchParams.get('offset'));
    return Response.json({ status: true, data: { results: offset === 0
      ? Array.from({ length: 10 }, (_, index) => product(index))
      : [product(9), product(10)] } });
  };
  try {
    await withContext({ DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const products = await listWarehouseProducts();
      assert.equal(products.length, 11);
      assert.equal(new Set(products.map((row) => row.id)).size, 11);
      assert.deepEqual(requested, ['?offset=0&limit=10', '?offset=10&limit=10']);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('warehouse pagination continues past one repeated full page', async () => {
  const previousFetch = globalThis.fetch;
  const offsets = [];
  const product = (number) => ({ _id: String(number).padStart(24, '0'), productName: `منتج ${number}`,
    salePrice: 350, isPublished: true, variants: [] });
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    offsets.push(offset);
    const rows = offset === 0 || offset === 10 ? Array.from({ length: 10 }, (_, index) => product(index)) : [product(10)];
    return Response.json({ status: true, data: { results: rows } });
  };
  try {
    await withContext({ DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      assert.equal((await listWarehouseProducts()).length, 11);
      assert.deepEqual(offsets, [0, 10, 20]);
    });
  } finally { globalThis.fetch = previousFetch; }
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

test('pending edits reach Darb before local save; absent shipments are archived only after a direct check', async () => {
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
  let directMissing = false;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body && JSON.parse(init.body) });
    if (path === '/api/local/shipments/') return Response.json({ status: true, data: { results: missing ? [] : [{ _id: shipmentId, reference: original.shipmentReference, status: 'pending' }] } });
    if (path === `/api/local/shipments/${shipmentId}` && init.method === 'GET') return Response.json({ status: true,
      data: { results: directMissing ? [] : [{ _id: shipmentId, reference: 'DIFFERENT', status: 'pending' }] } });
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
      await assert.rejects(removeOrder(id), /بيانات مختلفة/);
      assert.equal((await store.get(`orders/${id}`)).deletedAt, undefined);
      directMissing = true;
      const archived = await removeOrder(id);
      assert.ok(archived.deletedAt && archived.carrierDeletedAt);
      assert.equal(archived.darbStatus, 'already_deleted');
      assert.equal(calls.some((call) => call.method === 'DELETE'), false);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('missing Darb shipment becomes an attention item until the admin archives it', async () => {
  const previousFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({ status: true, data: { results: [] } });
  };
  try {
    await withContext({ DB: fakeD1(), DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const id = '11111111-1111-4111-8111-111111111111';
      await ordersStore().setJSON(`orders/${id}`, { id, createdAt: '2026-11-23T00:00:00Z',
        orderNumber: '123456789012', status: 'confirmed', darbStatus: 'pending',
        shipmentReference: 'SH123456', shipmentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
      const missing = await syncOrder(id);
      assert.equal(missing.status, 'attention');
      assert.equal(missing.darbStatus, 'not_found');
      assert.equal((await listNotifications('admin')).filter((item) => item.kind === 'order_attention').length, 1);
      assert.deepEqual(paths, ['/api/local/shipments/', '/api/local/shipments/aaaaaaaaaaaaaaaaaaaaaaaa']);
      const archived = await removeOrder(id);
      assert.equal(archived.darbStatus, 'already_deleted');
      assert.ok(archived.deletedAt);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('missing Darb shipment cannot trigger a stale confirmation SMS retry', async () => {
  const previousFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('v2.sabil.ly')) return Response.json({ status: true, data: { results: [] } });
    sends += 1;
    throw new Error('Unexpected SMS send');
  };
  try {
    await withContext({ DB: fakeD1(), APP_TOKEN: 'fixture', RESALA_API_KEY: 'fixture',
      RESALA_CONFIRM_TEMPLATE_ID: 'template', DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const id = '11111111-1111-4111-8111-111111111111';
      await ordersStore().setJSON(`orders/${id}`, { id, status: 'confirmed', darbStatus: 'pending',
        shipmentReference: 'SH123456', phone: '218910001234', confirmationSms: 'failed' });
      const response = await ordersApi(new Request('https://rukn.example/api/orders', { method: 'POST',
        headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retryMessage', id, stage: 'confirmation' }) }));
      assert.equal((await response.json()).ok, false);
      assert.equal(sends, 0);
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
      assert.equal((await listNotifications('admin')).length, 1);
      assert.match(notices[0].body, /طلب الزبون التأجيل/);
      assert.equal((await ordersStore().get(`orders/${id}`)).status, 'postponed');
      await syncOrder(id);
      assert.equal((await listNotifications(muna)).length, 1);
      assert.equal((await listNotifications('admin')).length, 1);
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
      assert.equal((await listNotifications('admin')).length, 3);
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
    assert.deepEqual(await savePushSubscription('admin', { ...subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/admin' }), { enabled: true });
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

test('admin order alert and morning digest are idempotent and use Tripoli time', async () => {
  const now = new Date('2026-11-23T07:05:00Z');
  assert.deepEqual(tripoliClock(now), { date: '2026-11-23', hour: 9 });
  await withContext({ DB: fakeD1() }, async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await ordersStore().setJSON(`orders/${id}`, { id, orderNumber: '1234567', createdAt: '2026-11-23T06:00:00Z',
      status: 'confirmed', shipmentReference: '1234567', confirmationSms: 'failed', confirmationSmsError: 'InsufficientCredit', onWaySms: 'unknown' });
    await createAdminNotification(`new-order:${id}`, { kind: 'new_order', orderId: id,
      title: 'طلب جديد رقم 123', body: 'أُدخل بواسطة منى' });
    await createAdminNotification(`new-order:${id}`, { kind: 'new_order', orderId: id,
      title: 'طلب جديد رقم 123', body: 'أُدخل بواسطة منى' });
    assert.equal((await listNotifications('admin')).length, 1);
    assert.equal(await maybeSendMorningDigest(new Date('2026-11-23T06:55:00Z')), null);
    await maybeSendMorningDigest(now);
    await maybeSendMorningDigest(now);
    const notices = await listNotifications('admin');
    assert.equal(notices.length, 2);
    assert.match(notices.find((item) => item.kind === 'daily_digest').body, /1 طلب جديد.*1 شحنة/);
    assert.match(notices.find((item) => item.kind === 'daily_digest').body, /1234567/);
    assert.match(notices.find((item) => item.kind === 'daily_digest').body, /1 رسالة تحتاج شحن رصيد/);
    assert.match(notices.find((item) => item.kind === 'daily_digest').body, /1 رسالة تحتاج التحقق/);
  });
});

test('web push is handed to the Worker execution context after storing the alert', async () => {
  const pending = [];
  await withContext({ DB: fakeD1(), __EXECUTION_CONTEXT: { waitUntil: (promise) => pending.push(promise) } }, async () => {
    await createAdminNotification('new-order:test', { kind: 'new_order', orderId: 'test', title: 'طلب جديد', body: 'مراجعة' });
    assert.equal(pending.length, 1);
    assert.equal((await listNotifications('admin')).length, 1);
    await Promise.all(pending);
  });
});

test('daily check fetches the Darb shipment before marking it reviewed', async () => {
  const previousFetch = globalThis.fetch;
  let found = false;
  globalThis.fetch = async () => Response.json({ status: true,
    data: { results: found ? [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', reference: '1234567', status: 'pending' }] : [] } });
  try {
    await withContext({ DB: fakeD1(), DARB_API_KEY: 'fixture', DARB_ACCOUNT_ID: 'fixture' }, async () => {
      const id = '11111111-1111-4111-8111-111111111111';
      await ordersStore().setJSON(`orders/${id}`, { id, createdAt: '2026-11-23T06:00:00Z', updatedAt: '2026-11-23T06:00:00Z',
        status: 'confirmed', darbStatus: 'pending', shipmentReference: '1234567', shipmentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
      await assert.rejects(reviewShipment(id), /لم نعتبرها/);
      assert.deepEqual(await dailyReviewedIds(), []);
      found = true;
      assert.equal((await reviewShipment(id)).order.shipmentReference, '1234567');
      assert.deepEqual(await dailyReviewedIds(), [id]);
    });
  } finally { globalThis.fetch = previousFetch; }
});
