import { useState } from 'react';
import { Bell, BellOff, Check, CircleAlert, Send, Truck, X } from 'lucide-react';
import type { Actor, AgentSummary, NotificationRecord } from './api';

interface Props {
  items: NotificationRecord[];
  phoneSupported: boolean;
  phoneEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onEnablePhone: () => void;
  onDisablePhone: () => void;
  onOpen: (item: NotificationRecord) => void;
  onRead: (item: NotificationRecord) => void;
  actor: Actor;
  agents: AgentSummary[];
  onSend: (recipient: string, title: string, body: string) => Promise<void>;
}

export default function NotificationsPanel({ items, phoneSupported, phoneEnabled, busy, onClose,
  onEnablePhone, onDisablePhone, onOpen, onRead, actor, agents, onSend }: Props) {
  const unread = items.filter((item) => !item.readAt).length;
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
        <div className="phone-push-card"><div className="phone-push-icon"><Bell size={20} /></div><div><strong>إشعارات الهاتف</strong><p>{phoneEnabled ? 'مفعّلة على هذا الجهاز، وتصل حتى لو ركن مقفول.' : phoneSupported ? 'فعّلها لتصلك الإشعارات حتى لو ركن مقفول.' : 'المتصفح الحالي لا يدعم إشعارات الهاتف؛ الإشعارات داخل ركن تظل متاحة.'}</p></div>{phoneSupported && <button className="btn ghost" disabled={busy} onClick={phoneEnabled ? onDisablePhone : onEnablePhone}>{phoneEnabled ? <><BellOff size={16} /> إيقاف</> : <><Bell size={16} /> تفعيل</>}</button>}</div>
        {actor.role === 'admin' && <form className="notification-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}><h3>إرسال إشعار</h3><p>يظهر داخل ركن، ويصل للهاتف إذا فعّل المستلم الإشعارات عليه.</p><label>المستلم<select value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="all">كل المندوبات</option><option value="team">الجميع، وأنا أيضًا</option><option value="admin">أنا فقط</option>{agents.filter((agent) => agent.enabled).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>العنوان<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: تحديث مهم" required /></label><label>الرسالة<textarea value={body} maxLength={500} rows={3} onChange={(event) => setBody(event.target.value)} placeholder="اكتب نص الإشعار هنا" required /></label><button className="btn primary" type="submit" disabled={busy || sending || !title.trim() || !body.trim()}><Send size={16} /> {sending ? 'جاري الإرسال…' : 'إرسال الإشعار'}</button></form>}
        {items.length ? <div className="notification-list">{items.map((item) => <article key={item.id} className={`notification-item ${item.readAt ? '' : 'unread'}`}><div className="notification-symbol">{item.kind === 'manual' ? <Bell size={17} /> : <Truck size={17} />}</div><div className="notification-content"><div className="notification-title"><strong>{item.title}</strong>{!item.readAt && <i aria-label="غير مقروء" />}</div><p>{item.body}</p><small>{new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.createdAt))}</small><div className="notification-actions">{item.orderId && <button className="btn ghost" disabled={busy} onClick={() => onOpen(item)}>فتح الطلب</button>}{!item.readAt && <button className="btn ghost" disabled={busy} onClick={() => onRead(item)}><Check size={15} /> تم الاطلاع</button>}</div></div></article>)}</div> : <div className="notification-empty"><CircleAlert size={25} /><strong>ما عندكش إشعارات حاليًا</strong><p>إشعارات الطلبات والرسائل الجديدة ستظهر هنا.</p></div>}
      </div>
    </section>
  </div>;
}
