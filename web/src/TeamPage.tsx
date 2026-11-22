import { useState } from 'react';
import { Check, LockKeyhole, PackageCheck, Plus, Users, Wallet, X } from 'lucide-react';
import { api, money, type AgentSummary } from './api';

type Props = { agents: AgentSummary[]; busy: boolean; run: <T>(task: () => Promise<T>, success?: string) => Promise<T> };

export default function TeamPage({ agents, busy, run }: Props) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [editing, setEditing] = useState<AgentSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const due = agents.reduce((sum, agent) => sum + agent.due, 0);
  const paid = agents.reduce((sum, agent) => sum + agent.paid, 0);
  const earned = agents.reduce((sum, agent) => sum + agent.earned, 0);

  async function create() {
    try {
      await run(() => api<AgentSummary>('createAgent', { agent: { name, username, password: newPassword } }), 'تم إنشاء حساب المندوبة');
      setName(''); setUsername(''); setNewPassword(''); setNewPasswordConfirm('');
    } catch { /* Error is shown by run. */ }
  }
  async function saveProfile() {
    if (!editing) return;
    try {
      await run(() => api('updateAgentProfile', { id: editing.id, agent: { name: editName, username: editUsername } }), 'تم تحديث حساب المندوبة');
      setEditing(null);
    } catch { /* Error is shown by run. */ }
  }
  async function resetPassword(agent: AgentSummary) {
    try {
      await run(() => api<AgentSummary>('resetAgentPassword', { id: agent.id, password }), 'تم تغيير كلمة المرور');
      setPassword(''); setPasswordConfirm(''); setEditing(null);
    } catch { /* Error is shown by run. */ }
  }
  async function toggle(agent: AgentSummary) {
    try { await run(() => api('setAgentEnabled', { id: agent.id, enabled: !agent.enabled }), agent.enabled ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب'); setEditing(null); }
    catch { /* Error is shown by run. */ }
  }
  async function pay(agent: AgentSummary) {
    if (!window.confirm(`تسجيل صرف ${money(agent.due)} إلى ${agent.name} عن الطلبات المسلّمة؟`)) return;
    try { await run(() => api('payAgentCommissions', { agentId: agent.id }), `تم تسجيل صرف ${money(agent.due)} إلى ${agent.name}`); }
    catch { /* Error is shown by run. */ }
  }
  return <div className="team-page">
    <div className="page-title"><div><span className="overline">فريق العمل</span><h1>الفريق والحسابات</h1><p>كل طلب يُسلّم يمنح المندوبة 15 د.ل. سجل الصرف من هنا.</p></div></div>
    <div className="team-money-grid">
      <div><Users size={20} /><span>المندوبات النشطات</span><strong>{agents.filter(agent => agent.enabled).length}</strong></div>
      <div><PackageCheck size={20} /><span>العمولات المكتسبة</span><strong>{money(earned)}</strong></div>
      <div><Check size={20} /><span>المصروف</span><strong>{money(paid)}</strong></div>
      <div className="highlight"><Wallet size={20} /><span>المتبقي للصرف</span><strong>{money(due)}</strong></div>
    </div>
    <div className="team-layout"><section className="panel team-panel"><div className="panel-head"><div><span className="overline">الحسابات والعمولات</span><h2>المندوبات</h2></div></div>
      {agents.length ? agents.map(agent => <article className="agent-card" key={agent.id}>
        <div className="agent-card-head"><span className="customer-avatar">{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><small dir="ltr">@{agent.username}</small></div><span className={`agent-state ${agent.enabled ? '' : 'disabled'}`}>{agent.enabled ? 'نشطة' : 'موقوفة'}</span></div>
        <div className="agent-stats"><span>الطلبات <b>{agent.assigned}</b></span><span>المسلّمة <b>{agent.delivered}</b></span><span>المكتسب <b>{money(agent.earned)}</b></span><span>المصروف <b>{money(agent.paid)}</b></span><span>المستحق <b>{money(agent.due)}</b></span></div>
        <div className="agent-actions"><button className="btn primary" disabled={busy || agent.due <= 0} onClick={() => void pay(agent)}>تسجيل صرف {money(agent.due)}</button><button className="btn ghost" disabled={busy} onClick={() => { setEditing(agent); setEditName(agent.name); setEditUsername(agent.username); setPassword(''); setPasswordConfirm(''); }}>إدارة الحساب</button></div>
      </article>) : <p className="team-empty">أضف أول مندوبة لتظهر حساباتها وعمولاتها هنا.</p>}
    </section><section className="panel team-panel add-agent"><div className="panel-head"><div><span className="overline">إضافة حساب</span><h2>مندوبة جديدة</h2></div><Plus size={20} /></div><p>اكتب كلمة المرور التي تريدها بنفسك، من 8 أحرف على الأقل.</p>
      <label className="field"><span>الاسم</span><input value={name} onChange={event => setName(event.target.value)} placeholder="اسم المندوبة" /></label>
      <label className="field"><span>اسم الدخول بالإنجليزية</span><input dir="ltr" value={username} onChange={event => setUsername(event.target.value)} placeholder="مثال: saja" autoCapitalize="none" /></label>
      <label className="field"><span>كلمة المرور</span><input dir="ltr" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="8 أحرف أو أكثر" /></label>
      <label className="field"><span>تأكيد كلمة المرور</span><input dir="ltr" type="password" autoComplete="new-password" value={newPasswordConfirm} onChange={event => setNewPasswordConfirm(event.target.value)} placeholder="اكتبها مرة ثانية" /></label>
      <button className="btn primary full" disabled={busy || name.trim().length < 2 || username.trim().length < 3 || newPassword.length < 8 || newPassword !== newPasswordConfirm} onClick={() => void create()}><Plus size={17} /> إضافة مندوبة</button>
    </section></div>
    {editing && <div className="confirm-layer"><section className="confirm-card account-editor" role="dialog" aria-modal="true" aria-label={`إدارة حساب ${editing.name}`}><button className="account-close" aria-label="إغلاق" onClick={() => setEditing(null)}><X size={20} /></button><h3>حساب {editing.name}</h3><p>غيّر بيانات الدخول أو أوقف الحساب عند الحاجة.</p>
      <label className="field"><span>الاسم</span><input value={editName} onChange={event => setEditName(event.target.value)} /></label>
      <label className="field"><span>اسم الدخول</span><input dir="ltr" value={editUsername} onChange={event => setEditUsername(event.target.value)} autoCapitalize="none" /></label>
      <button className="btn primary full" disabled={busy || editName.trim().length < 2 || editUsername.trim().length < 3} onClick={() => void saveProfile()}>حفظ بيانات الحساب</button>
      <div className="account-divider" />
      <label className="field"><span>كلمة المرور الجديدة</span><input dir="ltr" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="اكتب الكلمة التي تريدها" /></label>
      <label className="field"><span>تأكيد كلمة المرور</span><input dir="ltr" type="password" autoComplete="new-password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} placeholder="اكتبها مرة ثانية" /></label>
      <button className="btn ghost full" disabled={busy || password.length < 8 || password !== passwordConfirm} onClick={() => void resetPassword(editing)}><LockKeyhole size={16} /> تغيير كلمة المرور</button>
      <button className="btn ghost full account-toggle" disabled={busy} onClick={() => void toggle(editing)}>{editing.enabled ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button>
    </section></div>}
  </div>;
}
