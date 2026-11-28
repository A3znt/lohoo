import { orderNumber, orderTotal, type Order, type OrderStatus } from './api';

export function displayOrderStatus(status: OrderStatus): OrderStatus {
  return status === 'creating' ? 'confirmed' : status === 'processing' ? 'on_way' : status;
}

export function dashboardMetrics(orders: readonly Order[]) {
  const active = orders.filter((order) => !['cancelled', 'returned'].includes(order.status));
  const revenue = active.reduce((sum, order) => sum + orderTotal(order), 0);
  const paid = active.reduce((sum, order) => sum + order.paid, 0);
  return {
    total: orders.length,
    active: active.filter((order) => order.status !== 'delivered').length,
    onWay: active.filter((order) => displayOrderStatus(order.status) === 'on_way').length,
    revenue,
    paid,
    due: Math.max(0, revenue - paid),
    attention: orders.filter((order) => ['attention', 'delivery_failed'].includes(order.status)).length,
  };
}

export function filterOrders(orders: readonly Order[], status: 'all' | OrderStatus, query: string): Order[] {
  const needle = query.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    if (status !== 'all' && displayOrderStatus(order.status) !== displayOrderStatus(status)) return false;
    if (!needle) return true;
    const searchable = [
      orderNumber(order), order.customer, order.phone, ...(order.additionalPhones || []), order.product, order.sku,
      ...(order.items || []).flatMap((item) => [item.product, item.sku]),
      order.city, order.area, order.address, order.shipmentReference,
      order.agentName, order.createdByName,
    ];
    return searchable.filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
  });
}

export interface DayActivity { label: string; count: number }

/**
 * Return the previous seven local calendar days, including today.
 * Counts only orders actually present in the signed-in user's bootstrap data.
 */
export function weeklyOrderActivity(orders: readonly Pick<Order, 'createdAt'>[], now = new Date()): DayActivity[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const formatter = new Intl.DateTimeFormat('ar-LY', { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => {
    const start = new Date(midnight);
    start.setDate(midnight.getDate() - 6 + index);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const from = start.getTime();
    const to = end.getTime();
    return {
      label: formatter.format(start),
      count: orders.reduce((total, order) => {
        const created = Date.parse(order.createdAt);
        return total + (Number.isFinite(created) && created >= from && created < to ? 1 : 0);
      }, 0),
    };
  });
}

export type OrderSort = 'newest' | 'oldest' | 'highest_total' | 'lowest_total';

export function sortOrders(orders: readonly Order[], sort: OrderSort): Order[] {
  const rows = [...orders];
  const date = (order: Order) => {
    const value = Date.parse(order.createdAt);
    return Number.isFinite(value) ? value : 0;
  };
  switch (sort) {
    case 'oldest': return rows.sort((a, b) => date(a) - date(b));
    case 'highest_total': return rows.sort((a, b) => orderTotal(b) - orderTotal(a));
    case 'lowest_total': return rows.sort((a, b) => orderTotal(a) - orderTotal(b));
    default: return rows.sort((a, b) => date(b) - date(a));
  }
}
