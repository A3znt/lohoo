import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { binding, ordersStore, withContext } from '../cloudflare/runtime.mjs';
import { adminPasswordValid, isAuthenticated, sameOrigin, sessionCookie } from '../cloudflare/core.mjs';

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
