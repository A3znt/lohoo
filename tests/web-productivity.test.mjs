import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('copy stays on useful identifiers and contact details, not dashboard totals', async () => {
  const [main, copy] = await Promise.all([read('web/src/main.tsx'), read('web/src/CopyButton.tsx')]);
  assert.match(main, /<CopyButton value=\{orderNumber\(order\)\}/);
  assert.match(main, /label="رقم الهاتف الأساسي" value=\{order\.phone\} copyable/);
  assert.match(main, /label="رقم التتبع"[^>]*copyable/);
  assert.doesNotMatch(main, /label="الإجمالي"[^>]*copyable/);
  const metric = main.slice(main.indexOf('function Metric('), main.indexOf('function FlowStep('));
  assert.doesNotMatch(metric, /CopyButton/);
  assert.match(copy, /navigator\.clipboard\?\.writeText/);
  assert.match(copy, /event\.stopPropagation\(\)/);
  assert.match(copy, /aria-label=\{text\}/);
  assert.match(copy, /aria-live="polite"/);
});

test('order listing opens details without copy controls intercepting the row', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /className="order-row" role="group"/);
  assert.match(source, /className="row-open-action" onClick=\{\(\) => onSelect\(order\)\}/);
  assert.match(source, /aria-label=\{\`فتح الطلب /);
  assert.doesNotMatch(source, /<span className="order-id-line">[^\n]*<CopyButton/);
  assert.doesNotMatch(source, /className="order-row" role="button"/);
  assert.match(source, /visible\.slice\(0, visibleLimit\)/);
  assert.match(source, /shippingOrders\.slice\(0, visibleLimit\)/);
});

test('dashboard counts and postponed shortcut open matching order filters', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /const openOrders = \(status: 'all' \| OrderStatus\)/);
  assert.match(source, /setView\('orders'\); setMenuOpen\(false\); setFilter\(status\); setQuery\(''\)/);
  assert.match(source, /label="إجمالي الطلبات"[^\n]*onClick=\{\(\) => openOrders\('all'\)\}/);
  assert.match(source, /label="طلبات في الطريق"[^\n]*onClick=\{\(\) => openOrders\('on_way'\)\}/);
  assert.match(source, /\['postponed', 'مؤجل'\]/);
  assert.match(source, /onClick=\{\(\) => openOrders\(status\)\}/);
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

test('shipping list opens details with tracking copy and telephone action', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /showTracking && order\.shipmentReference/);
  assert.match(source, /label="رقم التتبع"[^>]*copyable/);
  assert.match(source, /<OrderList orders=\{shippingOrders\.slice\(0, visibleLimit\)\} onSelect=\{setSelected\} showTracking/);
  assert.match(source, /href=\{`tel:\+\$\{order\.phone\.replace/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
});

test('dialogs and keyboard users have focus, Escape, and skip-to-content affordances', async () => {
  const [main, form, theme] = await Promise.all([
    read('web/src/main.tsx'), read('web/src/OrderForm.tsx'), read('web/src/aurora-theme.css'),
  ]);
  assert.match(main, /className="skip-link" href="#rukn-main"/);
  assert.match(main, /id="rukn-main"/);
  assert.match(main, /event\.key !== 'Escape'/);
  assert.match(main, /aria-modal="true" aria-label=\{`تفاصيل الطلب/);
  assert.match(main, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(main, /aria-pressed=\{mode === 'admin'\}/);
  assert.match(form, /role="dialog" aria-modal="true"/);
  assert.match(form, /aria-pressed=\{form\.source === 'facebook'\}/);
  assert.match(form, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(theme, /\.skip-link:focus/);
});
