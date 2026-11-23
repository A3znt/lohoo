import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, exportOrdersCsv } from '../web/src/order-export.mjs';

test('CSV escapes quotes, commas, newlines and malicious spreadsheet formulas', () => {
  assert.equal(csvCell('John, "A"'), '"John, ""A"""');
  assert.equal(csvCell('row\nsecond'), '"row\nsecond"');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('   +SUM(A1)'), '"\'   +SUM(A1)"');
  assert.equal(csvCell('@cmd'), '"\'@cmd"');
  assert.equal(csvCell('-42'), '"\'-42"');
  assert.equal(csvCell('218912345678'), '"218912345678"');
});

test('export preserves Arabic and computes monetary fields without guessing statuses', () => {
  const csv = exportOrdersCsv([{
    exportNumber: '000000123456', createdAt: '2026-11-21T10:30:00.000Z',
    customer: '=DANGEROUS', phone: '218912345678', source: 'instagram',
    product: 'حقيبة', quantity: 2, unitPrice: 80, deliveryFee: 15,
    items: [{ product: 'حقيبة', quantity: 2, unitPrice: 80 }, { product: 'طاولة', quantity: 1, unitPrice: 50 }],
    paid: 30, status: 'confirmed', shipmentReference: 'SH123',
    city: 'طرابلس', area: 'عين زارة', address: 'شارع 1',
    agentName: 'سجى', notes: 'قرب السوق',
  }]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"رقم الطلب","تاريخ الإنشاء"/);
  assert.match(csv, /"000000123456"/);
  assert.match(csv, /"'=DANGEROUS"/);
  assert.match(csv, /"إنستغرام"/);
  assert.match(csv, /"225","30","195"/);
  assert.match(csv, /طاولة × 1 × 50/);
  assert.match(csv, /"تم التأكيد"/);
  assert.equal(csv.split('\r\n').length, 3);
  assert.equal(exportOrdersCsv([]).split('\r\n').length, 2);
});
