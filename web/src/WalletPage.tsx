import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpLeft, Check, Clock3, CreditCard, PackageCheck, RefreshCw, Search, Wallet } from 'lucide-react';
import CopyButton from './CopyButton';
import { money, orderNumber, type CommissionSummary, type Order, type PayoutProfile, type PayoutRequest, type WalletEntry } from './api';

type Filter = 'all' | 'due' | 'paid' | 'pending';
type Props = { entries: WalletEntry[]; summary: CommissionSummary; orders: Order[]; refreshing: boolean; onRefresh: () => void; onOpenOrder: (order: Order) => void;
  profile: PayoutProfile | null; requests: PayoutRequest[]; busy: boolean; onSaveProfile: (profile: PayoutProfile) => Promise<void>; onRequestPayout: () => Promise<void>; onCancelPayout: (id: string) => Promise<void> };
const date = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed) : '—';
};
const kind = (entry: WalletEntry): Exclude<Filter, 'all'> => entry.commissionPaidAt ? 'paid' : entry.commissionEarnedAt ? 'due' : 'pending';

export default function WalletPage({ entries, summary, orders, refreshing, onRefresh, onOpenOrder, profile, requests, busy, onSaveProfile, onRequestPayout, onCancelPayout }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PayoutProfile>(profile || { method: 'bank', accountHolder: '', bankName: '', accountNumber: '', phone: '', notes: '' });
  const [editingProfile, setEditingProfile] = useState(false);
  const activeRequest = requests.find((request) => ['pending', 'processing'].includes(request.status));
  const ledger = useMemo(() => entries.filter(entry => entry.commissionEarnedAt || (!entry.deletedAt && entry.status !== 'cancelled' && entry.status !== 'returned'))
    .sort((a, b) => Date.parse(b.commissionPaidAt || b.commissionEarnedAt || b.createdAt) - Date.parse(a.commissionPaidAt || a.commissionEarnedAt || a.createdAt)), [entries]);
  const counts = {
    due: ledger.filter(entry => kind(entry) === 'due').length,
    paid: ledger.filter(entry => kind(entry) === 'paid').length,
    pending: ledger.filter(entry => kind(entry) === 'pending').length,
  };
  const needle = query.trim().toLocaleLowerCase();
  const visible = ledger.filter(entry => (filter === 'all' || kind(entry) === filter) && (!needle || [entry.customer, entry.product, orderNumber({ id: entry.orderId, orderNumber: entry.orderNumber })].join(' ').toLocaleLowerCase().includes(needle)));
  const payoutPercent = summary.earned > 0 ? Math.min(100, Math.round(summary.paid / summary.earned * 100)) : 0;
  return <div className="wallet-page">
    <div className="wallet-topline"><div><span className="overline">حساب المندوبة</span><h1>محفظتي</h1><p>كل عمولة من طلب تم تسليمه، في مكان واحد.</p></div><button type="button" className="wallet-refresh" disabled={refreshing} onClick={onRefresh}><RefreshCw size={17} className={refreshing ? 'spin' : ''} /> تحديث</button></div>
    <section className="wallet-hero" aria-label="رصيد المحفظة"><div className="wallet-hero-shine" aria-hidden="true" /><div className="wallet-hero-top"><span className="wallet-hero-mark"><Wallet size={23} /></span><span className="wallet-hero-brand">رُكن <i /> محفظتي</span></div><span className="wallet-balance-label">المستحق لك الآن</span><strong className="wallet-balance" dir="auto">{money(summary.due)}</strong><div className="wallet-hero-bottom"><span>تُضاف العمولة بعد تسليم الطلب</span><b>15 د.ل لكل طلب</b></div></section>
    <div className="wallet-metrics"><div className="wallet-metric"><span className="wallet-metric-icon earned"><PackageCheck size={20} /></span><small>إجمالي المكتسب</small><strong>{money(summary.earned)}</strong><span>{counts.due + counts.paid} طلب استحق العمولة</span></div><div className="wallet-metric"><span className="wallet-metric-icon paid"><Check size={20} /></span><small>المصروف لك</small><strong>{money(summary.paid)}</strong><span>{counts.paid} طلب صُرفت عمولته</span></div><div className="wallet-metric"><span className="wallet-metric-icon pending"><Clock3 size={20} /></span><small>بانتظار التسليم</small><strong>{counts.pending} طلب</strong><span>{money(counts.pending * 15)} عمولات محتملة</span></div></div>
    <section className="wallet-progress"><div className="wallet-progress-copy"><div><span className="overline">الصرف</span><h2>ما صُرف من عمولاتك</h2></div><strong>{payoutPercent}%</strong></div><div className="wallet-progress-track" role="progressbar" aria-label="نسبة العمولات المصروفة" aria-valuenow={payoutPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${payoutPercent}%` }} /></div><p>المستحق {money(summary.due)} · المصروف {money(summary.paid)}</p></section>
    <section className="panel wallet-payout"><div className="wallet-section-head"><div><span className="overline">السحب</span><h2>استلام العمولات</h2></div><span>{activeRequest ? 'طلب قيد المراجعة' : 'جاهز'}</span></div>
      {profile && !editingProfile ? <div className="payout-profile-summary"><strong>{profile.accountHolder}</strong><span>{profile.method === 'bank' ? `${profile.bankName} · ${profile.accountNumber}` : profile.method === 'transfer' ? `حوالة · ${profile.phone}` : 'استلام نقدي'}</span><button className="btn ghost" type="button" onClick={() => { setDraft(profile); setEditingProfile(true); }}>تعديل بيانات السحب</button></div> : <form className="payout-profile-form" onSubmit={(event) => { event.preventDefault(); void onSaveProfile(draft).then(() => setEditingProfile(false)).catch(() => {}); }}>
        <label>طريقة الاستلام<select value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value as PayoutProfile['method'] })}><option value="bank">حساب مصرفي</option><option value="transfer">حوالة برقم الهاتف</option><option value="cash">نقدًا</option></select></label>
        <label>اسم صاحبة الحساب كاملًا<input value={draft.accountHolder} onChange={(event) => setDraft({ ...draft, accountHolder: event.target.value })} required minLength={3} maxLength={120} /></label>
        {draft.method === 'bank' && <><label>اسم المصرف<input value={draft.bankName} onChange={(event) => setDraft({ ...draft, bankName: event.target.value })} required /></label><label>رقم الحساب أو IBAN<input dir="ltr" value={draft.accountNumber} onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value })} required /></label></>}
        {draft.method === 'transfer' && <label>رقم الحوالة<input dir="ltr" type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} required placeholder="091xxxxxxx" /></label>}
        <label>ملاحظة للاستلام<input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} maxLength={250} placeholder="اختياري" /></label>
        <button className="btn primary" type="submit" disabled={busy}>حفظ بيانات السحب</button>{profile && <button className="btn ghost" type="button" onClick={() => setEditingProfile(false)}>إلغاء</button>}
      </form>}
      <div className="payout-request-bar"><div><small>المتاح للسحب</small><strong>{money(summary.due)}</strong><span>عمولات الطلبات التي سلّمها درب السبيل ولم تُصرف</span></div><button className="btn primary" disabled={busy || !profile || summary.due <= 0 || Boolean(activeRequest)} onClick={() => void onRequestPayout().catch(() => {})}>طلب سحب المستحق</button></div>
      {requests.length > 0 && <div className="payout-history"><h3>طلبات السحب</h3>{requests.map((request) => <div key={request.id}><strong>{money(request.status === 'completed' ? request.paidAmount ?? request.amount : request.amount)}</strong><span>{request.status === 'completed' ? 'تم تسجيل الصرف' : request.status === 'processing' ? 'جارٍ تسجيل الصرف' : request.status === 'cancelled' ? 'ملغي' : 'بانتظار مراجعة المدير'} · {date(request.createdAt)} · {request.orderIds.length} طلبية</span>{request.transferReference && <small>سند الصرف: {request.transferReference}</small>}{request.status === 'pending' && <button className="btn ghost" type="button" disabled={busy} onClick={() => void onCancelPayout(request.id).catch(() => {})}>إلغاء الطلب</button>}</div>)}</div>}
    </section>
    <section className="wallet-ledger"><div className="wallet-section-head"><div><span className="overline">الحركة</span><h2>سجل العمولات</h2></div><span>{ledger.length} طلب</span></div><div className="wallet-filters" role="group" aria-label="تصفية العمولات">{([
      ['all', 'الكل', ledger.length], ['due', 'مستحقة', counts.due], ['paid', 'مصروفة', counts.paid], ['pending', 'بانتظار التسليم', counts.pending],
    ] as const).map(([key, label, count]) => <button type="button" key={key} className={filter === key ? 'selected' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<b>{count}</b></button>)}</div>
      <label className="wallet-search"><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم الزبون أو رقم الطلب" aria-label="بحث في سجل العمولات" /></label>
      <div className="wallet-entries">{visible.length ? visible.map(entry => {
        const state = kind(entry);
        const number = orderNumber({ id: entry.orderId, orderNumber: entry.orderNumber });
        const order = orders.find(item => item.id === entry.orderId);
        return <article className="wallet-entry" key={entry.orderId}><span className={`wallet-entry-icon ${state}`}>{state === 'paid' ? <Check size={19} /> : state === 'due' ? <CreditCard size={19} /> : <Clock3 size={19} />}</span><div className="wallet-entry-main"><div className="wallet-entry-heading"><strong>{entry.customer}</strong><span className={`wallet-entry-state ${state}`}>{state === 'paid' ? 'مصروفة' : state === 'due' ? 'مستحقة' : 'بانتظار التسليم'}</span></div><p>{entry.product}{entry.deletedAt ? ' · سجل مؤرشف' : ''}</p><div className="wallet-entry-meta"><span>طلب <b dir="ltr">{number}</b></span><CopyButton value={number} label="رقم الطلب" compact /><span>{state === 'paid' ? `صُرفت ${date(entry.commissionPaidAt)}` : state === 'due' ? `استحقت ${date(entry.commissionEarnedAt)}` : `سُجّل ${date(entry.createdAt)}`}</span></div></div><div className="wallet-entry-amount"><strong>{money(entry.commissionEarnedAt ? entry.commissionAmount || 15 : 15)}</strong><small>{state === 'pending' ? 'متوقعة' : 'عمولة الطلب'}</small>{order && <button type="button" onClick={() => onOpenOrder(order)} aria-label={`عرض الطلب ${number}`}>التفاصيل <ArrowLeft size={14} /></button>}</div></article>;
      }) : <div className="wallet-empty"><span><Wallet size={28} /></span><h3>{query ? 'لا توجد نتائج' : filter === 'all' ? 'محفظتك جاهزة' : 'لا توجد عمولات في هذا القسم'}</h3><p>{query ? 'جرّب اسمًا أو رقم طلب آخر.' : 'ستظهر العمولات هنا مع تقدم طلباتك.'}</p></div>}</div>
    </section><p className="wallet-note"><ArrowUpLeft size={16} /> «مصروفة» تعني أن المدير سجّل صرف العمولة في ركن. المحفظة تعرض السجل، ولا تنفّذ تحويلًا ماليًا.</p>
  </div>;
}
