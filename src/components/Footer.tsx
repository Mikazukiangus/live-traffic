import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-white border-t border-slate-200 py-6 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Brand & copyright */}
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-sky-600 font-sans tracking-tight">
            TrafficPulse
          </span>
          <span className="text-xs text-slate-500">
            © 2025 Smart Mobility Authority. All rights reserved.
          </span>
        </div>

        {/* Right: Telemetry sync & emergency callout */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>LTA Datamall v2.0 • Synced 4s ago</span>
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
