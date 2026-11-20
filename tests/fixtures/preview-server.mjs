import { createServer } from 'node:http';

const now = new Date().toISOString();
const base = { source: 'facebook', city: 'طرابلس', area: 'عين زارة', address: 'شارع الزيتون', quantity: 1, deliveryFee: 10,
  paid: 0, notes: '', serviceId: 'demo', darbStatus: 'pending', shippingPrice: null, shippingError: '',
  confirmationSms: 'sent', onWaySms: 'pending', createdAt: now, updatedAt: now };
const orders = [
  { ...base, id: 'f2e87d55-1422-4a2d-b91e-123456789001', customer: 'محمد علي', phone: '218912345678', product: 'ساعة رجالية', unitPrice: 85, status: 'confirmed', shipmentReference: '2384360' },
  { ...base, id: 'f2e87d55-1422-4a2d-b91e-123456789002', customer: 'سارة أحمد', phone: '218922345678', product: 'حقيبة جلدية', unitPrice: 120, status: 'on_way', onWaySms: 'sent', shipmentReference: '2384361', source: 'instagram' },
  { ...base, id: 'f2e87d55-1422-4a2d-b91e-123456789003', customer: 'أحمد بن عمر', phone: '218932345678', product: 'إكسسوارات هاتف', quantity: 2, unitPrice: 35, status: 'delivered', paid: 80, shipmentReference: '2384362' },
  { ...base, id: 'f2e87d55-1422-4a2d-b91e-123456789004', customer: 'مريم سالم', phone: '218942345678', product: 'عطر فاخر', unitPrice: 95, status: 'attention', shippingError: 'راجع حالة الشحنة', shipmentReference: '' },
];
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url?.endsWith('/auth')) return res.end(JSON.stringify({ ok: true, authenticated: true }));
  if (req.url?.endsWith('/api')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (input.action === 'bootstrap') return res.end(JSON.stringify({ ok: true, data: { orders, settings: { serviceId: 'demo', autoMessages: true }, resalaConfigured: true } }));
    if (input.action === 'packages') return res.end(JSON.stringify({ ok: true, data: [{ _id: 'demo', title: 'التوصيل المحلي' }] }));
  }
  res.statusCode = 400;
  res.end(JSON.stringify({ ok: false, error: 'Preview only' }));
}).listen(8888, '127.0.0.1', () => console.log('Preview API on 127.0.0.1:8888'));
