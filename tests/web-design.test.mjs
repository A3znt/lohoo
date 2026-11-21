import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the Apple-inspired visual layer is loaded after legacy component styles', async () => {
  const [main, theme] = await Promise.all([read('web/src/main.tsx'), read('web/src/apple-theme.css')]);
  assert.ok(main.indexOf("import './apple-theme.css'") > main.indexOf("import './style.css'"));
  assert.match(theme, /--ios-blue:#007aff/);
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
  assert.equal(manifest.theme_color, '#f5f5f7');
  assert.equal(manifest.background_color, '#f5f5f7');
  assert.match(html, /name="theme-color" content="#f5f5f7"/);
  assert.match(worker, /daftar-static-v3/);
  assert.equal(manifest.dir, 'rtl');
});
