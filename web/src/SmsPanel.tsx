import { CircleAlert, MessageCircle, RefreshCw } from 'lucide-react';
import type { Order, SmsStatus } from './api';

export function smsFailureText(error?: string) {
  if (error === 'InsufficientCredit') return 'رصيد رِسالة لم يكفِ وقت الإرسال. راجع الشحنة قبل إعادة المحاولة.';
  if (error === 'AccountExpired') return 'اشتراك حساب رِسالة منتهٍ. جدده ثم أعد الإرسال.';
  if (['Unauthorized', 'TokenExpired', 'Forbidden'].includes(error || '')) return 'مفتاح ربط رِسالة يحتاج مراجعة من المدير.';
  if (error === 'InputValidation') return 'رِسالة رفضت بيانات الرسالة. راجع رقم الهاتف والقالب.';
  return error || 'تعذر الإرسال. راجع التفاصيل في رِسالة ثم حاول مجددًا.';
}

type Props = { order: Order; busy: boolean; resalaConfigured: boolean; onAction: (action: string, data: Record<string, unknown>, success: string) => void };
const statusLabel: Record<SmsStatus, string> = {
  pending: 'لم تُرسل', needs_key: 'القالب غير جاهز', sending: 'جاري الإرسال', sent: 'قُبلت للإرسال',
  delivered: 'وصلت للزبون', failed: 'فشل الإرسال', unknown: 'الحالة غير مؤكدة',
};

export default function SmsPanel({ order, busy, resalaConfigured, onAction }: Props) {
  const shipmentReady = Boolean(order.shipmentReference && !order.carrierDeletedAt && order.darbStatus !== 'not_found');
  const rows = [
    { stage: 'confirmation', title: 'رسالة تأكيد الطلب', status: order.confirmationSms, error: order.confirmationSmsError, ready: shipmentReady },
    { stage: 'onWay', title: 'رسالة في الطريق', status: order.onWaySms, error: order.onWaySmsError, ready: shipmentReady && ['on_way', 'delivered'].includes(order.status) },
  ] as const;
  return <div className="sms-panel"><div className="sms-panel-heading"><MessageCircle size={17} /><h4>رسائل الزبون</h4></div>{rows.map((row) => {
    const canSend = row.ready && resalaConfigured && ['pending', 'needs_key', 'failed'].includes(row.status);
    return <div className={`sms-stage sms-stage-${row.status}`} key={row.stage}><div className="sms-stage-head"><strong>{row.title}</strong><span>{statusLabel[row.status]}</span></div>
      {row.status === 'failed' && <p className="sms-stage-error" role="alert"><CircleAlert size={15} />{smsFailureText(row.error)}</p>}
      {row.status === 'unknown' && <p className="sms-stage-error"><CircleAlert size={15} />تحقق من سجل رِسالة قبل الإعادة؛ قد تكون وصلت بالفعل.</p>}
      {row.status === 'pending' && !row.ready && <p className="sms-stage-note">{order.darbStatus === 'not_found' ? 'الشحنة غير موجودة لدى درب السبيل؛ لا يمكن إرسال هذه الرسالة.' : row.stage === 'onWay' ? 'تُرسل بعد خروج الشحنة للتوصيل.' : 'تُرسل بعد إنشاء الشحنة.'}</p>}
      {row.status === 'needs_key' && !resalaConfigured && <p className="sms-stage-note">يلزم تجهيز قالب الرسالة من حساب المدير.</p>}
      {row.status === 'sent' && <p className="sms-stage-note">قبلتها رِسالة، وننتظر تأكيد وصولها للهاتف.</p>}
      {canSend && <button type="button" className="btn ghost sms-retry" disabled={busy} onClick={() => onAction('retryMessage', { stage: row.stage }, '')}><RefreshCw size={15} />{row.status === 'failed' ? 'إعادة إرسال الرسالة' : 'إرسال الرسالة الآن'}</button>}
    </div>;
  })}</div>;
}
