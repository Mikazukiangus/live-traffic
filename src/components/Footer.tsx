import React, { useEffect, useState } from 'react';

interface FooterProps {
  onOpenApiHealth: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenApiHealth }) => {
  const [health, setHealth] = useState<{ upCount: number; totalCount: number } | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setHealth({ upCount: data.upCount, totalCount: data.totalCount }))
      .catch(() => setHealthError(true));
  }, []);

  const allUp = !!health && health.upCount === health.totalCount;
  const badgeTone = healthError
    ? 'text-red-700 bg-red-100'
    : !health
      ? 'text-slate-600 bg-slate-100'
      : allUp
        ? 'text-emerald-700 bg-emerald-100'
        : 'text-amber-700 bg-amber-100';
  const dotTone = healthError ? 'bg-red-500' : !health ? 'bg-slate-400' : allUp ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <footer className="w-full bg-white border-t border-slate-200 py-6 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Brand & copyright */}
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-sky-600 font-sans tracking-tight">
            TrafficPulse
          </span>
          <span className="text-xs text-slate-500">
            © 2026 Smart Mobility Authority. All rights reserved.
          </span>
        </div>

        {/* Center/Right: API Health Summary link, Telemetry sync & emergency callout */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/* API Health Summary Trigger Button */}
          <button
            onClick={onOpenApiHealth}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer border border-slate-200 shadow-2xs hover:border-slate-300"
            title="View comprehensive API Health & Gateway Diagnostic Summary"
          >
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotTone}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${dotTone}`}></span>
            </span>
            <span className="material-symbols-outlined text-xs text-sky-600">monitor_heart</span>
            <span className="font-mono text-[11px]">API Health Summary</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded font-mono ${badgeTone}`}>
              {healthError ? 'UNREACHABLE' : health ? `${health.upCount}/${health.totalCount} UP` : 'CHECKING'}
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>LTA DataMall v2.0 • Live Stream</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="tel:18002255582"
              className="text-xs text-red-600 font-bold uppercase tracking-wider hover:underline"
            >
              Emergency: 1800-CALL-LTA
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
