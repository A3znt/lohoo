import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { env, equal, isAuthenticated, ordersStore } from './core.mjs';

const COOKIE = 'daftar_agent_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const agentKey = (id) => `agents/${id}`;
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const simplePassword = () => String(randomBytes(4).readUInt32BE() % 90000000 + 10000000);
function validatePassword(password) {
  if (!/^[0-9]{8}$/.test(password)) throw new Error('كلمة المرور يجب أن تكون 8 أرقام.');
}
const sign = (value) => createHmac('sha256', env('APP_TOKEN')).update(`agent:${value}`).digest('hex');

export function publicAgent(agent) {
  return { id: agent.id, name: agent.name, username: agent.username, enabled: agent.enabled, createdAt: agent.createdAt };
}
export async function listAgents() {
  const { blobs } = await ordersStore().list({ prefix: 'agents/' });
  const agents = await Promise.all(blobs.map(({ key }) => ordersStore().get(key, { type: 'json' })));
  return agents.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
export async function readAgent(id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) return null;
  return ordersStore().get(agentKey(id), { type: 'json' });
}
export async function createAgent(input) {
  const name = String(input?.name || '').trim().slice(0, 80);
  const username = String(input?.username || '').trim().toLowerCase();
  if (name.length < 2 || !/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('اكتب اسم المندوبة واسم دخول إنجليزي من 3 أحرف على الأقل.');
  if ((await listAgents()).some((agent) => agent.username === username)) throw new Error('اسم الدخول مستخدم بالفعل.');
  const password = input?.password === undefined ? simplePassword() : String(input.password);
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const agent = { id: randomUUID(), name, username, salt, passwordHash: passwordHash(password, salt),
    enabled: true, sessionVersion: 1, createdAt: new Date().toISOString() };
  const result = await ordersStore().setJSON(agentKey(agent.id), agent, { onlyIfNew: true });
  if (!result.modified) throw new Error('تعذر إنشاء الحساب. حاول مرة ثانية.');
  return { ...publicAgent(agent), password };
}
export async function changeAgent(id, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await ordersStore().getWithMetadata(agentKey(id), { type: 'json' });
    if (!entry) throw new Error('حساب المندوبة غير موجود.');
    const next = { ...entry.data, ...change };
    const result = await ordersStore().setJSON(agentKey(id), next, { onlyIfMatch: entry.etag });
    if (result.modified) return next;
  }
  throw new Error('تغيّر الحساب أثناء الحفظ. حاول مرة ثانية.');
}
export async function resetAgentPassword(id, chosenPassword) {
  const password = chosenPassword === undefined ? simplePassword() : String(chosenPassword);
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const current = await readAgent(id);
  if (!current) throw new Error('حساب المندوبة غير موجود.');
  const next = await changeAgent(id, { salt, passwordHash: passwordHash(password, salt), sessionVersion: current.sessionVersion + 1 });
  return { ...publicAgent(next), password };
}
export async function updateAgentProfile(id, input) {
  const current = await readAgent(id);
  if (!current) throw new Error('حساب المندوبة غير موجود.');
  const name = String(input?.name || '').trim().slice(0, 80);
  const username = String(input?.username || '').trim().toLowerCase();
  if (name.length < 2 || !/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('اكتب اسم المندوبة واسم دخول إنجليزي من 3 أحرف على الأقل.');
  if ((await listAgents()).some((agent) => agent.id !== id && agent.username === username)) throw new Error('اسم الدخول مستخدم بالفعل.');
  return publicAgent(await changeAgent(id, { name, username }));
}
export async function setAgentEnabled(id, enabled) {
  const current = await readAgent(id);
  if (!current) throw new Error('حساب المندوبة غير موجود.');
  const next = await changeAgent(id, { enabled: Boolean(enabled), sessionVersion: current.sessionVersion + 1 });
  return publicAgent(next);
}
export async function loginAgent(username, password) {
  const normalized = String(username || '').trim().toLowerCase();
  const agent = (await listAgents()).find((item) => item.username === normalized && item.enabled);
  if (!agent || typeof password !== 'string') return null;
  const actual = passwordHash(password, agent.salt);
  if (!equal(actual, agent.passwordHash)) return null;
  return agent;
}
export function agentSessionCookie(agent) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${agent.id}.${agent.sessionVersion}.${expires}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearAgentSessionCookie() { return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
export async function getActor(request) {
  if (isAuthenticated(request)) return { role: 'admin', id: 'admin', name: 'المدير' };
  if (!env('APP_TOKEN')) return null;
  const cookies = request.headers.get('Cookie') || '';
  const value = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [id, version, expires, mac] = value.split('.');
  if (!/^[a-f0-9-]{36}$/.test(id || '') || !/^\d+$/.test(version || '') || !/^\d{10}$/.test(expires || '')) return null;
  if (Number(expires) <= Date.now() / 1000 || !equal(mac, sign(`${id}.${version}.${expires}`))) return null;
  const agent = await readAgent(id);
  if (!agent?.enabled || agent.sessionVersion !== Number(version)) return null;
  return { role: 'agent', id: agent.id, name: agent.name, username: agent.username };
}

