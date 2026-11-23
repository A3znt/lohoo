import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, Check, CircleAlert, Plus, RefreshCw, Trash2, Truck, X } from 'lucide-react';
import { api, money, orderTotal, type Actor, type AgentSummary, type OrderInput, type OrderItem, type Package, type WarehouseProduct } from './api';

interface Location { city: string; areas: string[] }
interface Quote { serviceId: string; deliveryFee: number; components: { label: string; amount: number }[] }
interface Props { knownOrders?: { phone: string; additionalPhones?: string[] }[]; initial?: OrderInput; carrierEdit?: boolean; onClose: () => void; onCreate: (order: OrderInput) => void; busy: boolean; defaultServiceId: string; agents: AgentSummary[]; actor: Actor }
type Catalog = { locations: Location[]; packages: Package[]; products: WarehouseProduct[] };
let catalogCache: { value: Catalog; expiresAt: number } | null = null;
const cachedCatalog = () => catalogCache && catalogCache.expiresAt > Date.now() ? catalogCache.value : null;

export default function OrderForm({ initial, knownOrders = [], carrierEdit = false, onClose, onCreate, busy, defaultServiceId, agents, actor }: Props) {
  const [form, setForm] = useState<OrderInput>(() => {
    const base: OrderInput = initial ?? { id: crypto.randomUUID(), source: 'facebook', customer: '', phone: '', additionalPhones: [], city: '', area: '', address: '', product: '', warehouseProductId: '', warehouseVariantId: '', quantity: 1, unitPrice: 0, deliveryFee: 0, paid: 0, weightKg: 0, notes: '', serviceId: defaultServiceId };
    return { ...base, items: base.items?.length ? base.items : [{ product: base.product, quantity: base.quantity,
      unitPrice: base.unitPrice, warehouseProductId: base.warehouseProductId, warehouseVariantId: base.warehouseVariantId }] };
  });
  const [locations, setLocations] = useState<Location[]>(() => cachedCatalog()?.locations || []);
  const [packages, setPackages] = useState<Package[]>(() => cachedCatalog()?.packages || []);
  const [products, setProducts] = useState<WarehouseProduct[]>(() => cachedCatalog()?.products || []);
  const [loading, setLoading] = useState(() => !cachedCatalog());
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
  const [customMethod, setCustomMethod] = useState(Boolean(initial?.paymentMethod && !['كاش', 'حوالة'].includes(initial.paymentMethod)));
  const method = form.paymentMethod ?? 'كاش';
  const items = form.items || [];
  function updateItem(index: number, patch: Partial<OrderItem>) {
    setForm((old) => {
      const next = [...(old.items || [])];
      next[index] = { ...next[index], ...patch };
      return { ...old, items: next, ...(index === 0 ? { product: next[0].product, quantity: next[0].quantity,
        unitPrice: next[0].unitPrice, warehouseProductId: next[0].warehouseProductId,
        warehouseVariantId: next[0].warehouseVariantId } : {}) };
    });
  }
  const selectedLocation = locations.find((item) => item.city === form.city);
  const pendingProducts = products.filter((item) => !item.isPublished && !item.isBlocked);

  async function loadDarb(force = false) {
    const cached = !force && cachedCatalog();
    if (cached) { setLocations(cached.locations); setPackages(cached.packages); setProducts(cached.products); setLoading(false); return; }
    setLoading(true); setLoadError('');
    try {
      const [nextLocations, nextPackages, nextProducts] = await Promise.all([
        api<Location[]>('deliveryLocations'), api<Package[]>('packages'), api<WarehouseProduct[]>('warehouseProducts'),
      ]);
      catalogCache = { value: { locations: nextLocations, packages: nextPackages, products: nextProducts }, expiresAt: Date.now() + 5 * 60_000 };
      setLocations(nextLocations); setPackages(nextPackages); setProducts(nextProducts);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'تعذر جلب بيانات درب السبيل.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadDarb(); }, []);
  const quoteInput = useMemo(() => JSON.stringify({ city: form.city, area: form.area,
    address: form.address, paymentMethod: method, items: form.items, serviceId: form.serviceId }),
  [form.city, form.area, form.address, form.items, form.serviceId, method]);
  const normalizedPhone = form.phone.replace(/[\s()+-]/g, '');
  const phoneValid = /^(?:0|218)(?:91|92|93|94)\d{7}$/.test(normalizedPhone);
  const extraPhones = form.additionalPhones || [];
  const normalizedExtras = extraPhones.map((number) => number.replace(/[\s()+-]/g, '').replace(/^0/, '218'));
  const extraPhonesValid = extraPhones.every((number) => /^(?:0|218)(?:91|92|93|94)\d{7}$/.test(number.replace(/[\s()+-]/g, ''))) &&
    new Set([normalizedPhone.replace(/^0/, '218'), ...normalizedExtras]).size === extraPhones.length + 1;
  const weightValid = Number.isFinite(form.weightKg ?? 0) && (form.weightKg ?? 0) >= 0 && (form.weightKg ?? 0) <= 1000 && Number((form.weightKg ?? 0).toFixed(2)) === (form.weightKg ?? 0);
  const amountValid = [form.paid, ...items.map((item) => item.unitPrice)].every((number) =>
    Number.isFinite(number) && number >= 0 && number <= 10000000);
  const quantityValid = items.length > 0 && items.length <= 8 && items.every((item) => Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 10000);
  const serviceAvailable = packages.some((item) => item._id === form.serviceId && !item.attributes?.includes('deposit'));
  const ready = Boolean(method.trim() && form.customer.trim() && phoneValid && extraPhonesValid && weightValid && form.city && form.area && form.address.trim() &&
    items.every((item) => { const product = products.find((row) => row.id === item.warehouseProductId);
      return product?.isPublished && !product.isBlocked && product.variants.some((variant) => variant.id === item.warehouseVariantId); }) && serviceAvailable &&
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
  function chooseProduct(index: number, id: string) {
    const product = products.find((item) => item.id === id);
    if (product && (!product.isPublished || product.isBlocked)) return;
    const variant = product?.variants[0];
    updateItem(index, { warehouseProductId: product?.id || '', warehouseVariantId: variant?.id || '',
      product: product && variant ? `${product.name} - ${variant.sku}` : '', unitPrice: product?.salePrice || 0 });
  }
  function chooseVariant(index: number, id: string) {
    const product = products.find((item) => item.id === items[index]?.warehouseProductId);
    const variant = product?.variants.find((item) => item.id === id);
    updateItem(index, { warehouseVariantId: variant?.id || '',
      product: product && variant ? `${product.name} - ${variant.sku}` : '' });
  }
  function removeItem(index: number) {
    setForm((old) => {
      const next = (old.items || []).filter((_, position) => position !== index);
      const first = next[0];
      return { ...old, items: next, product: first.product, quantity: first.quantity, unitPrice: first.unitPrice,
        warehouseProductId: first.warehouseProductId, warehouseVariantId: first.warehouseVariantId };
    });
  }
  const total = orderTotal({ ...form, deliveryFee: currentQuote?.deliveryFee || 0 });
  const collectionValid = !currentQuote || form.paid <= total + 0.001;
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="إغلاق" onClick={onClose} /><section className="drawer form-drawer" role="dialog" aria-modal="true" aria-label={initial ? 'تعديل الطلب' : 'إنشاء طلب جديد'}>
    <div className="drawer-head"><div><span className="overline">{initial ? 'تعديل طلب · درب السبيل' : 'طلب جديد · درب السبيل'}</span><h2>{initial ? 'تعديل الطلب' : 'إنشاء شحنة'}</h2></div><button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></div>
    <div className="drawer-body order-form-new">
      {carrierEdit && <div className="carrier-edit-note" role="note"><Truck size={18} /><span>سيُحدَّث هذا الطلب في درب السبيل أولًا، ثم في ركن. التعديل متاح ما دامت الشحنة معلّقة لدى الشركة.</span></div>}
      {loadError && <div className="form-error"><CircleAlert size={18} />{loadError}<button className="btn ghost" onClick={() => void loadDarb(true)}>إعادة المحاولة</button></div>}
      {loading && <div className="form-loading"><RefreshCw size={18} className="spin" /> نجلب المنتجات والأماكن والخدمات من درب السبيل…</div>}
      <div className="form-section-title"><span>01</span><div><strong>الزبون والمصدر</strong><small>بيانات الطلب من محادثتك</small></div></div>
      <div className="source-picker"><button type="button" aria-pressed={form.source === 'facebook'} className={form.source === 'facebook' ? 'selected' : ''} onClick={() => set('source', 'facebook')}>فيسبوك</button><button type="button" aria-pressed={form.source === 'instagram'} className={form.source === 'instagram' ? 'selected' : ''} onClick={() => set('source', 'instagram')}>إنستغرام</button></div>
      <div className="field-grid"><label className="field">اسم الزبون<input value={form.customer} maxLength={160} onChange={(e) => set('customer', e.target.value)} placeholder="الاسم الكامل" /></label><label className="field">رقم الهاتف<input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0912345678" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" aria-invalid={Boolean(form.phone.trim() && !phoneValid)} />{form.phone.trim() && !phoneValid && <small className="field-hint-error">أدخل رقمًا ليبيًا مثل 0912345678 أو +218912345678</small>}</label></div>
      {phoneValid && !initial && <small className="field-hint" role="status">{knownOrders.some(order => [order.phone, ...(order.additionalPhones || [])].includes(normalizedPhone.replace(/^0/, '218'))) ? 'سبق تسجيل طلب بهذا الرقم ضمن طلباتك' : 'رقم جديد ضمن طلباتك'}</small>}
      <div className="extra-phones"><div className="extra-phones-head"><strong>أرقام إضافية للزبون</strong><button type="button" className="btn ghost" disabled={extraPhones.length >= 4} onClick={() => set('additionalPhones', [...extraPhones, ''])}><Plus size={15} /> إضافة رقم</button></div><small>ستظهر كلها لدرّب السبيل كجهات اتصال. رسالة التأكيد تُرسل للرقم الأساسي فقط.</small>{extraPhones.map((number, index) => <div className="extra-phone-row" key={index}><input aria-label={`الرقم الإضافي ${index + 1}`} type="tel" inputMode="tel" dir="ltr" value={number} onChange={(e) => set('additionalPhones', extraPhones.map((old, offset) => offset === index ? e.target.value : old))} placeholder="0912345678" /><button type="button" className="btn ghost" aria-label={`حذف الرقم الإضافي ${index + 1}`} onClick={() => set('additionalPhones', extraPhones.filter((_, offset) => offset !== index))}><Trash2 size={16} /></button></div>)}{extraPhones.length > 0 && !extraPhonesValid && <small className="field-hint-error" role="alert">تأكد من صحة الأرقام الإضافية وعدم تكرارها.</small>}</div>
      {!initial && actor.role === 'admin' && <label className="field">المندوبة<select value={form.agentId || ''} onChange={(e) => set('agentId', e.target.value)}><option value="">بدون مندوبة</option>{agents.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      <div className="form-section-title"><span>02</span><div><strong>العنوان من درب السبيل</strong><small>اختر مدينة ثم منطقة من القائمة المعتمدة</small></div></div>
      <div className="field-grid"><label className="field">المدينة<select value={form.city} disabled={loading} onChange={(e) => { setForm((old) => ({ ...old, city: e.target.value, area: '' })); setAreaQuery(''); }}><option value="">اختر المدينة</option>{locations.map((item) => <option key={item.city} value={item.city}>{item.city}</option>)}</select></label><label className="field">المنطقة{selectedLocation && selectedLocation.areas.length > 12 && <input type="search" value={areaQuery} onChange={(e) => { setAreaQuery(e.target.value); set('area', ''); }} placeholder="ابحث عن المنطقة" />}<select value={form.area} disabled={!form.city || loading} onChange={(e) => set('area', e.target.value)}><option value="">اختر المنطقة</option>{selectedLocation?.areas.filter((area) => area.includes(areaQuery.trim())).map((area) => <option key={area} value={area}>{area}</option>)}</select></label></div>
      <label className="field">العنوان التفصيلي<input value={form.address} maxLength={160} onChange={(e) => set('address', e.target.value)} placeholder="الشارع وأقرب نقطة دلالة" /></label>
      <div className="form-section-title"><span>03</span><div><strong>المنتجات المطلوبة</strong><small>أضف الأصناف والقياسات من مخزون درب السبيل</small></div></div>
      <div className="order-items">{items.map((item, index) => {
        const product = products.find((row) => row.id === item.warehouseProductId);
        const variant = product?.variants.find((row) => row.id === item.warehouseVariantId);
        return <section className="order-item-card" key={index} aria-label={`المنتج ${index + 1}`}><div className="order-item-head"><strong>المنتج {index + 1}</strong>{items.length > 1 && <button type="button" aria-label={`حذف المنتج ${index + 1}`} onClick={() => removeItem(index)}><Trash2 size={16} /></button>}</div>
          <label className="field">المنتج<select value={item.warehouseProductId} disabled={loading} onChange={(e) => chooseProduct(index, e.target.value)}><option value="">اختر المنتج</option>{products.map((row) => <option key={row.id} value={row.id} disabled={!row.isPublished || row.isBlocked}>{row.name} · {money(row.salePrice)}{row.isBlocked ? ' · موقوف' : !row.isPublished ? ' · بانتظار الاعتماد' : ''}</option>)}</select></label>
          {product && <label className="field">الصنف أو القياس<select value={item.warehouseVariantId} onChange={(e) => chooseVariant(index, e.target.value)}><option value="">اختر القياس</option>{product.variants.map((row) => <option key={row.id} value={row.id}>{row.sku}{row.attributes.length ? ` · ${row.attributes.map((part) => part.value).join(' / ')}` : ''}</option>)}</select></label>}
          {variant && <div className="warehouse-summary"><span><Box size={15} /> {variant.sku}</span><span>{variant.widthCM} × {variant.heightCM} × {variant.lengthCM} سم</span></div>}
          <div className="field-grid"><label className="field">الكمية<input type="number" min="1" step="1" value={item.quantity} onChange={(e) => updateItem(index, { quantity: Number(e.target.value || 0) })} /></label><label className="field">سعر القطعة<input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value || 0) })} /></label></div>
          {product && item.unitPrice !== product.salePrice && <div className="catalog-price-note" role="note"><span>سعر المخزون الآن {money(product.salePrice)}</span><button type="button" className="btn ghost" onClick={() => updateItem(index, { unitPrice: product.salePrice })}>استخدمه</button></div>}
        </section>;
      })}<button type="button" className="add-order-item" disabled={items.length >= 8} onClick={() => set('items', [...items, { product: '', quantity: 1, unitPrice: 0, warehouseProductId: '', warehouseVariantId: '' }])}><Plus size={17} /> إضافة منتج آخر للطلبية</button></div>
      <div className="catalog-toolbar"><span>{products.filter((item) => item.isPublished && !item.isBlocked).length} منتج متاح من درب السبيل</span><button type="button" className="btn ghost" disabled={loading || busy} onClick={() => void loadDarb(true)}><RefreshCw size={15} className={loading ? 'spin' : ''} /> تحديث المنتجات</button></div>
      {pendingProducts.length > 0 && <p className="warehouse-pending-note" role="note">بانتظار اعتماد درب السبيل: {pendingProducts.map((item) => item.name).join('، ')}. تظهر هذه المنتجات للمتابعة، وتصبح قابلة للاختيار بعد نشرها من الشركة.</p>}
      <label className="field">الوزن التقريبي بالكيلو (اختياري)<input type="number" min="0" max="1000" step="0.01" value={form.weightKg || ''} onChange={(e) => set('weightKg', e.target.value === '' ? 0 : Number(e.target.value))} placeholder="مثال: 2.5" />{!weightValid && <small className="field-hint-error">أدخل وزنًا من 0 إلى 1000 كجم، حتى منزلتين عشريتين.</small>}<small className="field-hint">يرسل الوزن في ملاحظات الشحنة؛ درب السبيل لا يرجع حقل وزن مستقلًا في بيانات المنتج الحالية.</small></label>
      <div className="form-section-title"><span>04</span><div><strong>الحسابات والتوصيل</strong><small>راجع طريقة التوصيل والمبلغ قبل التأكيد</small></div></div>
      <label className="field">طريقة التوصيل<select value={form.serviceId || ''} disabled={loading} onChange={(e) => set('serviceId', e.target.value)}><option value="">اختر الخدمة</option>{packages.filter((item) => !item.attributes?.includes('deposit')).map((item) => <option key={item._id} value={item._id}>{item.title || item.name || item._id}</option>)}</select></label>
      {!loading && form.serviceId && !serviceAvailable && <p className="field-hint-error" role="alert">خدمة التوصيل المحفوظة لم تعد متاحة؛ اختر خدمة أخرى من درب السبيل.</p>}
      <div className="payment-method-card"><label className="field">طريقة الدفع<select value={customMethod ? 'other' : method} onChange={e => { const other = e.target.value === 'other'; setCustomMethod(other); set('paymentMethod', other ? '' : e.target.value); }}><option>كاش</option><option>حوالة</option><option value="other">طريقة أخرى</option></select></label>
        {customMethod && <label className="field">اسم طريقة الدفع<input maxLength={50} value={method} onChange={e => set('paymentMethod', e.target.value)} placeholder="مثلاً محفظة إلكترونية" /></label>}<small>تُحسب عمولة المندوبة في حسابها بعد تسليم الطلب، ولا تُضاف إلى سعر المنتجات.</small></div>
      <label className="field">المحصّل من الزبون<input type="number" min="0" max={currentQuote ? total : 10000000} step="0.01" value={form.paid} aria-invalid={!collectionValid} onChange={(e) => set('paid', Number(e.target.value || 0))} /></label>
      {currentQuote && <div className="source-picker"><button type="button" onClick={() => set('paid', 0)}>لم يدفع بعد</button><button type="button" onClick={() => set('paid', Number(total.toFixed(2)))}>دفع كامل المبلغ</button></div>}
      <label className="field">ملاحظات للمندوب وسائق الشحن<textarea value={form.notes} maxLength={500} rows={3} onChange={(e) => set('notes', e.target.value)} placeholder="مثال: اتصل قبل الوصول، والقطعة قابلة للمعاينة" /><small className="field-hint">تظهر في ملاحظات شحنة درب السبيل.</small></label>
      {(!quantityValid || !amountValid) && <p className="field-hint-error" role="alert">تحقّق من الكمية والمبالغ: الكمية عدد صحيح موجب، والمبالغ لا تقل عن صفر.</p>}
      {currentQuote && collectionValid && <div className="payment-method-card" aria-live="polite"><strong>المتبقي على الزبون</strong><span>{money(Math.max(0,total - form.paid))}</span>{form.paid > 0 && <small>يصل المتبقي للسائق في الملاحظات. مبلغ التحصيل الآلي لدى درب السبيل يشمل كامل الطلب، فنسّق مع السائق قبل التحصيل.</small>}</div>}
      {!collectionValid && <p className="field-hint-error" role="alert">المبلغ المحصّل أكبر من إجمالي الطلب مع التوصيل.</p>}
      <div className={`quote-card ${currentQuote ? 'ready' : ''}`}><div><Truck size={19} /><span>سعر التوصيل من درب السبيل</span></div><strong>{currentQuote ? money(currentQuote.deliveryFee) : quoting ? 'جاري الحساب…' : 'أكمل البيانات'}</strong>{currentQuote?.components.map((item, index) => <div className="quote-part" key={index}><span>{item.label}</span><b>{money(item.amount)}</b></div>)}{currentQuote && <small><Check size={14} /> تم حساب السعر حسب المنتج والعنوان والخدمة</small>}{quoteError && <><p className="form-error"><CircleAlert size={16} />{quoteError}</p><button className="btn ghost" onClick={() => setQuoteAttempt((n) => n + 1)}><RefreshCw size={16} /> إعادة حساب السعر</button></>}</div>
      <div className="order-total-preview"><span>إجمالي الطلب مع التوصيل</span><strong>{currentQuote ? money(total) : '—'}</strong></div>
    </div>
    <div className="drawer-footer"><button className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy || !method.trim() || !currentQuote || quoting || !collectionValid} onClick={() => initial ? currentQuote && onCreate({ ...form, deliveryFee: currentQuote.deliveryFee }) : setConfirm(true)}>{carrierEdit ? 'تحديث درب السبيل وركن' : initial ? 'حفظ التعديل' : 'مراجعة وإنشاء الشحنة'} <ArrowLeft size={17} /></button></div>
  </section>{confirm && currentQuote && <div className="confirm-layer"><div className="confirm-card" role="dialog" aria-modal="true" aria-label="تأكيد إنشاء الشحنة"><span className="confirm-icon"><Truck size={25} /></span><h3>تأكيد الشحنة</h3><p>سيُرسل طلب <strong>{form.customer}</strong> إلى درب السبيل، ثم رسالة التأكيد للزبون.</p><div className="confirm-items">{items.map((item, index) => <div key={index}><span>{item.product} × {item.quantity}</span><strong>{money(item.unitPrice * item.quantity)}</strong></div>)}</div><div className="confirm-details"><span>{form.city}، {form.area}</span><strong>{money(currentQuote?.deliveryFee || 0)} توصيل</strong></div><div className="confirm-details"><span>إجمالي الطلب</span><strong>{money(total)}</strong></div><div className="confirm-details"><span>{method} · المتبقي</span><strong>{money(Math.max(0,total - form.paid))}</strong></div><div className="confirm-actions"><button className="btn ghost" onClick={() => setConfirm(false)}>مراجعة</button><button className="btn primary" disabled={busy} onClick={() => { setConfirm(false); onCreate({ ...form, deliveryFee: currentQuote?.deliveryFee || 0 }); }}>{busy ? 'جاري الإرسال…' : 'تأكيد وإرسال'}</button></div></div></div>}</div>;
}
