import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { env, equal, isAuthenticated, ordersStore } from './core.mjs';
import { agentCodePrefix } from './order-codes.mjs';

const COOKIE = 'daftar_agent_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const agentKey = (id) => `agents/${id}`;
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || password.trim() !== password) {
    throw new Error('اختر كلمة مرور من 8 إلى 128 حرفًا، بدون مسافات في البداية أو النهاية.');
  }
}
const sign = (value) => createHmac('sha256', env('APP_TOKEN')).update(`agent:${value}`).digest('hex');

export function publicAgent(agent) {
  return { id: agent.id, name: agent.name, username: agent.username, enabled: agent.enabled, createdAt: agent.createdAt };
}
export async function listAgents() {
  const agents = (await ordersStore().listValues({ prefix: 'agents/' })).map(({ value }) => value);
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
  const prefix = agentCodePrefix(username);
  const agents = await listAgents();
  if (agents.some((agent) => agent.username === username)) throw new Error('اسم الدخول مستخدم بالفعل.');
  if (agents.some((agent) => agentCodePrefix(agent.username) === prefix)) throw new Error(`رمز الطلب ${prefix} مستخدم لمندوبة أخرى. اختر اسم دخول يبدأ بحرفين مختلفين.`);
  if (await ordersStore().get(`order-sequence/${prefix}`)) throw new Error(`رمز الطلب ${prefix} مستخدم في طلبات سابقة. اختر اسم دخول يبدأ بحرفين مختلفين.`);
  const password = input?.password;
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const agent = { id: randomUUID(), name, username, salt, passwordHash: passwordHash(password, salt),
    enabled: true, sessionVersion: 1, createdAt: new Date().toISOString() };
  const result = await ordersStore().setJSON(agentKey(agent.id), agent, { onlyIfNew: true });
  if (!result.modified) throw new Error('تعذر إنشاء الحساب. حاول مرة ثانية.');
  return publicAgent(agent);
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
  validatePassword(chosenPassword);
  const salt = randomBytes(16).toString('hex');
  const current = await readAgent(id);
  if (!current) throw new Error('حساب المندوبة غير موجود.');
  const next = await changeAgent(id, { salt, passwordHash: passwordHash(chosenPassword, salt), sessionVersion: current.sessionVersion + 1 });
  return publicAgent(next);
}
export async function changeOwnAgentPassword(id, currentPassword, nextPassword) {
  validatePassword(nextPassword);
  if (typeof currentPassword !== 'string') throw new Error('أدخل كلمة المرور الحالية.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await ordersStore().getWithMetadata(agentKey(id), { type: 'json' });
    if (!entry?.data?.enabled) throw new Error('حساب المندوبة غير متاح.');
    if (!equal(passwordHash(currentPassword, entry.data.salt), entry.data.passwordHash)) throw new Error('كلمة المرور الحالية غير صحيحة.');
    if (currentPassword === nextPassword) throw new Error('اختر كلمة مرور جديدة مختلفة عن الحالية.');
    const salt = randomBytes(16).toString('hex');
    const next = { ...entry.data, salt, passwordHash: passwordHash(nextPassword, salt), sessionVersion: entry.data.sessionVersion + 1 };
    const result = await ordersStore().setJSON(agentKey(id), next, { onlyIfMatch: entry.etag });
    if (result.modified) return next;
  }
  throw new Error('تغيّر الحساب أثناء الحفظ. حاول مرة ثانية.');
}
export async function updateAgentProfile(id, input) {
  const current = await readAgent(id);
  if (!current) throw new Error('حساب المندوبة غير موجود.');
  const name = String(input?.name || '').trim().slice(0, 80);
  const username = String(input?.username || '').trim().toLowerCase();
  if (name.length < 2 || !/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('اكتب اسم المندوبة واسم دخول إنجليزي من 3 أحرف على الأقل.');
  const prefix = agentCodePrefix(username);
  const agents = await listAgents();
  if (agents.some((agent) => agent.id !== id && agent.username === username)) throw new Error('اسم الدخول مستخدم بالفعل.');
  if (agents.some((agent) => agent.id !== id && agentCodePrefix(agent.username) === prefix)) throw new Error(`رمز الطلب ${prefix} مستخدم لمندوبة أخرى. اختر اسم دخول يبدأ بحرفين مختلفين.`);
  const previous = await ordersStore().get(`order-sequence/${prefix}`);
  if (previous && previous.ownerId !== id) throw new Error(`رمز الطلب ${prefix} مستخدم في طلبات سابقة. اختر اسم دخول يبدأ بحرفين مختلفين.`);
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

