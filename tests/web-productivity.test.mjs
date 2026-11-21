import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('copy controls are present for identifiers, phone, tracking and numeric metrics', async () => {
  const [main, copy] = await Promise.all([read('web/src/main.tsx'), read('web/src/CopyButton.tsx')]);
  assert.match(main, /<CopyButton value=\{orderNumber\(order\)\}/);
  assert.match(main, /label="رقم الهاتف" value=\{order\.phone\} copyable/);
  assert.match(main, /label="رقم التتبع"[^>]*copyable/);
  assert.match(main, /label="الإجمالي"[^>]*copyable/);
  assert.match(main, /function Metric[\s\S]*?<CopyButton value=\{value\}/);
  assert.match(copy, /navigator\.clipboard\?\.writeText/);
  assert.match(copy, /event\.stopPropagation\(\)/);
  assert.match(copy, /aria-label=\{text\}/);
  assert.match(copy, /aria-live="polite"/);
});

test('order listing keeps copy actions independent and provides keyboard access', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /className="order-row" role="button" tabIndex=\{0\}/);
  assert.match(source, /event\.target === event\.currentTarget/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.key === ' '/);
  assert.match(source, /visible\.slice\(0, visibleLimit\)/);
  assert.match(source, /shippingOrders\.slice\(0, visibleLimit\)/);
});

test('CSV export and shortcuts are scoped to current visible records', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /downloadOrders\(visible\)/);
  assert.match(source, /downloadOrders\(shippingOrders\)/);
  assert.match(source, /exportOrdersCsv\(orders\.map/);
  assert.match(source, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(source, /focusSearchAfterNavigation/);
  assert.match(source, /aria-pressed=\{filter === key\}/);
});

test('failed session bootstrap does not show false zero totals and form rejects invalid values', async () => {
  const [view, form, api] = await Promise.all([
    read('web/src/main.tsx'), read('web/src/OrderForm.tsx'), read('web/src/api.ts'),
  ]);
  assert.match(view, /!lastSyncedAt && <div className="initial-data-loading"/);
  assert.match(view, /lastSyncedAt && view === 'overview'/);
  assert.match(view, /!paidValid \|\| paidNumber === order\.paid/);
  assert.match(form, /const phoneValid =/);
  assert.match(form, /const quantityValid =/);
  assert.match(form, /const amountValid =/);
  assert.match(api, /class ApiError extends Error/);
  assert.match(api, /result\.error \|\|/);
});

test('account changes clear sensitive in-memory orders and invalidate old refreshes', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /function clearSessionData\(\)/);
  assert.match(source, /refreshRequest\.current \+= 1;/);
  assert.match(source, /setData\(emptyBootstrap\(\)\)/);
  assert.match(source, /setLastSyncedAt\(null\)/);
  assert.match(source, /setSelected\(null\)/);
  assert.match(source, /setAuthenticated\(false\)/);
  assert.match(source, /setData\(emptyBootstrap\(actor\)\)/);
  assert.match(source, /await logout\(\); clearSessionData\(\)/);
});

test('shipping list exposes direct tracking copy and a user-initiated telephone action', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /showTracking && order\.shipmentReference/);
  assert.match(source, /value=\{order\.shipmentReference\} label="رقم التتبع" compact/);
  assert.match(source, /<OrderList orders=\{shippingOrders\.slice\(0, visibleLimit\)\} onSelect=\{setSelected\} showTracking/);
  assert.match(source, /href=\{`tel:\+\$\{order\.phone\.replace/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
});
