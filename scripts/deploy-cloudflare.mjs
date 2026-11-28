import { readFile } from 'node:fs/promises';

const account = 'a00a948f2c21dfb3aadead6f853ffdca';
const database = 'fbc6a70c-490a-4365-96e1-879447e94b36';
const worker = process.env.RUKN_WORKER_NAME || 'rukn';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN in the shell before deploying.');

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
async function request(path, method, body) {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) }, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(`${method} failed: ${response.status} ${payload.errors?.map((e) => e.message).join('; ') || ''}`);
  return payload.result;
}
const current = await request(`${endpoint}/settings`, 'GET');
const bindings = current.bindings || [];
const secretNames = new Set(bindings.filter((binding) => binding.type === 'secret_text').map((binding) => binding.name));
for (const name of ['APP_TOKEN', 'ADMIN_PASSWORD_SALT', 'ADMIN_PASSWORD_HASH', 'DARB_API_KEY', 'DARB_ACCOUNT_ID',
  'RESALA_API_KEY', 'RESALA_CONFIRM_ADDRESS_TEMPLATE_ID', 'RESALA_ON_WAY_TEMPLATE_ID', 'RESALA_POSTPONED_TEMPLATE_ID',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  if (!secretNames.has(name)) throw new Error(`Missing deployed secret ${name}; stop before replacing the Worker.`);
}
const db = bindings.find((binding) => binding.name === 'DB' && binding.type === 'd1');
if (db?.database_id !== database) throw new Error('D1 binding differs from the expected production database.');
const unsupported = bindings.filter((binding) => !['secret_text', 'd1'].includes(binding.type));
if (unsupported.length) throw new Error(`Unexpected binding types: ${unsupported.map((binding) => binding.type).join(', ')}`);
const metadata = {
  main_module: 'worker.mjs', compatibility_date: '2026-11-20', compatibility_flags: ['nodejs_compat'],
  bindings: bindings.map((binding) => binding.type === 'secret_text'
    ? { name: binding.name, type: 'inherit' }
    : { name: binding.name, type: 'd1', database_id: binding.database_id }),
  observability: { enabled: true, logs: { enabled: true, invocation_logs: true }, traces: { enabled: true } },
};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.append('worker.mjs', new Blob([await readFile(new URL('../.private/cloudflare-worker.mjs', import.meta.url))],
  { type: 'application/javascript+module' }), 'worker.mjs');
await request(`${endpoint}?bindings_inherit=strict`, 'PUT', form);
await request(`${endpoint}/schedules`, 'PUT', JSON.stringify([{ cron: '*/5 * * * *' }]));
const subdomain = (await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, 'GET')).subdomain;
console.log(`Deployed https://${worker}.${subdomain}.workers.dev`);
