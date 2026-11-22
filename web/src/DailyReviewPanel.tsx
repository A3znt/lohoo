import { Check, RefreshCw, Truck } from 'lucide-react';
import { orderNumber, type Order } from './api';
import './daily-review.css';

interface Props {
  orders: Order[];
  reviewedIds: string[];
  date: string;
  busy: boolean;
  onOpen: (order: Order) => void;
  onReview: (id: string) => Promise<void>;
}

export default function DailyReviewPanel({ orders, reviewedIds, date, busy, onOpen, onReview }: Props) {
  const active = orders.filter((order) => order.shipmentReference && !order.carrierDeletedAt &&
    ['confirmed', 'on_way', 'postponed', 'delivery_failed'].includes(order.status));
  const reviewed = new Set(reviewedIds);
  const remaining = active.filter((order) => !reviewed.has(order.id));
  const completed = active.filter((order) => reviewed.has(order.id));
  return <section className="panel daily-review" aria-labelledby="daily-review-title">
    <div className="panel-head"><div><span className="overline">متابعة يومية · {date}</span><h2 id="daily-review-title">فحص شحنات درب السبيل</h2><p>افحص كل شحنة مفتوحة مرة في اليوم. زر الفحص يجلب حالتها من درب السبيل ويسجل مراجعتك.</p></div><span className="daily-review-count">{remaining.length} متبقية</span></div>
    {active.length ? <div className="daily-review-list">
      {[...remaining, ...completed].map((order) => <div className={`daily-review-row ${reviewed.has(order.id) ? 'is-reviewed' : ''}`} key={order.id}>
        <span className="daily-review-icon">{reviewed.has(order.id) ? <Check size={18} /> : <Truck size={18} />}</span>
        <button type="button" className="daily-review-order" onClick={() => onOpen(order)}><strong>#{orderNumber(order)} · {order.customer}</strong><small>شحنة {order.shipmentReference} · {order.darbStatus || 'حالتها غير معروفة'}{order.carrierReason ? ` · ${order.carrierReason}` : ''}</small></button>
        {reviewed.has(order.id) ? <span className="daily-review-done">تم فحصها اليوم</span> : <button type="button" className="btn ghost daily-review-action" disabled={busy} onClick={() => void onReview(order.id)}><RefreshCw size={15} /> فحص الآن</button>}
      </div>)}
    </div> : <div className="daily-review-empty"><Check size={18} /> لا توجد شحنات مفتوحة تحتاج فحصًا اليوم.</div>}
  </section>;
}
