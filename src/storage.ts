import * as SQLite from 'expo-sqlite';
import type { Order } from './types';

let database: SQLite.SQLiteDatabase | undefined;

async function db() {
  if (!database) {
    database = await SQLite.openDatabaseAsync('social-orders.db');
    await database.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);`);
  }
  return database;
}

export async function listOrders(): Promise<Order[]> {
  const rows = await (await db()).getAllAsync<{ data: string }>('SELECT data FROM orders ORDER BY created_at DESC');
  return rows.map((row) => JSON.parse(row.data) as Order);
}

export async function saveOrder(order: Order): Promise<void> {
  await (await db()).runAsync(
    'INSERT INTO orders (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    order.id, order.createdAt, JSON.stringify(order),
  );
}

export async function deleteOrder(id: string): Promise<void> {
  await (await db()).runAsync('DELETE FROM orders WHERE id = ?', id);
}
