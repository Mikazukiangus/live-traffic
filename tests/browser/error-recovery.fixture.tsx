// Isolated browser fixture: no real providers, permissions, notifications or storage.
import React, { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { recoveryRootOptions } from '../../src/features/app/errorReporting';
import '../../src/index.css';
const marker = 'synthetic-private-fixture-marker';
let logs = 0, leaked = false;
console.error = (...args: unknown[]) => {
  logs++;
  leaked ||= args.some(arg => String(arg).includes(marker));
  document.getElementById('audit')!.textContent = `Sanitized logs: ${logs}. Raw details leaked: ${leaked}`;
};
function Broken() { throw new Error(marker); return null; }
const BrokenLazy = lazy(async () => { throw new Error(marker); return { default: Broken }; });
function Fixture() {
  const [tab, setTab] = useState('healthy');
  const [rootCrash, setRootCrash] = useState(false);
  if (rootCrash) return <Broken />;
  return <>
    <nav aria-label="Test navigation" className="flex flex-wrap gap-4 p-4">
      <button onClick={() => setTab('healthy')}>Healthy tab</button>
      <button onClick={() => setTab('broken')}>Broken tab</button>
      <button onClick={() => setTab('lazy')}>Lazy error tab</button>
      <button onClick={() => setRootCrash(true)}>Crash app</button>
    </nav>
    <ErrorBoundary key={tab} scope="page"><Suspense fallback={<p>Loading test view</p>}>
      {tab === 'broken' ? <Broken /> : tab === 'lazy' ? <BrokenLazy /> : <p>Healthy view is available</p>}
    </Suspense></ErrorBoundary>
  </>;
}
createRoot(document.getElementById('root')!, recoveryRootOptions).render(<ErrorBoundary scope="app"><Fixture /></ErrorBoundary>);
