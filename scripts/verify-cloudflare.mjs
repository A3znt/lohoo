import { readFile } from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const privateRoot = new URL('../.private/', import.meta.url);
const credentials = JSON.parse(await readFile(new URL('team-credentials.json', privateRoot), 'utf8'));
const setup = await readFile(new URL('app-setup.txt', privateRoot), 'utf8');
const password = setup.match(/كلمة مرور المدير:\s*(\S+)/)?.[1];
if (!password) throw new Error('Admin password missing from local setup file.');

async function post(path, body, cookie = '') {
  const response = await fetch(new URL(path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error || 'unknown error'}`);
  return { response, data };
}
function cookie(response, name) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(';')[0] || '';
}

const home = await fetch(base);
if (!home.ok || !(await home.text()).includes('ركن')) throw new Error('Web app did not load.');
const adminLogin = await post('/api/auth', { token: password });
const adminCookie = cookie(adminLogin.response, 'daftar_session');
if (!adminCookie) throw new Error('Admin session cookie missing.');
const { data: bootstrap } = await post('/api/orders', { action: 'bootstrap' }, adminCookie);
if (bootstrap.data.actor.role !== 'admin' || !Array.isArray(bootstrap.data.orders) || bootstrap.data.agents.length < 2) throw new Error('Admin bootstrap failed.');
for (const [name, account] of Object.entries(credentials)) {
  const login = await post('/api/auth', { username: account.username, password: account.password });
  const agentCookie = cookie(login.response, 'daftar_agent_session');
  if (!agentCookie) throw new Error(`${name} session cookie missing.`);
  const result = await post('/api/orders', { action: 'bootstrap' }, agentCookie);
  if (result.data.data.actor.role !== 'agent') throw new Error(`${name} account not recognized.`);
}
const packages = await post('/api/orders', { action: 'packages' }, adminCookie);
const locations = await post('/api/orders', { action: 'deliveryLocations' }, adminCookie);
const products = await post('/api/orders', { action: 'warehouseProducts' }, adminCookie);
if (!packages.data.data.length || !locations.data.data.length || !products.data.data.length) throw new Error('Darb catalog is empty.');
console.log(JSON.stringify({ status: 'ok', activeOrders: bootstrap.data.orders.length, agents: bootstrap.data.agents.length,
  resalaConfigured: bootstrap.data.resalaConfigured, packages: packages.data.data.length,
  cities: locations.data.data.length, products: products.data.data.length }));
