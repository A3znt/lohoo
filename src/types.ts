export type Channel = 'facebook' | 'instagram';
export type OrderStatus = 'جديد' | 'مؤكد' | 'جاهز للشحن' | 'قيد التوصيل' | 'تم التسليم' | 'راجع' | 'ملغي';

export type Order = {
  id: string;
  createdAt: string;
  channel: Channel;
  customer: string;
  phone: string;
  city: string;
  area: string;
  address: string;
  product: string;
  quantity: number;
  unitPrice: number;
  deliveryFee: number;
  paid: number;
  status: OrderStatus;
  notes: string;
  shipmentReference: string;
};

export const statuses: OrderStatus[] = ['جديد', 'مؤكد', 'جاهز للشحن', 'قيد التوصيل', 'تم التسليم', 'راجع', 'ملغي'];

export const emptyOrder = (): Order => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  createdAt: new Date().toISOString(),
  channel: 'facebook', customer: '', phone: '', city: '', area: '', address: '',
  product: '', quantity: 1, unitPrice: 0, deliveryFee: 0, paid: 0,
  status: 'جديد', notes: '', shipmentReference: '',
});

export const orderTotal = (order: Order) => order.quantity * order.unitPrice + order.deliveryFee;
