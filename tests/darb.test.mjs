import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/darb.mjs';

const env = { APP_TOKEN: 'personal-secret', DARB_API_KEY: 'darb-secret', DARB_ACCOUNT_ID: 'account-123' };
globalThis.Netlify = { env: { get: (key) => env[key] } };

function request(action, payload, token = env.APP_TOKEN) {
  return new Request('https://app.example/.netlify/functions/darb', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
}

test('rejects wrong app token before contacting Darb', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('must not call upstream'); };
  try {
    const response = await handler(request('packages', undefined, 'wrong'));
    assert.equal(response.status, 401);
  } finally { globalThis.fetch = previous; }
});

test('creates a shipment with the documented v2 headers and payload', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const data = calls.length === 1 ? { amount: 15 } : calls.length === 2 ? { _id: 'contact-1' } : { reference: '2384360' };
    return Response.json({ status: true, data });
  };
  try {
    const response = await handler(request('createShipment', {
      service: 'service-1',
      order: { customer: 'أحمد علي', phone: '0912345678', city: 'طرابلس', area: 'عين زارة', address: 'شارع 1', product: 'حقيبة', quantity: 2, unitPrice: 25, notes: '' },
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.reference, '2384360');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://v2.sabil.ly/api/local/shipments/calculate/shipping/');
    assert.equal(calls[0].init.headers.Authorization, 'apikey darb-secret');
    assert.equal(calls[0].init.headers['X-ACCOUNT-ID'], 'account-123');
    assert.equal(JSON.parse(calls[1].init.body).phone, '+218912345678');
    assert.deepEqual(JSON.parse(calls[2].init.body).contacts, ['contact-1']);
  } finally { globalThis.fetch = previous; }
});
