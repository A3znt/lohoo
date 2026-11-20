import { clearSessionCookie, json, sameOrigin, sessionCookie } from './core.mjs';
import { agentSessionCookie, clearAgentSessionCookie, getActor, loginAgent } from './team.mjs';

export default async function handler(request) {
  if (request.method === 'GET') {
    const actor = await getActor(request);
    return json({ ok: true, authenticated: Boolean(actor), actor });
  }
  if (request.method !== 'POST' || !sameOrigin(request)) return json({ ok: false, error: 'طلب غير مسموح.' }, 403);
  const body = await request.json().catch(() => ({}));
  if (body.action === 'logout') {
    const response = json({ ok: true });
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', clearAgentSessionCookie());
    return response;
  }
  if (body.username !== undefined) {
    const agent = await loginAgent(body.username, body.password);
    if (!agent) return json({ ok: false, error: 'بيانات الدخول غير صحيحة.' }, 401);
    const response = json({ ok: true, actor: { role: 'agent', id: agent.id, name: agent.name } });
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', agentSessionCookie(agent));
    return response;
  }
  const cookie = sessionCookie(body.token);
  if (!cookie) return json({ ok: false, error: 'رمز الدخول غير صحيح.' }, 401);
  const response = json({ ok: true, actor: { role: 'admin', id: 'admin', name: 'المدير' } });
  response.headers.append('Set-Cookie', cookie);
  response.headers.append('Set-Cookie', clearAgentSessionCookie());
  return response;
}

