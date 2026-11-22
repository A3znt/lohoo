import { Bell, BellOff, Check, CircleAlert, Truck, X } from 'lucide-react';
import type { NotificationRecord } from './api';

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
}

export default function NotificationsPanel({ items, phoneSupported, phoneEnabled, busy, onClose,
  onEnablePhone, onDisablePhone, onOpen, onRead }: Props) {
  const unread = items.filter((item) => !item.readAt).length;
  return <div className="drawer-layer notifications-layer">
    <button className="drawer-scrim" aria-label="إغلاق الإشعارات" onClick={onClose} />
    <section className="drawer notification-drawer" role="dialog" aria-modal="true" aria-label="إشعارات ركن">
      <div className="drawer-head"><div><span className="overline">تحديثات طلباتك</span><h2>الإشعارات {unread > 0 && <span className="notification-count">{unread}</span>}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></div>
      <div className="drawer-body">
        <div className="phone-push-card"><div className="phone-push-icon"><Bell size={20} /></div><div><strong>إشعارات الهاتف</strong><p>{phoneEnabled ? 'مفعّلة على هذا الجهاز، وتصل حتى لو ركن مقفول.' : phoneSupported ? 'فعّليها باش توصلك تحديثات الطلبات حتى لو ركن مقفول.' : 'المتصفح الحالي لا يدعم إشعارات الهاتف؛ الإشعارات داخل ركن تظل متاحة.'}</p></div>{phoneSupported && <button className="btn ghost" disabled={busy} onClick={phoneEnabled ? onDisablePhone : onEnablePhone}>{phoneEnabled ? <><BellOff size={16} /> إيقاف</> : <><Bell size={16} /> تفعيل</>}</button>}</div>
        {items.length ? <div className="notification-list">{items.map((item) => <article key={item.id} className={`notification-item ${item.readAt ? '' : 'unread'}`}><div className="notification-symbol"><Truck size={17} /></div><div className="notification-content"><div className="notification-title"><strong>{item.title}</strong>{!item.readAt && <i aria-label="غير مقروء" />}</div><p>{item.body}</p><small>{new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.createdAt))}</small><div className="notification-actions"><button className="btn ghost" disabled={busy} onClick={() => onOpen(item)}>فتح الطلب</button>{!item.readAt && <button className="btn ghost" disabled={busy} onClick={() => onRead(item)}><Check size={15} /> تم الاطلاع</button>}</div></div></article>)}</div> : <div className="notification-empty"><CircleAlert size={25} /><strong>ما عندكش إشعارات حاليًا</strong><p>تحديثات التأجيل وتعذّر التوصيل والإلغاء ستظهر هنا.</p></div>}
      </div>
    </section>
  </div>;
}
