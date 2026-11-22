/**
 * Serialize only the orders already visible to this signed-in user.
 * CSV injection is mitigated because spreadsheet applications may execute
 * cells beginning with formula operators when an export is opened.
 */
const headings = [
  'رقم الطلب', 'تاريخ الإنشاء', 'الزبون', 'رقم الهاتف', 'المصدر',
  'المنتج', 'الكمية', 'سعر القطعة', 'رسوم التوصيل', 'الإجمالي',
  'المحصّل', 'المتبقي', 'حالة الطلب', 'رقم التتبع',
  'المدينة', 'المنطقة', 'العنوان', 'المندوبة', 'ملاحظات',
];

const statuses = {
  creating: 'جاري إنشاء الشحنة',
  confirmed: 'تم التأكيد',
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
    const total = order.quantity * order.unitPrice + order.deliveryFee;
    const remaining = Math.max(0, total - order.paid);
    lines.push([
      order.exportNumber, order.createdAt, order.customer, order.phone,
      order.source === 'instagram' ? 'إنستغرام' : 'فيسبوك',
      order.product, order.quantity, order.unitPrice, order.deliveryFee,
      total, order.paid, remaining, statuses[order.status] || order.status,
      order.shipmentReference, order.city, order.area, order.address,
      order.agentName || '', order.notes,
    ].map(csvCell).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
