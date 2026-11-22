import { useState, type FormEvent } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from './api';

type Props = { busy: boolean; run: <T>(task: () => Promise<T>, success?: string) => Promise<T> };

export default function AgentSettingsPage({ busy, run }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const valid = currentPassword.length > 0 && newPassword.length >= 8 && newPassword.length <= 128 && newPassword === confirmation && newPassword !== currentPassword;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    try {
      await run(() => api('changeMyPassword', { currentPassword, newPassword }), 'تم تغيير كلمة المرور. استخدمي الجديدة في دخولك القادم.');
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
    } catch { /* Error is shown by run. */ }
  }

  return <div className="agent-settings-page">
    <div className="page-title"><div><span className="overline">حسابي</span><h1>إعدادات الحساب</h1><p>غيّري كلمة المرور من هنا وقت ما تبي.</p></div></div>
    <form className="panel agent-password-panel" onSubmit={event => void submit(event)}>
      <div className="account-heading"><span className="account-heading-icon"><LockKeyhole size={23} /></span><div><h2>تغيير كلمة المرور</h2><p>أدخلي كلمتك الحالية، ثم اختاري كلمة جديدة من 8 أحرف على الأقل.</p></div></div>
      <label className="field"><span>كلمة المرور الحالية</span><input dir="ltr" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
      <label className="field"><span>كلمة المرور الجديدة</span><input dir="ltr" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
      <label className="field"><span>تأكيد الكلمة الجديدة</span><input dir="ltr" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
      {confirmation && confirmation !== newPassword && <p className="password-hint" role="status">الكلمتان غير متطابقتين.</p>}
      <button className="btn primary full" type="submit" disabled={busy || !valid}>حفظ كلمة المرور الجديدة</button>
      <p className="password-security"><ShieldCheck size={16} /> بعد الحفظ، تنتهي صلاحية أي جلسة قديمة على أجهزة أخرى.</p>
    </form>
  </div>;
}
