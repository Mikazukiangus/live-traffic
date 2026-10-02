import React, { useState } from 'react';
import { ALTERNATE_MARKERS } from '../data/mockData';
import { GnssMarker } from '../types/traffic';

interface TelemetryBarProps {
  currentMarker: GnssMarker;
  onSelectMarker: (marker: GnssMarker) => void;
  towsOnlineCount: number;
}

export const TelemetryBar: React.FC<TelemetryBarProps> = ({
  currentMarker,
  onSelectMarker,
  towsOnlineCount,
}) => {
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  return (
    <div className="w-full bg-white border-b border-slate-200 px-4 sm:px-6 py-2">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Left: GNSS fix info with interactive pin switcher */}
        <div className="flex items-center gap-3 relative">
          <button
            onClick={() => setShowLocationPicker(!showLocationPicker)}
            className="flex items-center gap-1.5 text-sky-600 font-bold hover:text-sky-700 transition-colors cursor-pointer group"
            title="Click to simulate changing expressway telemetry marker"
          >
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
            <span className="uppercase tracking-wider text-[11px] underline decoration-dotted underline-offset-2">
              Active GNSS Fix
            </span>
            <span className="material-symbols-outlined text-sm group-hover:translate-y-0.5 transition-transform">
              arrow_drop_down
            </span>
          </button>

          <span className="text-slate-500 font-mono text-[12px] hidden sm:inline">
            {currentMarker.lat.toFixed(4)}° N, {currentMarker.lng.toFixed(4)}° E • HDOP 0.8 • Satellites: 18
          </span>

          {/* Quick Location Switcher Dropdown */}
          {showLocationPicker && (
            <div className="absolute top-7 left-0 z-40 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-2.5 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                Simulate Telemetry Pinned Location
              </div>
              {ALTERNATE_MARKERS.map((loc, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    onSelectMarker(loc);
                    setShowLocationPicker(false);
                  }}
                  className={`text-left p-2 rounded text-xs transition-colors flex flex-col gap-0.5 ${
                    currentMarker.marker === loc.marker
                      ? 'bg-sky-50 border border-sky-200 text-sky-900 font-semibold'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{loc.corridor} Sector</span>
                    <span className="text-[10px] text-slate-400 font-mono">{loc.lat}° N</span>
                  </div>
                  <span className="text-[11px] text-slate-500 line-clamp-1">{loc.marker}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: EMAS net status & tows online */}
        <div className="flex items-center gap-4 text-slate-500">
          <div className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm text-emerald-600">
              check_circle
            </span>
            <span className="text-[11px] text-emerald-700 font-bold">
              EMAS Expressway Incident Net: ACTIVE
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <span className="material-symbols-outlined text-sm text-amber-600">
              local_shipping
            </span>
            <span className="text-[11px] text-amber-700 font-semibold">
              {towsOnlineCount} Heavy &amp; Flatbed Tows Online
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
