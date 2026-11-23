export type OrderStatus = 'creating' | 'confirmed' | 'on_way' | 'postponed' | 'delivery_failed' | 'delivered' | 'returned' | 'cancelled' | 'attention';
export type SmsStatus = 'pending' | 'needs_key' | 'sending' | 'sent' | 'delivered' | 'failed' | 'unknown';
export interface OrderItem { product: string; quantity: number; unitPrice: number; warehouseProductId: string; warehouseVariantId: string; sku?: string; widthCM?: number; heightCM?: number; lengthCM?: number }
export interface Order {
  id: string; carrierDeletedAt?: string; orderNumber?: string; createdById?: string; createdByName?: string;
  createdAt: string; updatedAt: string; source: 'facebook' | 'instagram';
  customer: string; phone: string; additionalPhones?: string[]; city: string; area: string; address: string;
  product: string; quantity: number; unitPrice: number; items?: OrderItem[]; deliveryFee: number; paid: number; weightKg?: number;
  warehouseProductId?: string; warehouseVariantId?: string; sku?: string;
  widthCM?: number; heightCM?: number; lengthCM?: number;
  variantAttributes?: { key: string; value: string }[];
  notes: string; serviceId: string; status: OrderStatus; shipmentReference: string;
  darbStatus: string; shippingPrice: unknown; shippingError: string;
  carrierReason?: string;
  confirmationSms: SmsStatus; onWaySms: SmsStatus;
  confirmationSmsError?: string; onWaySmsError?: string;
  agentId?: string; agentName?: string; commissionAmount?: number; commissionEarnedAt?: string; commissionPaidAt?: string;
}
export interface Actor { role: 'admin' | 'agent'; id: string; name: string; username?: string }
export interface CommissionSummary { assigned: number; delivered: number; earned: number; paid: number; due: number }
export interface WalletEntry { orderId: string; orderNumber?: string; customer: string; product: string; status: OrderStatus; createdAt: string; deletedAt: string; commissionAmount: number; commissionEarnedAt: string; commissionPaidAt: string }
export interface AgentSummary extends CommissionSummary { id: string; name: string; username: string; enabled: boolean; createdAt: string }
export interface Settings { serviceId: string; autoMessages: boolean }
export interface NotificationRecord { id: string; agentId: string; orderId: string; kind: 'postponed' | 'delivery_failed' | 'cancelled' | 'manual' | 'new_order' | 'daily_digest' | 'order_attention' | 'sms_alert' | 'order_activity' | 'carrier_status'; title: string; body: string; reason: string; createdAt: string; readAt: string }
export interface Package { _id: string; title?: string; name?: string; price?: number; attributes?: string[] }
export interface WarehouseVariant { id: string; sku: string; attributes: { key: string; value: string }[]; widthCM: number; heightCM: number; lengthCM: number; isFragile: boolean; allowInspection: boolean; allowTesting: boolean }
export interface WarehouseProduct { id: string; name: string; salePrice: number; currency: string; isPublished: boolean; isReviewed: boolean; isBlocked: boolean; variants: WarehouseVariant[] }
export interface Bootstrap { actor: Actor; orders: Order[]; settings: Settings; resalaConfigured: boolean; notifications: NotificationRecord[]; vapidPublicKey: string; agents: AgentSummary[]; commission: CommissionSummary; walletEntries: WalletEntry[]; dailyReviewDate: string; dailyReviewedIds: string[] }
export type OrderInput = Pick<Order, 'id' | 'source' | 'customer' | 'phone' | 'city' | 'area' | 'address' | 'product' | 'quantity' | 'unitPrice' | 'deliveryFee' | 'paid' | 'notes'> & { items?: OrderItem[]; additionalPhones?: string[]; weightKg?: number; serviceId?: string; warehouseProductId: string; warehouseVariantId: string; agentId?: string };

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiResponse {
  ok?: boolean;
  error?: string;
  authenticated?: boolean;
  actor?: Actor;
  data?: unknown;
}

async function requestJson(url: string, options: RequestInit): Promise<ApiResponse> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...options });
  } catch {
    throw new ApiError('تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مجددًا.', 0);
  }
  let result: ApiResponse;
  try {
    result = await response.json() as ApiResponse;
  } catch {
    throw new ApiError('استجابة غير متوقعة من الخادم. حدّث الصفحة ثم حاول مجددًا.', response.status);
  }
  if (!result || typeof result !== 'object') {
    throw new ApiError('الاستجابة من الخادم غير صحيحة.', response.status);
  }
  if (!response.ok || result.ok !== true) {
    const message = result.error || (response.status === 401
      ? 'انتهت الجلسة، سجّل الدخول مجددًا.'
      : `تعذر تنفيذ الطلب (HTTP ${response.status}).`);
    throw new ApiError(message, response.status);
  }
  return result;
}

const jsonPost = (body: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function session(): Promise<Actor | null> {
  const result = await requestJson('/api/auth', { method: 'GET' });
  return result.authenticated && result.actor ? result.actor : null;
}
export async function login(token: string): Promise<void> {
  await requestJson('/api/auth', jsonPost({ token }));
}
export async function loginAgent(username: string, password: string): Promise<void> {
  await requestJson('/api/auth', jsonPost({ username, password }));
}
export async function logout(): Promise<void> {
  await requestJson('/api/auth', jsonPost({ action: 'logout' }));
}
export async function api<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const result = await requestJson('/api/orders', jsonPost({ action, ...data }));
  return result.data as T;
}
export function money(value: number): string { return `${new Intl.NumberFormat('ar-LY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} د.ل`; }
export function orderTotal(order: Pick<Order, 'quantity' | 'unitPrice' | 'deliveryFee' | 'items'>): number {
  const subtotal = order.items?.length ? order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) : order.quantity * order.unitPrice;
  return subtotal + order.deliveryFee;
}
export function orderNumber(order: Pick<Order, 'id' | 'orderNumber'>): string {
  if (order.orderNumber && /^(?:[A-Z]{2}\d{3}|\d{12})$/.test(order.orderNumber)) return order.orderNumber;
  return (BigInt(`0x${order.id.replaceAll('-', '')}`) % 1000000000000n).toString().padStart(12, '0');
}
