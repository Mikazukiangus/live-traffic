import React, { useEffect } from 'react';
import { refreshApiHealth, useApiHealth } from '../utils/apiHealth';

interface FooterProps {
  onOpenApiHealth: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenApiHealth }) => {
  const { data: health, error: healthError, loading } = useApiHealth();
  useEffect(() => {
    refreshApiHealth();
    const timer = setInterval(refreshApiHealth, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

  const allUp = !loading && !!health && health.upCount === health.totalCount;
  const badgeTone = healthError
    ? 'text-red-700 bg-red-100'
    : loading || !health
      ? 'text-slate-600 bg-slate-100'
      : allUp
        ? 'text-emerald-700 bg-emerald-100'
        : 'text-amber-700 bg-amber-100';
  const dotTone = healthError ? 'bg-red-500' : loading || !health ? 'bg-slate-400' : allUp ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <footer className="w-full bg-white border-t border-slate-200 py-6 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Brand, copyright & data sources */}
        <div className="flex flex-col items-center md:items-start gap-0.5 text-center md:text-left">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-sky-600 font-sans tracking-tight">TrafficPulse</span>
            <span className="text-xs text-slate-500">© 2026 TrafficPulse</span>
          </div>
          <span className="text-[11px] text-slate-500">
            Data: LTA DataMall, NEA and PUB via data.gov.sg. Not an official LTA service.
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
              {loading ? 'CHECKING' : healthError ? 'UNREACHABLE' : health ? `${health.upCount}/${health.totalCount} UP` : 'CHECKING'}
            </span>
          </button>

          {/* Real numbers: 999 police, 995 ambulance & fire, LTA's hotline (1800 2255 582, "1800-CALL-LTA") */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-slate-500 font-semibold uppercase tracking-wider">Emergency</span>
            <a href="tel:999" className="text-red-700 font-bold hover:underline">999 Police</a>
            <a href="tel:995" className="text-red-700 font-bold hover:underline">995 Ambulance &amp; Fire</a>
            <a href="tel:18002255582" className="text-slate-700 font-semibold hover:underline" title="LTA hotline, 1800-CALL-LTA">
              LTA 1800 2255 582
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
