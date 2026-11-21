import { orderNumber, orderTotal, type Order, type OrderStatus } from './api';

export function dashboardMetrics(orders: readonly Order[]) {
  const active = orders.filter((order) => !['cancelled', 'returned'].includes(order.status));
  const revenue = active.reduce((sum, order) => sum + orderTotal(order), 0);
  const paid = active.reduce((sum, order) => sum + order.paid, 0);
  return {
    total: orders.length,
    active: active.filter((order) => order.status !== 'delivered').length,
    onWay: active.filter((order) => order.status === 'on_way').length,
    revenue,
    paid,
    due: Math.max(0, revenue - paid),
    attention: orders.filter((order) => order.status === 'attention').length,
  };
}

export function filterOrders(orders: readonly Order[], status: 'all' | OrderStatus, query: string): Order[] {
  const needle = query.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    if (status !== 'all' && order.status !== status) return false;
    if (!needle) return true;
    const searchable = [
      orderNumber(order), order.customer, order.phone, order.product, order.sku,
      order.city, order.area, order.address, order.shipmentReference,
      order.agentName, order.createdByName,
    ];
    return searchable.filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
  });
}
