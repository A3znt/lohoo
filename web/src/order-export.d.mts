import type { Order } from './api';
export type ExportOrder = Order & { exportNumber: string };
export function csvCell(input: unknown): string;
export function exportOrdersCsv(orders: readonly ExportOrder[]): string;
