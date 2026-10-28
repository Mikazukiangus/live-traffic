import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { installDom, deferred, settleDom } from './helpers/dom.ts';
import AccountMenu from '../src/features/auth/AccountMenu.tsx';
import { recoveryRootOptions } from '../src/features/app/errorReporting.ts';

test('account UI signs in, changes password and signs out through the actual credential-safe client', async () => {
  const dom = installDom(), previous = globalThis.fetch;
  const user = { id: 'synthetic-user', name: '<img src=x onerror=alert(1)>', email: 'synthetic@example.test' };
  const calls: { route: string; body: any; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const route = String(input); calls.push({ route, body: JSON.parse(String(init!.body)), init: init! });
    return Response.json(route.endsWith('session') ? { authenticated: false } : route.endsWith('sign-in') ? { success: true, user } : { success: true });
  };
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  const click = async (text: string) => { await act(async () => { [...dom.document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!.click(); await settleDom(); }); };
  const submit = async () => { await act(async () => { dom.document.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settleDom(); }); };
  try {
    await act(async () => { root.render(<AccountMenu />); await settleDom(); });
    await act(async () => { dom.document.querySelector<HTMLButtonElement>('[aria-label="Sign in"]')!.click(); });
    (dom.document.querySelector('[name="email"]') as HTMLInputElement).value = user.email;
    (dom.document.querySelector('[name="password"]') as HTMLInputElement).value = 'Synthetic-password-123';
    await submit(); assert.equal(dom.document.querySelector('[role="dialog"]'), null);
    await act(async () => { dom.document.querySelector<HTMLButtonElement>('[aria-label="Your account"]')!.click(); });
    assert.ok(dom.document.body.textContent!.includes(user.name)); assert.equal(dom.document.querySelector('img'), null);
    await click('Change password');
    (dom.document.querySelector('[name="currentPassword"]') as HTMLInputElement).value = 'Synthetic-password-123';
    (dom.document.querySelector('[name="newPassword"]') as HTMLInputElement).value = 'Synthetic-password-new-123';
    await submit(); assert.match(dom.document.querySelector('[role="alert"]')!.textContent!, /Password updated/);
    await submit(); assert.ok(dom.document.querySelector('[aria-label="Sign in"]'));
    assert.deepEqual(calls.map(c => c.route), ['/api/auth/session', '/api/auth/sign-in', '/api/auth/change-password', '/api/auth/sign-out']);
    assert.ok(calls.every(c => c.init.method === 'POST' && c.init.credentials === 'same-origin' && c.init.cache === 'no-store' && c.init.signal instanceof AbortSignal));
    assert.deepEqual(calls[2].body, { currentPassword: 'Synthetic-password-123', newPassword: 'Synthetic-password-new-123' });
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = previous; dom.restore(); }
});

test('account UI obeys server cooldown and Escape aborts pending work without a late sign-in', async () => {
  const dom = installDom(), previous = globalThis.fetch, clock = Date.now;
  let calls = 0, signal: AbortSignal | null = null, now = 1_000_000;
  Date.now = () => now;
  const late = deferred<Response>();
  globalThis.fetch = async (_input, init) => {
    calls++; if (calls === 1) return Response.json({ authenticated: false });
    if (calls === 2) return new Response('synthetic-private-server-response', { status: 429, headers: { 'Retry-After': '12' } });
    signal = init!.signal!; return late.promise;
  };
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  const submit = async () => { await act(async () => { dom.document.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settleDom(); }); };
  try {
    await act(async () => { root.render(<AccountMenu />); await settleDom(); });
    await act(async () => { dom.document.querySelector<HTMLButtonElement>('[aria-label="Sign in"]')!.click(); });
    (dom.document.querySelector('[name="email"]') as HTMLInputElement).value = 'synthetic@example.test';
    (dom.document.querySelector('[name="password"]') as HTMLInputElement).value = 'Synthetic-password-123';
    await submit(); assert.match(dom.document.querySelector('[role="alert"]')!.textContent!, /Too many attempts/);
    assert.ok(!dom.document.body.textContent!.includes('synthetic-private-server-response'));
    await submit(); assert.equal(calls, 2); assert.match(dom.document.querySelector('[role="alert"]')!.textContent!, /Please wait/);
    now += 12_000; await submit(); assert.equal(calls, 3);
    await act(async () => { dom.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settleDom(); });
    assert.equal(signal!.aborted, true); assert.equal(dom.document.querySelector('[role="dialog"]'), null);
    late.resolve(Response.json({ user: { id: 'late', name: 'Late user', email: 'late@example.test' } }));
    await act(async () => { await settleDom(); }); assert.ok(dom.document.querySelector('[aria-label="Sign in"]'));
    assert.equal(dom.document.body.style.overflow, '');
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = previous; Date.now = clock; dom.restore(); }
});
