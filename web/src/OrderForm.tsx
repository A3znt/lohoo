import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, Check, CircleAlert, RefreshCw, Truck, X } from 'lucide-react';
import { api, money, orderTotal, type Actor, type AgentSummary, type OrderInput, type Package, type WarehouseProduct } from './api';

interface Location { city: string; areas: string[] }
interface Quote { serviceId: string; deliveryFee: number; components: { label: string; amount: number }[] }
interface Props { initial?: OrderInput; carrierEdit?: boolean; onClose: () => void; onCreate: (order: OrderInput) => void; busy: boolean; defaultServiceId: string; agents: AgentSummary[]; actor: Actor }

export default function OrderForm({ initial, carrierEdit = false, onClose, onCreate, busy, defaultServiceId, agents, actor }: Props) {
  const [form, setForm] = useState<OrderInput>(initial ?? { id: crypto.randomUUID(), source: 'facebook', customer: '', phone: '', city: '', area: '', address: '', product: '', warehouseProductId: '', warehouseVariantId: '', quantity: 1, unitPrice: 0, deliveryFee: 0, paid: 0, notes: '', serviceId: defaultServiceId });
  const [locations, setLocations] = useState<Location[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [products, setProducts] = useState<WarehouseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [quote, setQuote] = useState<{ input: string; value: Quote } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  const [areaQuery, setAreaQuery] = useState('');
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const set = <K extends keyof OrderInput>(key: K, value: OrderInput[K]) => setForm((old) => ({ ...old, [key]: value }));
  const selectedLocation = locations.find((item) => item.city === form.city);
  const selectedProduct = products.find((item) => item.id === form.warehouseProductId);
  const selectedVariant = selectedProduct?.variants.find((item) => item.id === form.warehouseVariantId);
  const pendingProducts = products.filter((item) => !item.isPublished && !item.isBlocked);

  async function loadDarb() {
    setLoading(true); setLoadError('');
    try {
      const [nextLocations, nextPackages, nextProducts] = await Promise.all([
        api<Location[]>('deliveryLocations'), api<Package[]>('packages'), api<WarehouseProduct[]>('warehouseProducts'),
      ]);
      setLocations(nextLocations); setPackages(nextPackages); setProducts(nextProducts);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'تعذر جلب بيانات درب السبيل.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadDarb(); }, []);
  const quoteInput = useMemo(() => JSON.stringify({ customer: form.customer, phone: form.phone, city: form.city, area: form.area,
    address: form.address, product: form.product, warehouseProductId: form.warehouseProductId,
    warehouseVariantId: form.warehouseVariantId, quantity: form.quantity, unitPrice: form.unitPrice,
    serviceId: form.serviceId }), [form.customer, form.phone, form.city, form.area, form.address, form.product,
    form.warehouseProductId, form.warehouseVariantId, form.quantity, form.unitPrice, form.serviceId]);
  const normalizedPhone = form.phone.replace(/[\s()+-]/g, '');
  const phoneValid = /^(?:0|218)(?:91|92|93|94)\d{7}$/.test(normalizedPhone);
  const amountValid = [form.unitPrice, form.paid].every((number) =>
    Number.isFinite(number) && number >= 0 && number <= 10000000);
  const quantityValid = Number.isInteger(form.quantity) && form.quantity >= 1 && form.quantity <= 10000;
  const ready = Boolean(form.customer.trim() && phoneValid && form.city && form.area && form.address.trim() &&
    selectedProduct?.isPublished && !selectedProduct.isBlocked && form.warehouseVariantId && form.serviceId &&
    quantityValid && amountValid && !loading && !loadError);
  const currentQuote = ready && quote?.input === quoteInput ? quote.value : null;
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!ready) { setQuoting(false); return; }
    let cancelled = false;
    setQuoting(true);
    const timer = window.setTimeout(async () => {
      try {
        const value = await api<Quote>('quoteOrder', { order: form });
        if (!cancelled) setQuote({ input: quoteInput, value });
      } catch (error) { if (!cancelled) setQuoteError(error instanceof Error ? error.message : 'تعذر حساب سعر التوصيل.'); }
      finally { if (!cancelled) setQuoting(false); }
    }, 550);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [quoteInput, ready, products, locations, quoteAttempt]);
  function chooseProduct(id: string) {
    const product = products.find((item) => item.id === id);
    if (product && (!product.isPublished || product.isBlocked)) return;
    const variant = product?.variants[0];
    setForm((old) => ({ ...old, warehouseProductId: product?.id || '', warehouseVariantId: variant?.id || '',
      product: product && variant ? `${product.name} - ${variant.sku}` : '', unitPrice: product?.salePrice || 0 }));
  }
  function chooseVariant(id: string) {
    const variant = selectedProduct?.variants.find((item) => item.id === id);
    setForm((old) => ({ ...old, warehouseVariantId: variant?.id || '',
      product: selectedProduct && variant ? `${selectedProduct.name} - ${variant.sku}` : '' }));
  }
  const total = orderTotal({ ...form, deliveryFee: currentQuote?.deliveryFee || 0 });
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="إغلاق" onClick={onClose} /><section className="drawer form-drawer" role="dialog" aria-modal="true" aria-label={initial ? 'تعديل الطلب' : 'إنشاء طلب جديد'}>
    <div className="drawer-head"><div><span className="overline">{initial ? 'تعديل طلب · درب السبيل' : 'طلب جديد · درب السبيل'}</span><h2>{initial ? 'تعديل الطلب' : 'إنشاء شحنة'}</h2></div><button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></div>
    <div className="drawer-body order-form-new">
      {carrierEdit && <div className="carrier-edit-note" role="note"><Truck size={18} /><span>سيُحدَّث هذا الطلب في درب السبيل أولًا، ثم في ركن. التعديل متاح ما دامت الشحنة معلّقة لدى الشركة.</span></div>}
      {loadError && <div className="form-error"><CircleAlert size={18} />{loadError}<button className="btn ghost" onClick={loadDarb}>إعادة المحاولة</button></div>}
      {loading && <div className="form-loading"><RefreshCw size={18} className="spin" /> نجلب المنتجات والأماكن والخدمات من درب السبيل…</div>}
      <div className="form-section-title"><span>01</span><div><strong>الزبون والمصدر</strong><small>بيانات الطلب من محادثتك</small></div></div>
      <div className="source-picker"><button type="button" aria-pressed={form.source === 'facebook'} className={form.source === 'facebook' ? 'selected' : ''} onClick={() => set('source', 'facebook')}>فيسبوك</button><button type="button" aria-pressed={form.source === 'instagram'} className={form.source === 'instagram' ? 'selected' : ''} onClick={() => set('source', 'instagram')}>إنستغرام</button></div>
      <div className="field-grid"><label className="field">اسم الزبون<input value={form.customer} onChange={(e) => set('customer', e.target.value)} placeholder="الاسم الكامل" /></label><label className="field">رقم الهاتف<input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0912345678" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" aria-invalid={Boolean(form.phone.trim() && !phoneValid)} />{form.phone.trim() && !phoneValid && <small className="field-hint-error">أدخل رقمًا ليبيًا مثل 0912345678 أو +218912345678</small>}</label></div>
      {!initial && actor.role === 'admin' && <label className="field">المندوبة<select value={form.agentId || ''} onChange={(e) => set('agentId', e.target.value)}><option value="">بدون مندوبة</option>{agents.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      <div className="form-section-title"><span>02</span><div><strong>العنوان من درب السبيل</strong><small>اختر مدينة ثم منطقة من القائمة المعتمدة</small></div></div>
      <div className="field-grid"><label className="field">المدينة<select value={form.city} disabled={loading} onChange={(e) => { setForm((old) => ({ ...old, city: e.target.value, area: '' })); setAreaQuery(''); }}><option value="">اختر المدينة</option>{locations.map((item) => <option key={item.city} value={item.city}>{item.city}</option>)}</select></label><label className="field">المنطقة{selectedLocation && selectedLocation.areas.length > 12 && <input type="search" value={areaQuery} onChange={(e) => { setAreaQuery(e.target.value); set('area', ''); }} placeholder="ابحث عن المنطقة" />}<select value={form.area} disabled={!form.city || loading} onChange={(e) => set('area', e.target.value)}><option value="">اختر المنطقة</option>{selectedLocation?.areas.filter((area) => area.includes(areaQuery.trim())).map((area) => <option key={area} value={area}>{area}</option>)}</select></label></div>
      <label className="field">العنوان التفصيلي<input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="الشارع وأقرب نقطة دلالة" /></label>
      <div className="form-section-title"><span>03</span><div><strong>المنتج وخدمة التوصيل</strong><small>الاسم والقياس من مخزون درب السبيل</small></div></div>
      <label className="field">المنتج<select value={form.warehouseProductId} disabled={loading} onChange={(e) => chooseProduct(e.target.value)}><option value="">اختر المنتج</option>{products.map((item) => <option key={item.id} value={item.id} disabled={!item.isPublished || item.isBlocked}>{item.name} · {money(item.salePrice)}{item.isBlocked ? ' · موقوف من درب السبيل' : !item.isPublished ? ' · بانتظار اعتماد درب السبيل' : ''}</option>)}</select></label>
      {pendingProducts.length > 0 && <p className="warehouse-pending-note" role="note">بانتظار اعتماد درب السبيل: {pendingProducts.map((item) => item.name).join('، ')}. تظهر هذه المنتجات للمتابعة، وتصبح قابلة للاختيار بعد نشرها من الشركة.</p>}
      {selectedProduct && <label className="field">الصنف أو القياس<select value={form.warehouseVariantId} onChange={(e) => chooseVariant(e.target.value)}>{selectedProduct.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.sku}{variant.attributes.length ? ` · ${variant.attributes.map((part) => part.value).join(' / ')}` : ''}</option>)}</select></label>}
      {selectedVariant && <div className="warehouse-summary"><span><Box size={15} /> SKU: {selectedVariant.sku}</span><span>القياس: {selectedVariant.widthCM} × {selectedVariant.heightCM} × {selectedVariant.lengthCM} سم</span></div>}
      <label className="field">خدمة التوصيل<select value={form.serviceId || ''} disabled={loading} onChange={(e) => set('serviceId', e.target.value)}><option value="">اختر الخدمة</option>{packages.filter((item) => !item.attributes?.includes('deposit')).map((item) => <option key={item._id} value={item._id}>{item.title || item.name || item._id}</option>)}</select></label>
      <div className="field-grid"><label className="field">الكمية<input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set('quantity', Number(e.target.value || 0))} /></label><label className="field">سعر القطعة<input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(e) => set('unitPrice', Number(e.target.value || 0))} /></label></div>
      <div className="field-grid"><label className="field">المحصّل من الزبون<input type="number" min="0" step="0.01" value={form.paid} onChange={(e) => set('paid', Number(e.target.value || 0))} /></label><label className="field">ملاحظات<input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="اختياري" /></label></div>
      {(!quantityValid || !amountValid) && <p className="field-hint-error" role="alert">تحقّق من الكمية والمبالغ: الكمية عدد صحيح موجب، والمبالغ لا تقل عن صفر.</p>}
      <div className={`quote-card ${currentQuote ? 'ready' : ''}`}><div><Truck size={19} /><span>سعر التوصيل من درب السبيل</span></div><strong>{currentQuote ? money(currentQuote.deliveryFee) : quoting ? 'جاري الحساب…' : 'أكمل البيانات'}</strong>{currentQuote?.components.map((item, index) => <div className="quote-part" key={index}><span>{item.label}</span><b>{money(item.amount)}</b></div>)}{currentQuote && <small><Check size={14} /> تم حساب السعر حسب المنتج والعنوان والخدمة</small>}{quoteError && <><p className="form-error"><CircleAlert size={16} />{quoteError}</p><button className="btn ghost" onClick={() => setQuoteAttempt((n) => n + 1)}><RefreshCw size={16} /> إعادة حساب السعر</button></>}</div>
      <div className="order-total-preview"><span>إجمالي الطلب مع التوصيل</span><strong>{currentQuote ? money(total) : '—'}</strong></div>
    </div>
    <div className="drawer-footer"><button className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy || !currentQuote || quoting} onClick={() => initial ? currentQuote && onCreate({ ...form, deliveryFee: currentQuote.deliveryFee }) : setConfirm(true)}>{carrierEdit ? 'تحديث درب السبيل وركن' : initial ? 'حفظ التعديل' : 'مراجعة وإنشاء الشحنة'} <ArrowLeft size={17} /></button></div>
  </section>{confirm && currentQuote && <div className="confirm-layer"><div className="confirm-card" role="dialog" aria-modal="true" aria-label="تأكيد إنشاء الشحنة"><span className="confirm-icon"><Truck size={25} /></span><h3>تأكيد الشحنة</h3><p>سيُرسل طلب <strong>{form.customer}</strong> إلى درب السبيل، ثم رسالة التأكيد للزبون.</p><div className="confirm-details"><span>{form.city}، {form.area}</span><strong>{money(currentQuote?.deliveryFee || 0)} توصيل</strong></div><div className="confirm-details"><span>إجمالي الطلب</span><strong>{money(total)}</strong></div><div className="confirm-actions"><button className="btn ghost" onClick={() => setConfirm(false)}>مراجعة</button><button className="btn primary" disabled={busy} onClick={() => { setConfirm(false); onCreate({ ...form, deliveryFee: currentQuote?.deliveryFee || 0 }); }}>{busy ? 'جاري الإرسال…' : 'تأكيد وإرسال'}</button></div></div></div>}</div>;
}
