import React, { useState } from 'react';
import { ALTERNATE_MARKERS } from '../data/mockData';
import { GnssMarker } from '../types/traffic';
import { IncidentFeed } from '../utils/ltaIncidents';

interface TelemetryBarProps {
  currentMarker: GnssMarker;
  onSelectMarker: (marker: GnssMarker) => void;
  incidentFeed: IncidentFeed;
  // Live LTA speed text for the pickup expressway, e.g. "64 km/h • Smooth"
  pickupSpeedText: string;
}

export const TelemetryBar: React.FC<TelemetryBarProps> = ({
  currentMarker,
  onSelectMarker,
  incidentFeed,
  pickupSpeedText,
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
            title="Choose a demo pickup location"
          >
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
            <span className="uppercase tracking-wider text-[11px] underline decoration-dotted underline-offset-2">
              Pickup Location (demo)
            </span>
            <span className="material-symbols-outlined text-sm group-hover:translate-y-0.5 transition-transform">
              arrow_drop_down
            </span>
          </button>

          <span className="text-slate-500 font-mono text-[12px] hidden sm:inline">
            {currentMarker.lat.toFixed(4)}° N, {currentMarker.lng.toFixed(4)}° E • {currentMarker.corridor}
          </span>

          {/* Quick Location Switcher Dropdown */}
          {showLocationPicker && (
            <div className="absolute top-7 left-0 z-40 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-2.5 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                Choose Demo Pickup Location
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

        {/* Right: live LTA incident feed status and pickup expressway speed */}
        <div className="flex items-center gap-4 text-slate-500">
          <div className="flex items-center gap-1">
            <span
              className={`material-symbols-outlined text-sm ${
                incidentFeed.status === 'live' ? 'text-emerald-600' : incidentFeed.status === 'error' ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {incidentFeed.status === 'error' ? 'warning' : 'check_circle'}
            </span>
            <span
              className={`text-[11px] font-bold ${
                incidentFeed.status === 'live' ? 'text-emerald-700' : incidentFeed.status === 'error' ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              {incidentFeed.status === 'loading'
                ? 'LTA incident feed: loading'
                : incidentFeed.status === 'error'
                ? 'LTA incident feed: unavailable'
                : `LTA incident feed: live • ${incidentFeed.incidents.length} active`}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <span className="material-symbols-outlined text-sm text-sky-600">speed</span>
            <span className="text-[11px] text-slate-700 font-semibold">
              {currentMarker.corridor} (LTA): {pickupSpeedText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
