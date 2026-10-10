import React from 'react';
import { StaleFeed } from '../utils/freshness';

interface StaleDataNoticeProps {
  feeds: StaleFeed[];
  online: boolean;
  compact?: boolean;
}

/** Says plainly which live feeds are behind, instead of showing old numbers as if current. */
export const StaleDataNotice: React.FC<StaleDataNoticeProps> = ({ feeds, online, compact = false }) => {
  if (online && feeds.length === 0) return null;
  if (compact) return (
    <details className="rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm text-amber-900">
      <summary className="min-h-11 flex items-center gap-2 cursor-pointer font-semibold">
        <span className="material-symbols-outlined text-lg" aria-hidden="true">{online ? 'history' : 'wifi_off'}</span>
        <span>{online ? `Delayed or unavailable: ${feeds.map((f) => f.label).join(', ')}` : 'Offline · showing saved data'}</span>
        <span className="material-symbols-outlined text-lg ml-auto shrink-0" aria-hidden="true">expand_more</span>
      </summary>
      <ul className="pb-3 pl-7 space-y-1 text-amber-800">
        {feeds.map((f) => <li key={f.label}><span className="font-semibold">{f.label}:</span> {f.detail}</li>)}
      </ul>
    </details>
  );
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-3">
      <span className="material-symbols-outlined text-amber-600 shrink-0">{online ? 'history' : 'wifi_off'}</span>
      <div className="flex flex-col gap-1">
        <span className="font-semibold">
          {online ? 'Some live data is out of date' : "You're offline. Showing the last data received."}
        </span>
        {feeds.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-amber-800">
            {feeds.map((f) => (
              <li key={f.label}>
                <span className="font-semibold">{f.label}:</span> {f.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
