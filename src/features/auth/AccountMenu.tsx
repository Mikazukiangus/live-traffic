import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AccountError, accountRequest, accountUser, type AccountUser } from './authClient';

export default function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const readyAt = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void accountRequest('session', undefined, controller.signal).then((data) => {
      if (typeof data.authenticated !== 'boolean') throw new AccountError(503);
      setUser(data.authenticated ? accountUser(data.user) : null);
    }).catch(() => { if (!controller.signal.aborted) setMessage('Unable to check your account. You can try signing in again.'); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { active.current?.abort(); setOpen(false); setPending(false); }
      if (event.key !== 'Tab') return;
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])];
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open, passwordMode]);

  const close = () => { active.current?.abort(); setOpen(false); setPending(false); setMessage(''); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (Date.now() < readyAt.current) { setMessage('Please wait before trying again.'); return; }
    const form = event.currentTarget;
    const fields = new FormData(form);
    const controller = new AbortController(); active.current = controller;
    setPending(true); setMessage('');
    try {
      if (!user) {
        const data = await accountRequest('sign-in', { email: String(fields.get('email') ?? ''), password: String(fields.get('password') ?? '') }, controller.signal);
        setUser(accountUser(data.user)); form.reset(); setOpen(false);
      } else if (passwordMode) {
        await accountRequest('change-password', { currentPassword: String(fields.get('currentPassword') ?? ''), newPassword: String(fields.get('newPassword') ?? '') }, controller.signal);
        form.reset(); setPasswordMode(false); setMessage('Password updated. Other sessions have been signed out.');
      } else {
        await accountRequest('sign-out', {}, controller.signal);
        setUser(null); setOpen(false);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof AccountError && error.retryAfter) readyAt.current = Date.now() + error.retryAfter * 1000;
        setMessage(error instanceof AccountError ? error.message : 'Unable to connect. Please try again.');
      }
    } finally { if (!controller.signal.aborted) setPending(false); }
  };
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900';
  return <>
    <button type="button" onClick={() => { setMessage(''); setPasswordMode(false); setOpen(true); }} aria-label={user ? 'Your account' : 'Sign in'}
      className="min-h-11 min-w-11 rounded-lg px-2 sm:px-3 text-xs font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 flex items-center justify-center gap-1">
      <span className="material-symbols-outlined text-xl" aria-hidden="true">account_circle</span><span className="hidden sm:inline">{user ? 'Account' : 'Sign in'}</span>
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="account-title" className="w-full max-w-sm rounded-2xl bg-white text-slate-900 shadow-xl p-5 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4"><h2 id="account-title" className="text-lg font-bold">{user ? passwordMode ? 'Change password' : 'Your account' : 'Sign in'}</h2>
          <button type="button" onClick={close} className="min-h-11 min-w-11 rounded-lg hover:bg-slate-100" aria-label="Close account dialog">×</button></div>
        {user && !passwordMode && <div className="mb-4"><p className="font-semibold break-words">{user.name}</p><p className="text-sm text-slate-600 break-words">{user.email}</p>
          <p className="text-xs text-slate-500 mt-3">Saved commutes stay on this device.</p></div>}
        {!user && <p className="text-sm text-slate-600 mb-4">Traffic is public. Sign in with an account provided by your administrator.</p>}
        <form onSubmit={submit} className="space-y-3">
          {!user && <><label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="username" maxLength={254} required className={input} disabled={pending}/></label>
            <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete="current-password" maxLength={128} required className={input} disabled={pending}/></label></>}
          {user && passwordMode && <><label className="block text-sm font-medium">Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required className={input} disabled={pending}/></label>
            <label className="block text-sm font-medium">New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={input} disabled={pending}/></label>
            <p className="text-xs text-slate-500">Use at least 12 characters.</p></>}
          {message && <p role="alert" className="text-sm text-slate-700">{message}</p>}
          <button type="submit" disabled={pending} className="w-full min-h-11 rounded-lg bg-sky-600 text-white font-semibold disabled:opacity-50">{pending ? 'Please wait…' : !user ? 'Sign in' : passwordMode ? 'Update password' : 'Sign out'}</button>
          {user && <button type="button" disabled={pending} onClick={() => { setPasswordMode(!passwordMode); setMessage(''); }} className="w-full min-h-11 rounded-lg text-sky-700 hover:bg-sky-50">{passwordMode ? 'Back to account' : 'Change password'}</button>}
        </form>
      </div>
    </div>, document.body)}
  </>;
}
