import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../web/src/order-view.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
});
const { sortOrders, filterOrders, weeklyOrderActivity, dashboardMetrics } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

const makeOrder = (id, createdAt, unitPrice, status = 'confirmed') => ({
  id, orderNumber: '0000000000' + id, customer: 'زبون ' + id,
  createdAt, unitPrice, deliveryFee: 10, quantity: 1, paid: 0,
  status, phone: '218912345678', product: 'منتج', city: 'طرابلس',
  area: 'حي الأندلس', address: 'الشارع', shipmentReference: 'SHIP-' + id,
});

test('sort by newest, oldest and amount without mutating original orders', () => {
  const source = [
    makeOrder('01', '2026-11-18T10:00:00Z', 200),
    makeOrder('02', '2026-11-20T10:00:00Z', 30),
    makeOrder('03', '2026-11-19T10:00:00Z', 80),
  ];
  assert.deepEqual(sortOrders(source, 'newest').map((o) => o.id), ['02', '03', '01']);
  assert.deepEqual(sortOrders(source, 'oldest').map((o) => o.id), ['01', '03', '02']);
  assert.deepEqual(sortOrders(source, 'highest_total').map((o) => o.id), ['01', '03', '02']);
  assert.deepEqual(sortOrders(source, 'lowest_total').map((o) => o.id), ['02', '03', '01']);
  assert.deepEqual(source.map((o) => o.id), ['01', '02', '03']);
});

test('search matches phone, city, shipment and explicit status', () => {
  const orders = [makeOrder('01', '2026-11-20T10:00:00Z', 20, 'on_way'),
    { ...makeOrder('02', '2026-11-21T10:00:00Z', 20, 'delivered'), additionalPhones: ['218922345678'] }];
  assert.equal(filterOrders(orders, 'all', '218912345678').length, 2);
  assert.equal(filterOrders(orders, 'on_way', 'SHIP-01').length, 1);
  assert.equal(filterOrders(orders, 'delivered', 'SHIP-01').length, 0);
  assert.equal(filterOrders(orders, 'all', 'طرابلس').length, 2);
  assert.equal(filterOrders(orders, 'all', '218922345678').length, 1);
});

test('seven-day activity excludes invalid dates and outside-window orders', () => {
  const now = new Date(2026, 10, 21, 14, 30);
  const yesterday = new Date(2026, 10, 20, 9, 0).toISOString();
  const oneWeekAgo = new Date(2026, 10, 14, 9, 0).toISOString();
  const today = new Date(2026, 10, 21, 9, 0).toISOString();
  const days = weeklyOrderActivity([
    { createdAt: yesterday }, { createdAt: today },
    { createdAt: oneWeekAgo }, { createdAt: 'bad date' },
  ], now);
  assert.equal(days.length, 7);
  assert.equal(days.reduce((total, day) => total + day.count, 0), 2);
  assert.equal(days[6].count, 1);
  assert.equal(days[5].count, 1);
});

test('dashboard metrics use only included order values', () => {
  const list = [{ ...makeOrder('01', '2026-11-20T10:00:00Z', 100), items: [
    { product: 'أول', quantity: 1, unitPrice: 100 }, { product: 'ثاني', quantity: 2, unitPrice: 25 },
  ] },
    makeOrder('02', '2026-11-20T10:00:00Z', 50, 'cancelled')];
  const metrics = dashboardMetrics(list);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.revenue, 160);
  assert.equal(metrics.due, 160);
});
