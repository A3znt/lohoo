import { confirmationText } from '../../shared/confirmation.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownLeft, ArrowLeft, ArrowUpLeft, Bell, Box, Check, CheckCheck, ChevronLeft,
  Camera, CircleAlert, ClipboardList, Clock3, CreditCard, LayoutDashboard,
  LockKeyhole, LogOut, Menu, MessageCircle, PackageCheck, Plus, RefreshCw, Search,
  Send, Settings2, ShieldCheck, Sparkles, Truck, Users, Wallet, X,
} from 'lucide-react';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './style.css';
import OrderForm from './OrderForm';
import { dashboardMetrics, filterOrders } from './order-view';
import { api, login, loginAgent, logout, money, orderNumber, orderTotal, session, type Actor, type AgentSummary, type Bootstrap, type Order, type OrderInput, type OrderStatus, type Package, type Settings } from './api';

type View = 'overview' | 'orders' | 'shipping' | 'team' | 'settings';
const statusText: Record<OrderStatus, string> = {
  creating: 'جاري إنشاء الشحنة', confirmed: 'تم التأكيد', on_way: 'في الطريق', delivered: 'تم التسليم',
  returned: 'مرتجع', cancelled: 'ملغي', attention: 'يحتاج مراجعة',
};
const smsText: Record<string, string> = { pending: 'بانتظار الإرسال', needs_key: 'يحتاج قالب رسالة', sending: 'جاري الإرسال', sent: 'قبِلته شركة الرسائل', delivered: 'وصلت إلى هاتف الزبون', failed: 'فشل الإرسال', unknown: 'حالة غير مؤكدة' };
const today = new Intl.DateTimeFormat('ar-LY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const shortDate = (value: string) => new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

function IconBox({ icon: Icon, tone = 'teal' }: { icon: typeof Box; tone?: string }) { return <span className={`icon-box ${tone}`}><Icon size={20} strokeWidth={1.8} /></span>; }
function Status({ value }: { value: OrderStatus }) { return <span className={`status status-${value}`}><i />{statusText[value]}</span>; }
function Source({ value }: { value: Order['source'] }) { return <span className={`source ${value}`}>{value === 'facebook' ? <MessageCircle size={14} /> : <Camera size={14} />}{value === 'facebook' ? 'فيسبوك' : 'إنستغرام'}</span>; }
function Empty({ title, description, onClick }: { title: string; description: string; onClick?: () => void }) { return <div className="empty"><div className="empty-art"><ClipboardList size={31} /></div><h3>{title}</h3><p>{description}</p>{onClick && <button className="btn primary" onClick={onClick}><Plus size={18} /> إضافة طلب</button>}</div>; }

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [data, setData] = useState<Bootstrap>({ actor: { role: 'admin', id: 'admin', name: 'المدير' }, orders: [], settings: { serviceId: '', autoMessages: true }, resalaConfigured: false, agents: [], commission: { assigned: 0, delivered: 0, earned: 0, paid: 0, due: 0 } });
  const [view, setView] = useState<View>('overview');
  const [selected, setSelected] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [trash, setTrash] = useState<Order[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const refreshRequest = useRef(0);

  const refresh = async () => {
    const requestId = ++refreshRequest.current;
    setRefreshing(true);
    try {
      const next = await api<Bootstrap>('bootstrap');
      if (requestId === refreshRequest.current) {
        setData(next);
        setSyncError('');
        setLastSyncedAt(new Date());
      }
    } catch (error) {
      if (requestId === refreshRequest.current) {
        setSyncError(error instanceof Error ? error.message : 'تعذر تحديث الطلبات.');
      }
      throw error;
    } finally {
      if (requestId === refreshRequest.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    session().then((actor) => {
      setAuthenticated(Boolean(actor));
      if (actor) {
        setData((previous) => ({ ...previous, actor }));
        void refresh().catch(() => {});
      }
    }).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { if (!authenticated) return; const timer = window.setInterval(() => refresh().catch(() => {}), 60_000); return () => window.clearInterval(timer); }, [authenticated]);
  useEffect(() => { if (selected) setSelected(data.orders.find((o) => o.id === selected.id) || null); }, [data.orders]);

  const metrics = useMemo(() => dashboardMetrics(data.orders), [data.orders]);
  const visible = useMemo(() => filterOrders(data.orders, filter, query), [data.orders, filter, query]);

  async function action<T>(task: () => Promise<T>, success?: string) {
    setBusy(true);
    try {
      const result = await task();
      let refreshed = true;
      try { await refresh(); } catch { refreshed = false; }
      if (!refreshed) setToast('تم تنفيذ العملية، لكن القائمة لم تتحدّث. استخدم زر التحديث للتحقق من النتيجة.');
      else if (success) setToast(success);
      return result;
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'تعذر تنفيذ العملية');
      throw error;
    }
    finally { setBusy(false); }
  }
  async function create(input: OrderInput) {
    try {
      const result = await action(() => api<Order>('createOrder', { order: input }));
      setFormOpen(false); setSelected(result || null);
      setToast(result?.status === 'confirmed' ? 'تم إنشاء الشحنة وتأكيد الطلب بنجاح' : 'حُفظ الطلب، ويحتاج مراجعة حالة الشحنة');
    } catch { /* toast explains the error */ }
  }
  async function update(id: string, patch: Record<string, unknown>, success: string) {
    try { await action(() => api<Order>('updateOrder', { id, ...patch }), success); } catch { /* toast explains the error */ }
  }
  const navigate = (next: View) => { setView(next); setMenuOpen(false); setFilter('all'); setQuery(''); };

  if (authenticated === null) return <div className="loading-screen"><span className="brand-mark"><Box size={27} /></span><div className="spinner" /><p>جاري تجهيز مساحة عملك…</p></div>;
  if (!authenticated) return <Login onLogin={async (mode, token, username) => { if (mode === 'admin') await login(token); else await loginAgent(username, token); const actor = await session(); if (!actor) throw new Error('تعذر التحقق من الجلسة.'); setData((previous) => ({ ...previous, actor })); setAuthenticated(true); void refresh().catch(() => {}); }} />;

  return <div className="app-shell">
    {menuOpen && <button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark"><Box size={24} strokeWidth={1.8} /></div><div><strong>دفتــر</strong><small>إدارة الطلبات</small></div></div>
      <div className="workspace-label">مساحة العمل <span>{data.actor.role === 'admin' ? 'الإدارة' : 'المندوبات'}</span></div>
      <nav className="side-nav" aria-label="التنقل الرئيسي">
        <p>القائمة الرئيسية</p>
        {([
          ['overview', LayoutDashboard, 'نظرة عامة'], ['orders', ClipboardList, 'الطلبات'],
          ['shipping', Truck, 'الشحن والتوصيل'], ...(data.actor.role === 'admin' ? [['team', Users, 'المندوبات'], ['settings', Settings2, 'الإعدادات']] as const : []),
        ] as const).map(([key, Icon, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={19} strokeWidth={1.9} /><span>{label}</span>{key === 'orders' && <b>{metrics.total}</b>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-tip"><Sparkles size={18} /><strong>كل شيء في مكان واحد</strong><span>من رسالة الزبون إلى وصول الطلب.</span></div>
        <div className="sidebar-user"><span className="avatar">{data.actor.name.slice(0, 1)}</span><div><strong>{data.actor.name}</strong><small>{data.actor.role === 'admin' ? 'مدير المتجر' : 'مندوبة'}</small></div><button aria-label="تسجيل الخروج" title="تسجيل الخروج" onClick={async () => { await logout(); refreshRequest.current += 1; setAuthenticated(false); }}><LogOut size={18} /></button></div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="topbar-right"><button className="icon-button menu-button" aria-label="القائمة" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div className="breadcrumb">مساحة العمل <ChevronLeft size={15} /> <b>{view === 'overview' ? 'نظرة عامة' : view === 'orders' ? 'الطلبات' : view === 'shipping' ? 'الشحن والتوصيل' : view === 'team' ? 'المندوبات' : 'الإعدادات'}</b></div></div><div className="topbar-left"><span className={`sync-time ${syncError ? 'has-error' : ''}`} role="status">{syncError ? 'تعذر التحديث' : lastSyncedAt ? `آخر تحديث ${lastSyncedAt.toLocaleTimeString('ar-LY', { hour: 'numeric', minute: '2-digit' })}` : 'جاري تحميل البيانات'}</span><button type="button" className="sync-button" aria-label="تحديث الطلبات" title="تحديث الطلبات" disabled={refreshing} onClick={() => void refresh().catch(() => {})}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /><span>تحديث</span></button><span className="date-pill"><Clock3 size={15} />{today}</span><span className="top-avatar">{data.actor.name.slice(0, 1)}</span></div></header>
      <div className="content">
        {syncError && <div className="sync-warning" role="alert"><CircleAlert size={19} /><span>تعذر تحديث البيانات: {syncError}. قد تكون الأرقام قديمة.</span><button type="button" disabled={refreshing} onClick={() => void refresh().catch(() => {})}>إعادة المحاولة</button></div>}
        {view === 'overview' && <>
          <div className="hero"><div><div className="eyebrow"><span className="pulse-dot" /> مركز إدارة متجرك</div><h1>كل طلب، من أول رسالة<br /><em>حتى باب الزبون.</em></h1><p>تابع الطلبات والشحن والتحصيل من لوحة واحدة مرتبة وواضحة.</p><button className="btn light" onClick={() => setFormOpen(true)}><Plus size={19} /> إضافة طلب جديد <ArrowLeft size={18} /></button></div><div className="hero-visual" aria-hidden="true"><div className="hero-card floating-one"><span className="mini-icon"><PackageCheck size={19} /></span><div><strong>تم تأكيد الطلب</strong><small>الشحنة أُرسلت لدرب السبيل</small></div><Check size={18} /></div><div className="hero-card floating-two"><span className="mini-icon gold"><Send size={18} /></span><div><strong>الطلب في الطريق</strong><small>الزبون استلم التحديث</small></div><span className="waves">)))</span></div><div className="hero-orbit"><Box size={74} strokeWidth={1.1} /></div></div></div>
          {metrics.attention > 0 && <div className="notice attention"><CircleAlert size={20} /><span><strong>{metrics.attention} طلب يحتاج مراجعة</strong> — تأكد من حالة الشحنة في درب السبيل قبل إعادة المحاولة.</span><button onClick={() => navigate('orders')}>عرض الطلبات <ArrowLeft size={16} /></button></div>}
          {data.actor.role === 'admin' && !data.resalaConfigured && <div className="notice"><MessageCircle size={20} /><span><strong>رسائل الزبائن تنتظر قوالب رسالة.</strong> أضف معرّفَي القالبين المعتمدين على الخادم لتبدأ الرسائل التلقائية.</span><button onClick={() => navigate('settings')}>التفاصيل <ArrowLeft size={16} /></button></div>}
          <div className="section-heading"><div><span className="overline">ملخص اليوم</span><h2>أرقامك بنظرة واحدة</h2></div><span className="muted">تتحدث تلقائيًا مع كل طلب</span></div>
          <div className="metric-grid">
            <Metric icon={ClipboardList} label="إجمالي الطلبات" value={String(metrics.total)} note="من فيسبوك وإنستغرام" tone="teal" />
            <Metric icon={Truck} label="طلبات في الطريق" value={String(metrics.onWay)} note="مع درب السبيل" tone="blue" />
            {data.actor.role === 'admin' ? <><Metric icon={CreditCard} label="قيمة الطلبات" value={money(metrics.revenue)} note="باستثناء المرتجع والملغي" tone="amber" /><Metric icon={ArrowDownLeft} label="المتبقي للتحصيل" value={money(metrics.due)} note={`${money(metrics.paid)} تم تحصيلها`} tone="rose" /></> : <><Metric icon={Wallet} label="عمولتي المستحقة" value={money(data.commission.earned)} note="15 د.ل بعد التسليم لكل طلب" tone="amber" /><Metric icon={ArrowDownLeft} label="المتبقي لي" value={money(data.commission.due)} note={`${money(data.commission.paid)} تم صرفها`} tone="rose" /></>}
          </div>
          <div className="dashboard-grid"><div className="panel"><div className="panel-head"><div><span className="overline">آخر النشاط</span><h2>أحدث الطلبات</h2></div><button className="text-button" onClick={() => navigate('orders')}>عرض الكل <ArrowLeft size={16} /></button></div>{data.orders.length ? <OrderList orders={data.orders.slice(0, 5)} onSelect={setSelected} compact /> : <Empty title="هنا تبدأ حكاية أول طلب" description="أضف الطلب القادم من فيسبوك أو إنستغرام، والباقي علينا." onClick={() => setFormOpen(true)} />}</div><div className="panel flow-panel"><div className="panel-head"><div><span className="overline">سير العمل</span><h2>رحلة الطلب</h2></div></div><div className="flow-list"><FlowStep icon={ClipboardList} title="تسجيل الطلب" text="أدخل بيانات الزبون والمنتج" active /><FlowStep icon={Truck} title="إنشاء الشحنة" text="إرسال مباشر لدرب السبيل" active={Boolean(data.settings.serviceId)} /><FlowStep icon={MessageCircle} title="رسالة التأكيد" text="إشعار للزبون عبر رسالة" active={data.resalaConfigured} /><FlowStep icon={Send} title="في الطريق" text="تحديث تلقائي ورسالة ثانية" active={data.resalaConfigured} last /></div>{data.actor.role === 'admin' && <button className="flow-action" onClick={() => navigate('settings')}>إعدادات الربط <ArrowUpLeft size={17} /></button>}</div></div>
        </>}

        {view === 'orders' && <><PageTitle overline="إدارة الطلبات" title="طلباتك كلها، بوضوح." description="من أول تواصل حتى التسليم، كل التفاصيل محفوظة هنا." action={() => setFormOpen(true)} /><div className="panel list-panel"><div className="list-toolbar">{data.actor.role === 'admin' && <button className="btn ghost" onClick={async () => { try { setTrash(await api<Order[]>('trash')); } catch { setToast('تعذر فتح المحذوفات'); } }}>المحذوفات</button>}<div className="search"><Search size={18} /><input aria-label="بحث في الطلبات" placeholder="الاسم، الهاتف، المنطقة، المندوبة، رقم الشحنة…" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span className="count-pill">{visible.length} طلب</span></div><div className="filters">{([['all', 'الكل'], ['creating', 'جاري الإنشاء'], ['confirmed', 'مؤكد'], ['on_way', 'في الطريق'], ['delivered', 'تم التسليم'], ['returned', 'مرتجع'], ['cancelled', 'ملغي'], ['attention', 'يحتاج مراجعة']] as const).map(([key, label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div>{visible.length ? <OrderList orders={visible} onSelect={setSelected} /> : <Empty title={query.trim() || filter !== 'all' ? 'لا توجد طلبات مطابقة' : 'ما فيش طلبات هنا بعد'} description={query.trim() || filter !== 'all' ? 'جرّب تغيير البحث أو حالة الطلب.' : 'أضف أول طلب جديد.'} onClick={query.trim() || filter !== 'all' ? undefined : () => setFormOpen(true)} />}</div></>}

        {view === 'shipping' && <><PageTitle overline="درب السبيل" title="كل شحنة تحت عينك." description="تتبّع الشحنات وتحديثات التوصيل في مكان واحد." /><div className="shipping-banner"><div className="shipping-logo"><Truck size={28} /></div><div><strong>الربط مع درب السبيل</strong><p>عند إضافة طلب جديد، تُنشأ شحنته مباشرة بعد التأكيد.</p></div><span className="connection-dot">تكامل الشحن</span></div><div className="panel list-panel"><div className="panel-head"><div><span className="overline">شحناتك</span><h2>سجل التوصيل</h2></div></div>{data.orders.filter((o) => o.shipmentReference).length ? <OrderList orders={data.orders.filter((o) => o.shipmentReference)} onSelect={setSelected} /> : <Empty title="لا توجد شحنات بعد" description="أضف أول طلب ليظهر رقم التتبع وتحديثاته هنا." onClick={() => setFormOpen(true)} />}</div></>}

        {view === 'team' && data.actor.role === 'admin' && <TeamPage agents={data.agents} busy={busy} run={action} />}
        {view === 'settings' && data.actor.role === 'admin' && <SettingsPage settings={data.settings} resalaConfigured={data.resalaConfigured} busy={busy} onSave={async (next) => { try { await action(() => api<Settings>('saveSettings', { settings: next }), 'تم حفظ الإعدادات'); } catch { /* toast */ } }} />}
      </div>
    </main>
    {trash && <div className="confirm-layer"><section className="confirm-card" style={{maxHeight:'85dvh',overflow:'auto'}}><h3>المحذوفات</h3>{!trash.length && <p>لا توجد طلبات محذوفة</p>}{trash.map(o => <p key={o.id}>{o.customer} · {orderNumber(o)} {o.darbStatus === 'not_found' ? ' · لم يعثر درب السبيل على المرجع' : o.carrierDeletedAt ? ' · حُذفت الشحنة من درب السبيل' : o.shipmentReference ? ' · حُذف السجل محليًا فقط' : ''} {o.shipmentReference && !o.carrierDeletedAt && <button className="btn ghost" disabled={busy} onClick={async () => { if (!window.confirm('حذف الشحنة نهائيًا من درب السبيل؟')) return; try { await action(() => api('deleteOrder', {id:o.id}), 'حُذفت الشحنة'); setTrash(await api<Order[]>('trash')); } catch { /* toast */ } }}>حذف من درب السبيل</button>} <button className="btn ghost" disabled={busy} onClick={async () => { try { await action(() => api('restoreOrder', { id:o.id }), 'تمت استعادة الطلب'); setTrash(trash.filter(row => row.id !== o.id)); } catch { /* toast */ } }}>استعادة السجل</button></p>)}<button className="btn primary" onClick={() => setTrash(null)}>إغلاق</button></section></div>}
    {editing && <EditOrder order={editing} actor={data.actor} agents={data.agents} busy={busy} close={() => setEditing(null)} save={async form => { try { const result = await action(() => api<Order>('editOrder', { id:editing.id, version:editing.updatedAt, order:form }), 'حُفظت التعديلات'); setEditing(null); setSelected(result); } catch { /* toast */ } }} />}
    {formOpen && <OrderForm onClose={() => setFormOpen(false)} onCreate={create} busy={busy} defaultServiceId={data.settings.serviceId} agents={data.agents} actor={data.actor} />}
    {selected && !editing && <OrderDetails onEdit={() => setEditing(selected)} order={selected} onClose={() => setSelected(null)} onAction={async (name, params, success) => { try { await action(() => api<Order>(name, { id: selected.id, ...params }), success); } catch { /* toast */ } }} busy={busy} actor={data.actor} agents={data.agents} />}
    {toast && <div className="toast"><Bell size={18} /><span>{toast}</span><button onClick={() => setToast('')} aria-label="إغلاق"><X size={15} /></button></div>}
  </div>;
}

function Login({ onLogin }: { onLogin: (mode: 'admin' | 'agent', token: string, username: string) => Promise<void> }) {
  const [mode, setMode] = useState<'admin' | 'agent'>('admin');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <div className="login-screen"><div className="login-art"><div className="login-brand"><span className="brand-mark"><Box size={25} /></span><strong>دفتــر</strong></div><div className="login-art-copy"><span className="overline">مساحة عملك الخاصة</span><h1>رتّب طلباتك.<br /><em>وخلّي الباقي علينا.</em></h1><p>من طلبات السوشيال ميديا إلى الشحن ورسائل الزبائن، كل خطوة واضحة وفي مكانها.</p><div className="login-features"><span><Check size={16} /> إدارة الطلبات</span><span><Check size={16} /> درب السبيل</span><span><Check size={16} /> رسالة SMS</span></div></div><div className="login-art-footer">صُمّم لعملك، على طريقتك.</div></div><div className="login-form-side"><div className="login-card"><span className="login-lock"><LockKeyhole size={24} /></span><span className="overline">أهلًا بعودتك</span><h2>ادخل لمساحة عملك</h2><div className="login-tabs"><button type="button" className={mode === 'admin' ? 'selected' : ''} onClick={() => { setMode('admin'); setError(''); }}>الإدارة</button><button type="button" className={mode === 'agent' ? 'selected' : ''} onClick={() => { setMode('agent'); setError(''); }}>المندوبات</button></div><p>{mode === 'admin' ? 'استخدم كلمة مرور المدير.' : 'استخدمي اسم الدخول وكلمة المرور الخاصة بك.'}</p><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await onLogin(mode, token.trim(), username.trim()); } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول'); } finally { setBusy(false); } }}>{mode === 'agent' && <><label htmlFor="username">اسم الدخول</label><input id="username" dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></>}<label htmlFor="token">كلمة المرور</label><input id="token" type="password" autoComplete="current-password" placeholder={mode === 'admin' ? 'أدخل كلمة مرور المدير' : 'أدخلي كلمة المرور'} value={token} onChange={(e) => setToken(e.target.value)} required /><button className="btn primary full" disabled={busy}>{busy ? 'جاري الدخول…' : 'دخول إلى اللوحة'} <ArrowLeft size={17} /></button></form>{error && <div className="form-error"><CircleAlert size={17} />{error}</div>}<div className="login-secure"><ShieldCheck size={17} /> بيانات الدخول محفوظة على الخادم.</div></div></div></div>;
}

function Metric({ icon, label, value, note, tone }: { icon: typeof Box; label: string; value: string; note: string; tone: string }) { return <div className="metric"><div className="metric-top"><IconBox icon={icon} tone={tone} /><ArrowUpLeft size={17} className="metric-arrow" /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function FlowStep({ icon: Icon, title, text, active, last = false }: { icon: typeof Box; title: string; text: string; active: boolean; last?: boolean }) { return <div className={`flow-step ${last ? 'last' : ''}`}><div className={`flow-icon ${active ? 'active' : ''}`}><Icon size={18} /></div><div><strong>{title}</strong><span>{text}</span></div><span className={`flow-check ${active ? 'active' : ''}`}>{active ? <Check size={14} /> : '·'}</span></div>; }
function PageTitle({ overline, title, description, action }: { overline: string; title: string; description: string; action?: () => void }) { return <div className="page-title"><div><span className="overline">{overline}</span><h1>{title}</h1><p>{description}</p></div>{action && <button className="btn primary" onClick={action}><Plus size={18} /> طلب جديد</button>}</div>; }
function OrderList({ orders, onSelect, compact = false }: { orders: Order[]; onSelect: (order: Order) => void; compact?: boolean }) { return <div className={`order-list ${compact ? 'compact' : ''}`}><div className="table-head"><span>الزبون / الطلب</span><span>المصدر</span><span>التاريخ</span><span>القيمة</span><span>الحالة</span><span /></div>{orders.map((order) => <button className="order-row" key={order.id} onClick={() => onSelect(order)}><div className="order-customer"><span className="customer-avatar">{order.customer.slice(0, 1)}</span><span><strong>{order.customer}</strong><small>طلب رقم {orderNumber(order)} · {order.product} × {order.quantity}{order.createdByName ? ` · أدخله ${order.createdByName}` : ""}</small></span></div><Source value={order.source} /><span className="date-cell">{shortDate(order.createdAt)}</span><strong className="money-cell">{money(orderTotal(order))}</strong><Status value={order.status} /><ChevronLeft className="row-chevron" size={18} /></button>)}</div>; }

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <div className="field"><label>{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} /></div>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { const [draft, setDraft] = useState(String(value)); useEffect(() => setDraft(String(value)), [value]); return <div className="field"><label>{label}</label><input type="number" min="0" step="0.01" value={draft} onChange={(e) => { setDraft(e.target.value); onChange(Number(e.target.value || 0)); }} /></div>; }

function EditOrder({ order, actor, agents, busy, close, save }: { order: Order; actor: Actor; agents: AgentSummary[]; busy: boolean; close: () => void; save: (form: Partial<OrderInput>) => void }) {
  const [notes, setNotes] = useState(order.notes);
  const [source, setSource] = useState(order.source);
  if (order.status === 'attention' && !order.shipmentReference && /Unexpected property has been encountered!|Unable to fetch branch/.test(order.shippingError || '')) {
    return <OrderForm initial={{ ...order, warehouseProductId:order.warehouseProductId || '', warehouseVariantId:order.warehouseVariantId || '' }} onCreate={save} onClose={close} agents={agents} actor={actor} defaultServiceId={order.serviceId} busy={busy} />;
  }
  return <div className="confirm-layer"><section className="confirm-card"><h3>تعديل الطلب {orderNumber(order)}</h3><p>التعديل داخل دفتر. تغييرات المنتج والعنوان والسعر للشحنة المسجلة تتم عند درب السبيل.</p><label className="field">مصدر الطلب<select value={source} onChange={e => setSource(e.target.value as Order['source'])}><option value="facebook">فيسبوك</option><option value="instagram">إنستغرام</option></select></label><label className="field">ملاحظات<input value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} /></label><div className="confirm-actions"><button className="btn ghost" onClick={close}>رجوع</button><button className="btn primary" disabled={busy} onClick={() => save({notes,source})}>حفظ التعديل</button></div></section></div>;
}
function OrderDetails({ onEdit, order, onClose, onAction, busy, actor, agents }: { onEdit: () => void; order: Order; onClose: () => void; onAction: (action: string, data: Record<string, unknown>, success: string) => void; busy: boolean; actor: Actor; agents: AgentSummary[] }) {
  const [paid, setPaid] = useState(String(order.paid));
  useEffect(() => setPaid(String(order.paid)), [order.paid]);
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="إغلاق" onClick={onClose} /><section className="drawer detail-drawer"><div className="drawer-head"><div><span className="overline">تفاصيل الطلب · {orderNumber(order)}</span><h2>{order.customer}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></div><div className="drawer-body"><div className="detail-status-line"><Status value={order.status} /><Source value={order.source} /></div>{order.status === 'attention' && <div className="form-error"><CircleAlert size={18} />{order.shippingError || 'راجع الشحنة في لوحة درب السبيل قبل المحاولة مجددًا.'}</div>}<div className="detail-section"><h3>بيانات الطلب</h3><DetailLine label="رقم الطلب" value={orderNumber(order)} /><DetailLine label="أُدخل بواسطة" value={order.createdByName || "غير مسجل"} /><DetailLine label="المنتج" value={`${order.product} × ${order.quantity}`} />{order.sku && <DetailLine label="SKU" value={order.sku} />}{order.widthCM !== undefined && <DetailLine label="القياس" value={`${order.widthCM} × ${order.heightCM} × ${order.lengthCM} سم`} />}<DetailLine label="رقم الهاتف" value={order.phone} /><DetailLine label="العنوان" value={`${order.city}، ${order.area}، ${order.address}`} /><DetailLine label="تاريخ الطلب" value={shortDate(order.createdAt)} /><DetailLine label="رسوم التوصيل" value={money(order.deliveryFee)} /><DetailLine label="الإجمالي" value={money(orderTotal(order))} strong />{order.notes && <DetailLine label="ملاحظات" value={order.notes} />}</div><div className="detail-section"><h3>المندوبة والعمولة</h3>{actor.role === 'admin' ? <div className="field"><label htmlFor="detail-agent">المندوبة المسؤولة</label><select id="detail-agent" value={order.agentId || ''} disabled={busy || Boolean(order.commissionPaidAt)} onChange={(e) => onAction('assignAgent', { agentId: e.target.value }, 'تم تحديث المندوبة')}><option value="">بدون مندوبة</option>{agents.filter((a) => a.enabled || a.id === order.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div> : <DetailLine label="المندوبة" value={order.agentName || actor.name} />}<DetailLine label="قيمة العمولة" value={order.commissionEarnedAt ? money(order.commissionAmount || 15) : '15 د.ل بعد التسليم'} /><DetailLine label="الحالة" value={order.commissionPaidAt ? 'صُرفت' : order.commissionEarnedAt ? 'مستحقة ولم تُصرف' : 'بانتظار التسليم'} />{actor.role === 'admin' && order.commissionEarnedAt && !order.commissionPaidAt && <button className="btn primary full" disabled={busy} onClick={() => onAction('payCommission', {}, 'تم تسجيل صرف العمولة')}>تسجيل صرف 15 د.ل</button>}</div><div className="detail-section"><h3>التحصيل</h3><div className="collection-card"><div><small>المتبقي للتحصيل</small><strong>{money(Math.max(0, orderTotal(order) - order.paid))}</strong></div><CreditCard size={24} /></div>{actor.role === 'admin' && <div className="paid-edit"><input aria-label="المبلغ المحصّل" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /><button className="btn ghost" disabled={busy || Number(paid) === order.paid} onClick={() => onAction('updateOrder', { paid: Number(paid) }, 'تم تحديث المبلغ المحصّل')}>حفظ المحصّل</button></div>}</div><div className="detail-section"><h3>الشحن والتواصل</h3>{order.shipmentReference && !order.carrierDeletedAt && <details><summary>نص تأكيد الطلب للمشاركة</summary><textarea aria-label="رسالة التأكيد للمشاركة" readOnly rows={10} style={{width:"100%",font:"inherit"}} value={confirmationText(order)} onFocus={e => e.target.select()} /></details>}<DetailLine label="رقم التتبع" value={order.shipmentReference || 'لم يُنشأ بعد'} /><DetailLine label="حالة درب السبيل" value={order.darbStatus === 'not_found' ? 'المرجع غير موجود لدى درب السبيل' : order.carrierDeletedAt ? 'حُذفت من درب السبيل' : order.darbStatus || '—'} /><DetailLine label="رسالة التأكيد" value={smsText[order.confirmationSms] || order.confirmationSms} /><DetailLine label="رسالة الطريق" value={smsText[order.onWaySms] || order.onWaySms} />{order.shipmentReference && <button className="btn ghost full" disabled={busy} onClick={() => onAction('syncOrder', {}, 'تم تحديث حالة الشحنة')}><RefreshCw size={17} /> تحديث حالة الشحنة</button>}</div>{order.status === 'attention' && !order.shipmentReference && /Unexpected property has been encountered!|Unable to fetch branch/.test(order.shippingError || '') && <RetryShipmentPanel order={order} busy={busy} onAction={onAction} />}</div><div className="drawer-footer stacked"><button className="btn ghost full" disabled={busy || order.status === 'creating'} onClick={onEdit}>تعديل الطلب</button>{actor.role === 'admin' && <button className="btn ghost full" disabled={busy || order.status === 'creating'} onClick={() => { if (window.confirm(order.shipmentReference && !order.carrierDeletedAt ? 'حذف هذه الشحنة نهائيًا من درب السبيل ونقل الطلب إلى المحذوفات؟ استعادة سجل دفتر لاحقًا لا تعيد الشحنة.' : 'نقل سجل الطلب إلى المحذوفات؟')) onAction('deleteOrder', {}, 'نُقل الطلب إلى المحذوفات'); }}>{order.shipmentReference && !order.carrierDeletedAt ? 'حذف الشحنة من درب السبيل ودفتر' : 'حذف سجل الطلب'}</button>}</div></section></div>;
}
function DetailLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className="detail-line"><span>{label}</span><b className={strong ? 'strong' : ''}>{value}</b></div>; }

function RetryShipmentPanel({ order, busy, onAction }: { order: Order; busy: boolean; onAction: (action: string, data: Record<string, unknown>, success: string) => void }) {
  const [locations, setLocations] = useState<{ city: string; areas: string[] }[]>([]);
  const [city, setCity] = useState(order.city);
  const [area, setArea] = useState(order.area);
  const [address, setAddress] = useState(order.address);
  const [error, setError] = useState('');
  useEffect(() => { api<{ city: string; areas: string[] }[]>('deliveryLocations').then(setLocations).catch((err) => setError(err instanceof Error ? err.message : 'تعذر جلب المناطق.')); }, []);
  const selected = locations.find((item) => item.city === city);
  const ready = Boolean(selected?.areas.includes(area) && address.trim());
  return <div className="detail-section retry-panel"><h3>إصلاح الشحنة</h3><p>هذا الطلب توقف قبل إنشاء الشحنة. راجع العنوان، ثم أعد إرساله إلى درب السبيل.</p><div className="field-grid"><label className="field">المدينة<select value={selected ? city : ''} onChange={(e) => { setCity(e.target.value); setArea(''); }}><option value="">اختر المدينة</option>{locations.map((item) => <option key={item.city} value={item.city}>{item.city}</option>)}</select></label><label className="field">المنطقة<select value={ready || selected?.areas.includes(area) ? area : ''} disabled={!selected} onChange={(e) => setArea(e.target.value)}><option value="">اختر المنطقة</option>{selected?.areas.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><label className="field">العنوان التفصيلي<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>{error && <div className="form-error">{error}</div>}<button className="btn primary full" disabled={!ready || busy} onClick={() => { if (window.confirm('سيُنشأ طلب شحن في درب السبيل وتُرسل رسالة التأكيد للزبون. تأكد من صحة البيانات.')) onAction('retryShipment', { destination: { city, area, address } }, 'تمت إعادة محاولة إنشاء الشحنة'); }}><RefreshCw size={17} /> إعادة إرسال الشحنة</button></div>;
}

function TeamPage({ agents, busy, run }: { agents: AgentSummary[]; busy: boolean; run: <T>(task: () => Promise<T>, success?: string) => Promise<T> }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [credential, setCredential] = useState<{ name: string; username: string; password: string } | null>(null);
  async function createAgentAccount() {
    try {
      const result = await run(() => api<AgentSummary & { password: string }>('createAgent', { agent: { name, username } }), 'تم إنشاء حساب المندوبة');
      setCredential(result); setName(''); setUsername('');
    } catch { /* toast */ }
  }
  async function changeAgentAccount(action: 'resetAgentPassword' | 'setAgentEnabled', agent: AgentSummary) {
    try {
      const result = await run(() => api<AgentSummary & { password?: string }>(action, { id: agent.id, enabled: !agent.enabled }), action === 'resetAgentPassword' ? 'تم تجديد كلمة المرور' : 'تم تحديث حالة الحساب');
      if (result.password) setCredential({ name: result.name, username: result.username, password: result.password });
    } catch { /* toast */ }
  }
  return <><PageTitle overline="فريق العمل" title="المندوبات والعمولات." description="15 د.ل لكل طلب بعد تسليمه. سجّل الصرف من تفاصيل الطلب." />
    <div className="team-summary"><Metric icon={Users} label="المندوبات" value={String(agents.filter((a) => a.enabled).length)} note="حسابات نشطة" tone="teal" /><Metric icon={PackageCheck} label="طلبات تم تسليمها" value={String(agents.reduce((n, a) => n + a.delivered, 0))} note="لكل المندوبات" tone="blue" /><Metric icon={Wallet} label="عمولات مستحقة" value={money(agents.reduce((n, a) => n + a.due, 0))} note="تُصرف بعد التسليم" tone="amber" /></div>
    <div className="team-layout"><section className="panel team-panel"><div className="panel-head"><div><span className="overline">الفريق الحالي</span><h2>الحسابات</h2></div></div>{agents.length ? agents.map((agent) => <article className="agent-card" key={agent.id}><div className="agent-card-head"><span className="customer-avatar">{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><small dir="ltr">@{agent.username}</small></div><span className={`agent-state ${agent.enabled ? '' : 'disabled'}`}>{agent.enabled ? 'نشطة' : 'موقوفة'}</span></div><div className="agent-stats"><span>الطلبات <b>{agent.assigned}</b></span><span>المسلّمة <b>{agent.delivered}</b></span><span>المستحق <b>{money(agent.earned)}</b></span><span>المصروف <b>{money(agent.paid)}</b></span><span>المتبقي <b>{money(agent.due)}</b></span></div><div className="agent-actions"><button className="btn ghost" disabled={busy} onClick={() => changeAgentAccount('resetAgentPassword', agent)}>تجديد كلمة المرور</button><button className="btn ghost" disabled={busy} onClick={() => changeAgentAccount('setAgentEnabled', agent)}>{agent.enabled ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button></div></article>) : <p className="team-empty">أضف أول مندوبة لتظهر حساباتها وعمولاتها هنا.</p>}</section>
    <section className="panel team-panel add-agent"><div className="panel-head"><div><span className="overline">إضافة حساب</span><h2>مندوبة جديدة</h2></div><IconBox icon={Plus} /></div><p>اسم دخول خاص وكلمة مرور تُعرض مرة واحدة بعد الإنشاء.</p><Field label="الاسم" value={name} onChange={setName} placeholder="اسم المندوبة" /><Field label="اسم الدخول بالإنجليزية" value={username} onChange={setUsername} placeholder="مثال: saja" /><button className="btn primary full" disabled={busy || name.trim().length < 2 || username.trim().length < 3} onClick={createAgentAccount}>إضافة مندوبة <Plus size={17} /></button></section></div>
    {credential && <div className="confirm-layer"><div className="confirm-card credential-card"><span className="confirm-icon"><LockKeyhole size={25} /></span><h3>بيانات دخول {credential.name}</h3><p>احفظ كلمة المرور الآن؛ لن تظهر مرة ثانية. يمكنك تجديدها لاحقًا.</p><div className="credential-line"><span>اسم الدخول</span><strong dir="ltr">{credential.username}</strong></div><div className="credential-line"><span>كلمة المرور</span><strong dir="ltr">{credential.password}</strong></div><button className="btn primary full" onClick={() => setCredential(null)}>حفظت البيانات</button></div></div>}</>;
}

function SettingsPage({ settings, resalaConfigured, busy, onSave }: { settings: Settings; resalaConfigured: boolean; busy: boolean; onSave: (settings: Settings) => void }) {
  const [form, setForm] = useState(settings); const [packages, setPackages] = useState<Package[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => setForm(settings), [settings]);
  async function load() { setLoading(true); setError(''); try { setPackages(await api<Package[]>('packages')); } catch (err) { setError(err instanceof Error ? err.message : 'تعذر جلب الباقات'); } finally { setLoading(false); } }
  return <><PageTitle overline="إعدادات الربط" title="اضبط عملك على مقاسك." description="اختر باقة التوصيل وتابع حالة اتصال الخدمات." /><div className="settings-grid"><section className="panel settings-panel"><div className="settings-head"><IconBox icon={Truck} /><div><h2>درب السبيل</h2><p>إنشاء الشحنات وتحديث حالتها تلقائيًا.</p></div><span className="connection-dot">تكامل الشحن</span></div><div className="settings-rule" /><label className="settings-label">باقة التوصيل الافتراضية</label><p className="settings-help">تُستخدم مع كل طلب جديد. يمكنك تغييرها متى شئت.</p><button className="btn ghost" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''} />{loading ? 'جاري الجلب…' : 'جلب باقات التوصيل'}</button>{error && <div className="form-error">{error}</div>}{packages.length > 0 && <div className="package-options">{packages.map((item) => <button key={item._id} className={form.serviceId === item._id ? 'selected' : ''} onClick={() => setForm({ ...form, serviceId: item._id })}><span className="radio-circle">{form.serviceId === item._id && <Check size={13} />}</span><span>{item.title || item.name || item._id}</span></button>)}</div>}{form.serviceId && !packages.length && <div className="selected-package"><Check size={16} /> باقة محفوظة · {form.serviceId}</div>}<button className="btn primary settings-save" disabled={busy || !form.serviceId} onClick={() => onSave(form)}>حفظ الإعدادات <ArrowLeft size={17} /></button></section><section className="panel settings-panel"><div className="settings-head"><IconBox icon={MessageCircle} tone="blue" /><div><h2>رسالة SMS</h2><p>رسالتان تلقائيتان لطمأنة الزبون.</p></div><span className={`connection-dot ${resalaConfigured ? '' : 'offline'}`}>{resalaConfigured ? 'جاهز' : 'بانتظار القالبين'}</span></div><div className="settings-rule" /><div className="message-preview"><span className="message-step">01</span><div><strong>عند تأكيد الطلب</strong><p>«تم تأكيد طلبك… سنوافيك بتحديث التوصيل.»</p></div></div><div className="message-preview"><span className="message-step">02</span><div><strong>عندما يكون في الطريق</strong><p>«طلبك في طريقه إليك… رقم التتبع…»</p></div></div><label className="toggle-row"><span><strong>الرسائل التلقائية</strong><small>تُرسل من الخادم عند توفر ربط رسالة</small></span><input type="checkbox" checked={form.autoMessages} onChange={(e) => setForm({ ...form, autoMessages: e.target.checked })} /><i /></label>{!resalaConfigured && <div className="settings-warning"><CircleAlert size={18} /><span>يلزم إضافة مفتاح رسالة ومعرّفَي قالبَي التأكيد والطريق المعتمدين إلى إعدادات Cloudflare. الرسائل غير مرسلة حاليًا.</span></div>}</section></div><div className="security-note"><ShieldCheck size={19} /><span>مفاتيح درب السبيل ورسالة محفوظة على الخادم فقط. بيانات الطلبات متاحة بعد تسجيل الدخول برمزك الشخصي.</span></div></>;
}

createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));







