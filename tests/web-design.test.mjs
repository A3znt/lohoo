import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the Rukn identity loads after component and Aurora styles', async () => {
  const [main, theme, rukn] = await Promise.all([read('web/src/main.tsx'), read('web/src/aurora-theme.css'), read('web/src/rukn-theme.css')]);
  assert.ok(main.indexOf("import './aurora-theme.css'") > main.indexOf("import './style.css'"));
  assert.ok(main.indexOf("import './rukn-theme.css'") > main.indexOf("import './aurora-theme.css'"));
  assert.match(main, /rukn-logo\.png/);
  assert.match(rukn, /--aurora-blue:#a48957/);
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
  assert.equal(manifest.theme_color, '#211e1b');
  assert.equal(manifest.background_color, '#f7f3eb');
  assert.equal(manifest.short_name, 'ركن');
  assert.match(html, /name="theme-color" content="#211e1b"/);
  assert.match(html, /<title>ركن/);
  assert.match(worker, /rukn-static-v9/);
  assert.equal(manifest.dir, 'rtl');
});

test('holographic overview chart is calculated from order dates instead of fixture data', async () => {
  const [view, dashboard] = await Promise.all([read('web/src/main.tsx'), read('web/src/order-view.ts')]);
  assert.match(view, /className="insights-panel"/);
  assert.match(view, /weeklyOrderActivity\(countedOrders\)/);
  assert.match(view, /day\.count/);
  assert.match(dashboard, /orders\.reduce\(\(total, order\)/);
  assert.match(dashboard, /Date\.parse\(order\.createdAt\)/);
  assert.match(dashboard, /length: 7/);
  assert.doesNotMatch(view, /fakeChartData|Math\.random\(/);
});
