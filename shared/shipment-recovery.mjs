export function canCorrectShipment(order) {
  if (order.status !== 'attention' || order.shipmentReference) return false;
  const error = order.shippingError || '';
  if (order.readyToRetry && !error) return true;
  return /^تعذر تسجيل المستلم:/.test(error) ||
    (!error.startsWith('قد تكون الشحنة أُنشئت.') && /contacts\.body\.(name|phone)/i.test(error)) ||
    /Unexpected property has been encountered!|Unable to fetch branch/.test(error);
}
