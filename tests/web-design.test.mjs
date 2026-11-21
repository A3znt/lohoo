import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the reference-inspired Aurora visual layer loads after legacy component styles', async () => {
  const [main, theme] = await Promise.all([read('web/src/main.tsx'), read('web/src/aurora-theme.css')]);
  assert.ok(main.indexOf("import './aurora-theme.css'") > main.indexOf("import './style.css'"));
  assert.match(theme, /--aurora-blue:#2c80ff/);
  assert.match(theme, /prefers-reduced-motion:reduce/);
  assert.match(theme, /safe-area-inset-bottom/);
});

test('mobile navigation exposes current page and all account-appropriate destinations', async () => {
  const source = await read('web/src/main.tsx');
  assert.match(source, /className="bottom-tabs" aria-label="التنقل السريع"/);
  assert.match(source, /aria-current=\{view === key \? 'page' : undefined\}/);
  assert.match(source, /\['overview', LayoutDashboard/);
  assert.match(source, /\['orders', ClipboardList/);
  assert.match(source, /\['shipping', Truck/);
  assert.match(source, /data\.actor\.role === 'admin'/);
});

test('standalone web app colors match browser theme and refresh offline cache', async () => {
  const [html, manifestText, worker] = await Promise.all([
    read('web/index.html'), read('web/public/manifest.webmanifest'), read('web/public/sw.js'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.theme_color, '#0b1732');
  assert.equal(manifest.background_color, '#eaf1fd');
  assert.match(html, /name="theme-color" content="#0b1732"/);
  assert.match(worker, /daftar-static-v4/);
  assert.equal(manifest.dir, 'rtl');
});

test('holographic overview chart is calculated from order dates instead of fixture data', async () => {
  const [view, dashboard] = await Promise.all([read('web/src/main.tsx'), read('web/src/order-view.ts')]);
  assert.match(view, /className="insights-panel"/);
  assert.match(view, /weeklyOrderActivity\(data\.orders\)/);
  assert.match(view, /day\.count/);
  assert.match(dashboard, /orders\.reduce\(\(total, order\)/);
  assert.match(dashboard, /Date\.parse\(order\.createdAt\)/);
  assert.match(dashboard, /length: 7/);
  assert.doesNotMatch(view, /fakeChartData|Math\.random\(/);
});
