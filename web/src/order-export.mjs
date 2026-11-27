/**
 * Serialize only the orders already visible to this signed-in user.
 * CSV injection is mitigated because spreadsheet applications may execute
 * cells beginning with formula operators when an export is opened.
 */
const headings = [
  'رقم الطلب', 'تاريخ الإنشاء', 'الزبون', 'رقم الهاتف', 'المصدر',
  'المنتج', 'الكمية', 'سعر القطعة', 'رسوم التوصيل', 'الإجمالي',
  'المحصّل', 'المتبقي', 'حالة الطلب', 'رقم التتبع',
  'المدينة', 'المنطقة', 'العنوان', 'المندوبة', 'ملاحظات', 'أرقام إضافية', 'الوزن التقريبي (كجم)', 'كل المنتجات', 'طريقة الدفع',
];

const statuses = {
  creating: 'جاري إنشاء الشحنة',
  confirmed: 'قيد التجهيز',
  processing: 'قيد المعالجة',
  on_way: 'في الطريق',
  postponed: 'مؤجل',
  delivery_failed: 'تعذر التوصيل',
  delivered: 'تم التسليم',
  returned: 'مرتجع',
  cancelled: 'ملغي',
  attention: 'يحتاج مراجعة',
};

export function csvCell(input) {
  const value = input == null ? '' : String(input);
  const protectedText = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function exportOrdersCsv(orders) {
  const lines = [headings.map(csvCell).join(',')];
  for (const order of orders) {
    const items = Array.isArray(order.items) && order.items.length ? order.items : [order];
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) + order.deliveryFee;
    const remaining = Math.max(0, total - order.paid);
    lines.push([
      order.exportNumber, order.createdAt, order.customer, order.phone,
      order.source === 'instagram' ? 'إنستغرام' : 'فيسبوك',
      order.product, order.quantity, order.unitPrice, order.deliveryFee,
      total, order.paid, remaining, statuses[order.status] || order.status,
      order.shipmentReference, order.city, order.area, order.address,
      order.agentName || '', order.notes, (order.additionalPhones || []).join(' / '), order.weightKg || '',
      items.map((item) => `${item.product} × ${item.quantity} × ${item.unitPrice}`).join(' | '), order.paymentMethod || 'كاش',
    ].map(csvCell).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
