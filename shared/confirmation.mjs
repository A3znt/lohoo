export const confirmationTemplate = `السلام عليكم $1، ركن للأثاث.

تم تأكيد طلبيتك: $2
الإجمالي: $3 د.ل شامل التوصيل.
العنوان: $4، $5
كود الطلبية الخاص بدرب السبيل: $6

شكراً لثقتك في ركن.`;

export function confirmationFields(order) {
  const suffix = ' - ' + order.sku;
  const product = order.sku && order.product.endsWith(suffix) ? order.product.slice(0, -suffix.length) : order.product;
  return { $1:order.customer, $2:product, $3:String(Number((order.quantity * order.unitPrice + order.deliveryFee).toFixed(2))), $4:order.city, $5:order.area, $6:order.shipmentReference };
}
export function confirmationText(order) {
  const fields = confirmationFields(order);
  return confirmationTemplate.replace(/\$[1-6]/g, key => fields[key]);
}
