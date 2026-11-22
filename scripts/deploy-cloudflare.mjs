import { readFile } from 'node:fs/promises';

const account = 'a00a948f2c21dfb3aadead6f853ffdca';
const database = 'fbc6a70c-490a-4365-96e1-879447e94b36';
const worker = 'daftar-orders-personal';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN in the shell before deploying.');

const vars = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => { const split = line.indexOf('='); return [line.slice(0, split), JSON.parse(line.slice(split + 1))]; }));
for (const name of ['APP_TOKEN', 'ADMIN_PASSWORD_SALT', 'ADMIN_PASSWORD_HASH', 'DARB_API_KEY', 'DARB_ACCOUNT_ID',
  'RESALA_API_KEY', 'RESALA_CONFIRM_ADDRESS_TEMPLATE_ID', 'RESALA_ON_WAY_TEMPLATE_ID',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  if (!vars[name]) throw new Error(`Missing ${name} in .dev.vars.`);
}

const metadata = {
  main_module: 'worker.mjs', compatibility_date: '2026-11-20', compatibility_flags: ['nodejs_compat'],
  bindings: [{ name: 'DB', type: 'd1', database_id: database },
    ...Object.entries(vars).map(([name, text]) => ({ name, type: 'secret_text', text }))],
  observability: { enabled: true, logs: { enabled: true, invocation_logs: true }, traces: { enabled: true } },
};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.append('worker.mjs', new Blob([await readFile(new URL('../.private/cloudflare-worker.mjs', import.meta.url))],
  { type: 'application/javascript+module' }), 'worker.mjs');
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
async function request(path, method, body) {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) }, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(`${method} failed: ${response.status} ${payload.errors?.map((e) => e.message).join('; ') || ''}`);
  return payload.result;
}
await request(endpoint, 'PUT', form);
await request(`${endpoint}/schedules`, 'PUT', JSON.stringify([{ cron: '*/5 * * * *' }]));
console.log(`Deployed https://${worker}.daftar-orders-a3z.workers.dev`);
