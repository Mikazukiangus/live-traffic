// Development-only synthetic fixture. No App, providers, real accounts, permissions or user storage.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { recoveryRootOptions } from '../../src/features/app/errorReporting';
import { installBrowserErrorTracking, showSafeErrorNotice } from '../../src/features/app/browserErrorTracking';
import '../../src/index.css';

installBrowserErrorTracking(window, { notice: showSafeErrorNotice });
const marker = 'synthetic-private-tracking-fixture';
function Broken(): React.ReactNode { throw new TypeError(marker); }
function Fixture() {
  const [broken, setBroken] = useState(false);
  return <main className="mx-auto max-w-xl p-6 text-slate-900">
    <h1 className="text-xl font-bold">Error tracking fixture</h1>
    <p className="my-4">Synthetic errors only. Reports go to the local sanitized ingestion endpoint.</p>
    <div className="flex flex-wrap gap-3">
      <button className="min-h-11 rounded border px-4" onClick={() => setBroken(true)}>Trigger page error</button>
      <button className="min-h-11 rounded border px-4" onClick={() => { void Promise.reject(new TypeError(marker)); }}>Trigger promise error</button>
      <button className="min-h-11 rounded border px-4" onClick={() => { setTimeout(() => { throw new RangeError(marker); }, 0); }}>Trigger window error</button>
    </div>
    <ErrorBoundary scope="page">{broken ? <Broken /> : <p className="mt-5">Healthy page</p>}</ErrorBoundary>
  </main>;
}
createRoot(document.getElementById('root')!, recoveryRootOptions).render(<ErrorBoundary scope="app"><Fixture /></ErrorBoundary>);
