import { useState } from 'react';
import { Bell, BellOff, Check, CircleAlert, MessageCircle, Send, Truck, X } from 'lucide-react';
import type { Actor, AgentSummary, NotificationRecord } from './api';
import CopyButton from './CopyButton';

interface Props {
  items: NotificationRecord[];
  phoneSupported: boolean;
  phoneEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onEnablePhone: () => void;
  onDisablePhone: () => void;
  onTestPhone: () => Promise<void>;
  onOpen: (item: NotificationRecord) => void;
  onRead: (item: NotificationRecord) => void;
  onMarkAll: () => Promise<void>;
  actor: Actor;
  agents: AgentSummary[];
  onSend: (recipient: string, title: string, body: string) => Promise<void>;
}

function NotificationEntry({ item, busy, onOpen, onRead }: { item: NotificationRecord; busy: boolean;
  onOpen: (item: NotificationRecord) => void; onRead: (item: NotificationRecord) => void }) {
  return <article className={`notification-item ${item.readAt ? '' : 'unread'}`}>
    <div className="notification-symbol">{item.kind === 'manual' || item.kind === 'daily_digest' ? <Bell size={17} /> : item.kind === 'sms_alert' ? <MessageCircle size={17} /> : <Truck size={17} />}</div>
    <div className="notification-content"><div className="notification-title"><strong>{item.title}</strong>{!item.readAt && <i aria-label="غير مقروء" />}</div>
      <p>{item.body}</p><small>{new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.createdAt))}</small>
      <div className="notification-actions">{(item.orderId || item.kind === 'daily_digest' || item.kind.startsWith('payout_')) && <button className="btn ghost" disabled={busy} onClick={() => onOpen(item)}>{item.kind === 'daily_digest' ? 'فتح قائمة المتابعة' : item.kind.startsWith('payout_') ? 'فتح المالية' : ['postponed', 'delivery_failed', 'cancelled'].includes(item.kind) ? 'فتح الطلب ومعرفة السبب' : 'فتح الطلب'}</button>}{item.phone && <span className="notification-copy">هاتف {item.phone}<CopyButton value={item.phone} label="رقم الزبون" compact /></span>}{item.shipmentReference && <span className="notification-copy">درب السبيل {item.shipmentReference}<CopyButton value={item.shipmentReference} label="كود درب السبيل" compact /></span>}{!item.readAt && <button className="btn ghost" disabled={busy} onClick={() => onRead(item)}><Check size={15} /> تم الاطلاع</button>}</div>
    </div>
  </article>;
}

export default function NotificationsPanel({ items, phoneSupported, phoneEnabled, busy, onClose,
  onEnablePhone, onDisablePhone, onTestPhone, onOpen, onRead, onMarkAll, actor, agents, onSend }: Props) {
  const unread = items.filter((item) => !item.readAt).length;
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const visible = filter === 'unread' ? items.filter((item) => !item.readAt) : items;
  const fresh = visible.filter((item) => !item.readAt);
  const seen = visible.filter((item) => item.readAt);
  const [recipient, setRecipient] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    if (!title.trim() || !body.trim() || sending) return;
    setSending(true);
    try { await onSend(recipient, title.trim(), body.trim()); setTitle(''); setBody(''); }
    catch { /* The parent displays the server error and keeps this draft. */ }
    finally { setSending(false); }
  }
  return <div className="drawer-layer notifications-layer">
    <button className="drawer-scrim" aria-label="إغلاق الإشعارات" onClick={onClose} />
    <section className="drawer notification-drawer" role="dialog" aria-modal="true" aria-label="إشعارات ركن">
      <div className="drawer-head"><div><span className="overline">تحديثات ركن</span><h2>الإشعارات {unread > 0 && <span className="notification-count">{unread}</span>}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></div>
      <div className="drawer-body">
        <div className="phone-push-card"><div className="phone-push-icon"><Bell size={20} /></div><div><strong>إشعارات الهاتف</strong><p>{phoneEnabled ? 'مفعّلة على هذا الجهاز. اختبر وصولها بعد إغلاق ركن.' : phoneSupported ? 'فعّلها لتصلك الإشعارات حتى لو ركن مقفول. تأكد أيضًا من السماح لإشعارات المتصفح في إعدادات الهاتف.' : 'المتصفح الحالي لا يدعم إشعارات الهاتف؛ الإشعارات داخل ركن تظل متاحة.'}</p>{phoneEnabled && <button className="btn ghost" disabled={busy} onClick={() => void onTestPhone()}><Bell size={15} /> اختبار بعد 15 ثانية</button>}</div>{phoneSupported && <button className="btn ghost" disabled={busy} onClick={phoneEnabled ? onDisablePhone : onEnablePhone}>{phoneEnabled ? <><BellOff size={16} /> إيقاف</> : <><Bell size={16} /> تفعيل</>}</button>}</div>
        {actor.role === 'admin' && <form className="notification-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}><h3>إرسال إشعار</h3><p>يظهر داخل ركن، ويصل للهاتف إذا فعّل المستلم الإشعارات عليه.</p><label>المستلم<select value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="all">كل المندوبات</option><option value="team">الجميع، وأنا أيضًا</option><option value="admin">أنا فقط</option>{agents.filter((agent) => agent.enabled).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>العنوان<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: تحديث مهم" required /></label><label>الرسالة<textarea value={body} maxLength={500} rows={3} onChange={(event) => setBody(event.target.value)} placeholder="اكتب نص الإشعار هنا" required /></label><button className="btn primary" type="submit" disabled={busy || sending || !title.trim() || !body.trim()}><Send size={16} /> {sending ? 'جاري الإرسال…' : 'إرسال الإشعار'}</button></form>}
        <div className="notification-tools"><div className="notification-filters"><button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل ({items.length})</button><button type="button" className={filter === 'unread' ? 'active' : ''} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>غير مقروءة ({unread})</button></div>{unread > 0 && <button type="button" className="notification-mark-all" disabled={busy} onClick={() => void onMarkAll().catch(() => {})}>تحديد الكل كمقروء</button>}</div>
        {visible.length ? <><div className="notification-list">{fresh.length > 0 && <><h3 className="notification-group-title">جديدة</h3>{fresh.map((item) => <NotificationEntry key={item.id} item={item} busy={busy} onOpen={onOpen} onRead={onRead} />)}</>}{seen.length > 0 && <><h3 className="notification-group-title">تم الاطلاع عليها</h3>{seen.map((item) => <NotificationEntry key={item.id} item={item} busy={busy} onOpen={onOpen} onRead={onRead} />)}</>}</div></> : <div className="notification-empty"><CircleAlert size={25} /><strong>{filter === 'unread' ? 'ما عندكش إشعارات غير مقروءة' : 'ما عندكش إشعارات حاليًا'}</strong><p>إشعارات الطلبات وتحديثات التوصيل تظهر هنا.</p></div>}
      </div>
    </section>
  </div>;
}
