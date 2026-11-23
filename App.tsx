import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { emptyOrder, orderTotal, statuses, type Order, type OrderStatus } from './src/types';
import { deleteOrder, listOrders, saveOrder } from './src/storage';
import { loadDeliverySettings, saveDeliverySettings, type DeliverySettings } from './src/delivery';

type Page = 'home' | 'orders' | 'edit' | 'detail' | 'settings';
const money = (n: number) => `${n.toFixed(2)} د.ل`;

async function callServer<T>(settings: DeliverySettings, action: string, payload?: unknown): Promise<T> {
  if (!settings.baseUrl || !settings.appToken) throw new Error('أدخل رابط الخادم ورمز التطبيق في الإعدادات.');
  if (!/^https:\/\//i.test(settings.baseUrl) && !/^http:\/\/localhost(?::\d+)?$/i.test(settings.baseUrl)) {
    throw new Error('رابط الخادم لازم يبدأ بـ https://');
  }
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/.netlify/functions/darb`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.appToken}` },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `خطأ ${response.status}`);
  return result.data as T;
}

function Button({ title, onPress, subtle = false, disabled = false }: { title: string; onPress: () => void; subtle?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[s.button, subtle && s.subtle, disabled && { opacity: 0.5 }]}>
    <Text style={[s.buttonText, subtle && { color: '#17675e' }]}>{title}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, numeric = false, multiline = false, secret = false }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; multiline?: boolean; secret?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput style={[s.input, multiline && { minHeight: 75, textAlignVertical: 'top' }]} value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} secureTextEntry={secret} textAlign="right" /></View>;
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order>(emptyOrder());
  const [settings, setSettings] = useState<DeliverySettings>({ baseUrl: 'https://daftar-orders-personal.netlify.app', appToken: '', serviceId: '' });
  const [packages, setPackages] = useState<Array<{ _id: string; title?: string; name?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<'الكل' | OrderStatus>('الكل');

  useEffect(() => {
    Promise.all([listOrders(), loadDeliverySettings()]).then(([rows, cfg]) => { setOrders(rows); setSettings(cfg); })
      .catch((e) => Alert.alert('خطأ في فتح البيانات', String(e))).finally(() => setReady(true));
  }, []);
  const refresh = async () => setOrders(await listOrders());
  const save = async (next: Order) => { await saveOrder(next); await refresh(); setOrder(next); setPage('detail'); };
  const change = <K extends keyof Order>(key: K, value: Order[K]) => setOrder((old) => ({ ...old, [key]: value }));
  const count = (status: OrderStatus) => orders.filter((o) => o.status === status).length;
  const activeMoneyOrders = orders.filter((o) => !['ملغي', 'راجع'].includes(o.status));
  const sales = activeMoneyOrders.reduce((sum, o) => sum + orderTotal(o), 0);
  const collected = activeMoneyOrders.reduce((sum, o) => sum + o.paid, 0);
  const due = orders.filter((o) => !['ملغي', 'راجع'].includes(o.status)).reduce((sum, o) => sum + Math.max(0, orderTotal(o) - o.paid), 0);

  async function saveForm() {
    if (!order.customer.trim() || !order.phone.trim() || !order.product.trim()) return Alert.alert('بيانات ناقصة', 'اسم الزبون والهاتف والمنتج مطلوبة.');
    if (order.quantity < 1 || order.unitPrice < 0 || order.deliveryFee < 0 || order.paid < 0) return Alert.alert('راجع الأرقام', 'الكمية والمبالغ غير صحيحة.');
    try { await save(order); } catch (e) { Alert.alert('تعذر الحفظ', String(e)); }
  }
  async function ship() {
    if (!settings.serviceId) return Alert.alert('اختار باقة التوصيل', 'افتح الإعدادات وجلب باقات درب السبيل.');
    if (!order.city || !order.area || !order.address) return Alert.alert('العنوان ناقص', 'أدخل المدينة والمنطقة والعنوان.');
    setBusy(true);
    let estimate: unknown;
    try { estimate = await callServer(settings, 'calculate', { order, service: settings.serviceId }); }
    catch (e) { Alert.alert('تعذر حساب تكلفة الشحن', String(e)); setBusy(false); return; }
    setBusy(false);
    const detail = JSON.stringify(estimate) || 'تم الحساب';
    Alert.alert('تأكيد إرسال الشحنة', `${order.customer}\n${order.product} × ${order.quantity}\nالإجمالي المحلي: ${money(orderTotal(order))}\nتقدير درب السبيل: ${detail.slice(0, 250)}`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'إرسال', onPress: async () => {
        setBusy(true);
        try {
          const data = await callServer<{ reference: string }>(settings, 'createShipment', { order, service: settings.serviceId });
          await save({ ...order, shipmentReference: data.reference, status: 'قيد التوصيل' });
          Alert.alert('تم إنشاء الشحنة', `رقم التتبع: ${data.reference}`);
        } catch (e) { Alert.alert('تعذر تأكيد الإرسال', `${String(e)}\nلو ظهرت الشحنة في درب السبيل، سجّل رقمها يدويًا قبل أي محاولة ثانية.`); }
        finally { setBusy(false); }
      } },
    ]);
  }
  async function loadPackages() {
    setBusy(true);
    try {
      const data = await callServer<unknown>(settings, 'packages');
      const list = Array.isArray(data) ? data : (data as { results?: unknown[] })?.results;
      if (!Array.isArray(list)) throw new Error('شكل قائمة الباقات غير متوقع.');
      setPackages(list as typeof packages);
    } catch (e) { Alert.alert('تعذر جلب الباقات', String(e)); }
    finally { setBusy(false); }
  }
  async function track() {
    setBusy(true);
    try { const data = await callServer<unknown>(settings, 'timeline', { reference: order.shipmentReference }); Alert.alert('حالة الشحنة', JSON.stringify(data, null, 2).slice(0, 1300)); }
    catch (e) { Alert.alert('تعذر التتبع', String(e)); } finally { setBusy(false); }
  }

  if (!ready) return <SafeAreaView style={s.root}><ActivityIndicator style={{ marginTop: 100 }} color="#17675e" /></SafeAreaView>;
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Text style={s.brand}>ركن</Text><Text style={s.caption}>فيسبوك · إنستغرام · درب السبيل</Text></View>
    <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      {page === 'home' && <>
        <Text style={s.title}>نظرة عامة</Text>
        <View style={s.row}><Stat label="كل الطلبات" value={String(orders.length)} /><Stat label="قيد العمل" value={String(orders.length - count('تم التسليم') - count('ملغي') - count('راجع'))} /></View>
        <View style={s.row}><Stat label="تم التسليم" value={String(count('تم التسليم'))} /><Stat label="متبقي للتحصيل" value={money(due)} /></View>
        <View style={s.row}><Stat label="إجمالي الطلبات" value={money(sales)} /><Stat label="المحصّل" value={money(collected)} /></View>
        <Button title="＋ طلب جديد" onPress={() => { setOrder(emptyOrder()); setPage('edit'); }} />
        <Text style={s.heading}>آخر الطلبات</Text>
        {orders.slice(0, 5).map((o) => <OrderTile key={o.id} order={o} onPress={() => { setOrder(o); setPage('detail'); }} />)}
        {!orders.length && <Text style={s.empty}>أضف أول طلب وصلك من رسائل فيسبوك أو إنستغرام.</Text>}
      </>}
      {page === 'orders' && <>
        <Text style={s.title}>الطلبات</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: 7, marginBottom: 14 }} showsHorizontalScrollIndicator={false}>
          {(['الكل', ...statuses] as const).map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={[s.chip, filter === value && s.selected]}><Text style={[s.chipText, filter === value && s.selectedText]}>{value}</Text></Pressable>)}
        </ScrollView>
        {orders.filter((o) => filter === 'الكل' || o.status === filter).map((o) => <OrderTile key={o.id} order={o} onPress={() => { setOrder(o); setPage('detail'); }} />)}
        <Button title="＋ طلب جديد" onPress={() => { setOrder(emptyOrder()); setPage('edit'); }} />
      </>}
      {page === 'edit' && <>
        <Text style={s.title}>بيانات الطلب</Text>
        <View style={s.row}>{(['facebook', 'instagram'] as const).map((ch) => <Pressable key={ch} style={[s.chip, { flex: 1 }, order.channel === ch && s.selected]} onPress={() => change('channel', ch)}><Text style={[s.chipText, order.channel === ch && s.selectedText]}>{ch === 'facebook' ? 'فيسبوك' : 'إنستغرام'}</Text></Pressable>)}</View>
        <Field label="اسم الزبون *" value={order.customer} onChange={(v) => change('customer', v)} />
        <Field label="رقم الهاتف *" value={order.phone} onChange={(v) => change('phone', v)} />
        <Field label="المدينة" value={order.city} onChange={(v) => change('city', v)} />
        <Field label="المنطقة" value={order.area} onChange={(v) => change('area', v)} />
        <Field label="العنوان" value={order.address} onChange={(v) => change('address', v)} />
        <Field label="المنتج *" value={order.product} onChange={(v) => change('product', v)} />
        <Field label="الكمية" numeric value={String(order.quantity)} onChange={(v) => change('quantity', Number(v.replace(',', '.')) || 0)} />
        <Field label="سعر القطعة · د.ل" numeric value={String(order.unitPrice)} onChange={(v) => change('unitPrice', Number(v.replace(',', '.')) || 0)} />
        <Field label="رسوم التوصيل · د.ل" numeric value={String(order.deliveryFee)} onChange={(v) => change('deliveryFee', Number(v.replace(',', '.')) || 0)} />
        <Field label="المبلغ المحصّل · د.ل" numeric value={String(order.paid)} onChange={(v) => change('paid', Number(v.replace(',', '.')) || 0)} />
        <Field label="ملاحظات" multiline value={order.notes} onChange={(v) => change('notes', v)} />
        <Field label="رقم التتبع (لو أُنشئت الشحنة مسبقًا)" value={order.shipmentReference} onChange={(v) => change('shipmentReference', v)} />
        <Text style={s.total}>الإجمالي: {money(orderTotal(order))}</Text><Button title="حفظ الطلب" onPress={saveForm} />
      </>}
      {page === 'detail' && <>
        <Text style={s.title}>{order.customer}</Text>
        <View style={s.card}>
          <Line label="الهاتف" value={order.phone} /><Line label="العنوان" value={[order.city, order.area, order.address].filter(Boolean).join('، ') || '—'} />
          <Line label="المنتج" value={`${order.product} × ${order.quantity}`} /><Line label="الإجمالي" value={money(orderTotal(order))} />
          <Line label="المحصّل" value={money(order.paid)} /><Line label="المتبقي" value={money(Math.max(0, orderTotal(order) - order.paid))} />
          <Line label="رقم التتبع" value={order.shipmentReference || 'لا يوجد'} />
        </View>
        <Text style={s.heading}>حالة الطلب</Text>
        <View style={s.wrap}>{statuses.map((value) => <Pressable key={value} style={[s.chip, order.status === value && s.selected]} onPress={async () => { try { await save({ ...order, status: value }); } catch (e) { Alert.alert('تعذر الحفظ', String(e)); } }}><Text style={[s.chipText, order.status === value && s.selectedText]}>{value}</Text></Pressable>)}</View>
        <Button title="تعديل الطلب" subtle onPress={() => setPage('edit')} />
        {order.shipmentReference ? <Button title="تتبع شحنة درب السبيل" onPress={track} disabled={busy} /> : <Button title="إرسال لدرب السبيل" onPress={ship} disabled={busy} />}
        <Button title="حذف الطلب من الجهاز" subtle onPress={() => Alert.alert('حذف الطلب؟', 'لن يُحذف من درب السبيل.', [{ text: 'إلغاء' }, { text: 'حذف', style: 'destructive', onPress: async () => { await deleteOrder(order.id); await refresh(); setPage('orders'); } }])} />
      </>}
      {page === 'settings' && <>
        <Text style={s.title}>إعدادات الربط</Text>
        <Text style={s.help}>مفتاح درب السبيل يبقى على الخادم. هنا أدخل رابط الخادم ورمز دخول تطبيقك فقط.</Text>
        <Field label="رابط الخادم" value={settings.baseUrl} onChange={(v) => setSettings({ ...settings, baseUrl: v.trim() })} />
        <Field label="رمز دخول التطبيق" secret value={settings.appToken} onChange={(v) => setSettings({ ...settings, appToken: v.trim() })} />
        <Button title="جلب باقات التوصيل" subtle onPress={loadPackages} disabled={busy} />
        {packages.map((p) => <Pressable key={p._id} style={[s.chip, settings.serviceId === p._id && s.selected, { marginTop: 7 }]} onPress={() => setSettings({ ...settings, serviceId: p._id })}><Text style={[s.chipText, settings.serviceId === p._id && s.selectedText]}>{p.title || p.name || p._id}</Text></Pressable>)}
        {!!settings.serviceId && <Text style={s.help}>الباقة المختارة: {settings.serviceId}</Text>}
        <Button title="حفظ الإعدادات" onPress={async () => { try { await saveDeliverySettings(settings); Alert.alert('تم حفظ الإعدادات'); } catch (e) { Alert.alert('تعذر الحفظ', String(e)); } }} />
        <Text style={s.help}>الطلبات محفوظة على هذا الهاتف. حذف التطبيق يمسحها.</Text>
      </>}
    </ScrollView>
    {busy && <View style={s.busy}><ActivityIndicator color="#fff" /><Text style={{ color: '#fff' }}>جاري الاتصال…</Text></View>}
    <View style={s.nav}>{(['home', 'orders', 'settings'] as const).map((tab) => <Pressable key={tab} style={s.navItem} onPress={() => setPage(tab)}><Text style={[s.navText, page === tab && { color: '#17675e' }]}>{tab === 'home' ? 'الرئيسية' : tab === 'orders' ? 'الطلبات' : 'الإعدادات'}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function Stat({ label, value }: { label: string; value: string }) { return <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={s.caption}>{label}</Text></View>; }
function Line({ label, value }: { label: string; value: string }) { return <View style={s.line}><Text style={s.value}>{value}</Text><Text style={s.caption}>{label}</Text></View>; }
function OrderTile({ order, onPress }: { order: Order; onPress: () => void }) { return <Pressable style={s.card} onPress={onPress}><View style={s.tileTop}><Text style={s.badge}>{order.status}</Text><Text style={s.tileName}>{order.customer}</Text></View><Text style={s.caption}>{order.product} × {order.quantity} · {order.city || 'بدون مدينة'}</Text><Text style={s.total}>{money(orderTotal(order))}</Text></Pressable>; }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4f7f5' }, header: { padding: 18, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#dce7e3' },
  brand: { fontSize: 25, fontWeight: '800', color: '#173b39', textAlign: 'right' }, caption: { color: '#6d817d', textAlign: 'right', marginTop: 4 },
  body: { padding: 18, paddingBottom: 40 }, title: { fontSize: 23, fontWeight: '800', color: '#173b39', textAlign: 'right', marginBottom: 12 },
  heading: { fontSize: 17, fontWeight: '700', color: '#173b39', textAlign: 'right', marginTop: 20, marginBottom: 10 }, row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 15, padding: 16, borderWidth: 1, borderColor: '#dce7e3' }, statValue: { textAlign: 'right', fontSize: 21, fontWeight: '800', color: '#173b39' },
  button: { backgroundColor: '#17675e', padding: 14, borderRadius: 11, marginTop: 10, alignItems: 'center' }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' }, subtle: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#17675e' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce7e3', borderRadius: 15, padding: 16, marginBottom: 10 }, tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, tileName: { fontSize: 17, color: '#173b39', fontWeight: '800' }, badge: { color: '#17675e', backgroundColor: '#e4f2ee', padding: 5, borderRadius: 7 },
  total: { fontSize: 18, fontWeight: '800', color: '#173b39', textAlign: 'right', marginTop: 12 }, empty: { color: '#6d817d', textAlign: 'center', marginTop: 30 },
  field: { marginTop: 11 }, label: { color: '#173b39', fontWeight: '700', textAlign: 'right', marginBottom: 5 }, input: { backgroundColor: '#fff', color: '#173b39', borderWidth: 1, borderColor: '#dce7e3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  chip: { borderWidth: 1, borderColor: '#dce7e3', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20 }, chipText: { color: '#173b39', textAlign: 'center' }, selected: { backgroundColor: '#17675e', borderColor: '#17675e' }, selectedText: { color: '#fff' }, wrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  line: { borderBottomWidth: 1, borderColor: '#e5eeea', paddingVertical: 8 }, value: { color: '#173b39', fontWeight: '700', textAlign: 'right' }, help: { color: '#6d817d', textAlign: 'right', lineHeight: 23, marginVertical: 10 },
  nav: { flexDirection: 'row-reverse', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#dce7e3' }, navItem: { flex: 1, padding: 16 }, navText: { textAlign: 'center', color: '#6d817d', fontWeight: '700' }, busy: { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 6, backgroundColor: '#17675e' },
});
