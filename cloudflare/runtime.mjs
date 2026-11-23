import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

export function withContext(bindings, callback) {
  return requestContext.run(bindings, callback);
}

export function binding(name) {
  return requestContext.getStore()?.[name];
}

export function ordersStore() {
  const db = binding('DB');
  if (!db) throw new Error('قاعدة بيانات الطلبات غير متصلة.');
  return {
    async get(key) {
      const row = await db.prepare('SELECT data FROM records WHERE key = ?').bind(key).first();
      return row ? JSON.parse(row.data) : null;
    },
    async getWithMetadata(key) {
      const row = await db.prepare('SELECT data, etag FROM records WHERE key = ?').bind(key).first();
      return row ? { data: JSON.parse(row.data), etag: row.etag } : null;
    },
    async list({ prefix = '' } = {}) {
      const rows = await db.prepare('SELECT key FROM records WHERE key >= ? AND key < ? ORDER BY key').bind(prefix, `${prefix}\uffff`).all();
      return { blobs: (rows.results || []).map(({ key }) => ({ key })) };
    },
    async listValues({ prefix = '' } = {}) {
      const rows = await db.prepare('SELECT key, data FROM records WHERE key >= ? AND key < ? ORDER BY key').bind(prefix, `${prefix}\uffff`).all();
      return (rows.results || []).map(({ key, data }) => ({ key, value: JSON.parse(data) }));
    },
    async setJSON(key, value, options = {}) {
      const data = JSON.stringify(value);
      const etag = crypto.randomUUID();
      let result;
      if (options.onlyIfMatch) {
        result = await db.prepare('UPDATE records SET data = ?, etag = ? WHERE key = ? AND etag = ?')
          .bind(data, etag, key, options.onlyIfMatch).run();
      } else if (options.onlyIfNew) {
        result = await db.prepare('INSERT INTO records (key, data, etag) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
          .bind(key, data, etag).run();
      } else {
        result = await db.prepare('INSERT INTO records (key, data, etag) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, etag = excluded.etag')
          .bind(key, data, etag).run();
      }
      return { modified: Boolean(result.meta?.changes) };
    },
  };
}
