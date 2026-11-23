import { withContext } from './runtime.mjs';
import api from './api.mjs';
import auth from './auth.mjs';
import sync from './sync.mjs';
import { assets } from './assets-generated.mjs';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

function staticResponse(request) {
  const path = new URL(request.url).pathname;
  const file = assets[path] || assets['/index.html'];
  if (!file) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  const headers = { 'Content-Type': file.type, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
  return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    return withContext({ ...env, __EXECUTION_CONTEXT: ctx }, async () => {
      const path = new URL(request.url).pathname;
      let response;
      try {
        if (path === '/api/auth') response = await auth(request);
        else if (path === '/api/orders') response = await api(request);
        else if (path.startsWith('/api/')) response = Response.json({ ok: false, error: 'المسار غير موجود.' }, { status: 404 });
        else if (request.method === 'GET' || request.method === 'HEAD') response = env.ASSETS ? await env.ASSETS.fetch(request) : staticResponse(request);
        else response = Response.json({ ok: false, error: 'طلب غير مسموح.' }, { status: 405 });
      } catch (error) {
        console.error(JSON.stringify({ event: 'request_failed', path, message: error instanceof Error ? error.message : String(error) }));
        response = Response.json({ ok: false, error: 'تعذر تنفيذ الطلب.' }, { status: 500 });
      }
      const outgoing = new Response(response.body, response);
      for (const [key, value] of Object.entries(securityHeaders)) outgoing.headers.set(key, value);
      return outgoing;
    });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(withContext({ ...env, __EXECUTION_CONTEXT: ctx }, () => sync()));
  },
};
