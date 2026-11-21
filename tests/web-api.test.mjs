import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Compile the real TypeScript module into an isolated ESM test instance.
const source = await readFile(new URL('../web/src/api.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const { api, login, logout, session, ApiError } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

test('clear transport errors identify a disconnected server without falsely signing out', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(api('bootstrap'), (error) => error instanceof ApiError &&
      error.status === 0 && /الاتصال بالخادم/.test(error.message));
    await assert.rejects(session(), (error) => error instanceof ApiError && error.status === 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('malformed JSON and server errors are reported, not silently treated as valid data', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>unexpected</html>', { status: 502 });
    await assert.rejects(api('bootstrap'), (error) => error instanceof ApiError &&
      error.status === 502 && /استجابة غير متوقعة/.test(error.message));
    globalThis.fetch = async () => Response.json({ ok: false, error: 'تحديث الخدمة مطلوب' }, { status: 503 });
    await assert.rejects(api('bootstrap'), (error) => error instanceof ApiError &&
      error.status === 503 && error.message === 'تحديث الخدمة مطلوب');
  } finally { globalThis.fetch = oldFetch; }
});

test('invalid passwords preserve the actual login error and logout rejects failure', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: false, error: 'بيانات الدخول غير صحيحة.' }, { status: 401 });
    await assert.rejects(login('wrong'), (error) => error instanceof ApiError &&
      error.status === 401 && /بيانات الدخول غير صحيحة/.test(error.message));
    globalThis.fetch = async () => Response.json({ ok: false, error: 'فشل الخروج.' }, { status: 500 });
    await assert.rejects(logout(), (error) => error instanceof ApiError && /فشل الخروج/.test(error.message));
    globalThis.fetch = async () => Response.json({ ok: true, authenticated: false, actor: null });
    assert.equal(await session(), null);
  } finally { globalThis.fetch = oldFetch; }
});

test('session and bootstrap return actual authorized data on valid responses', async () => {
  const oldFetch = globalThis.fetch;
  try {
    const actor = { role: 'agent', id: 'agent1', name: 'سجى' };
    globalThis.fetch = async (url) => Response.json(
      url === '/api/auth' ? { ok: true, authenticated: true, actor } : { ok: true, data: { actor, orders: [] } }
    );
    assert.deepEqual(await session(), actor);
    assert.deepEqual((await api('bootstrap')).actor, actor);
  } finally { globalThis.fetch = oldFetch; }
});
