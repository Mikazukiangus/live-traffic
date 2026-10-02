import React, { useState } from 'react';

interface SosHeaderBannerProps {
  locationMarker: string;
  isBroadcasting: boolean;
  onToggleBroadcast: () => void;
  onCallHotline: (phone: string, title: string) => void;
  assignedUnitPlate?: string;
}

export const SosHeaderBanner: React.FC<SosHeaderBannerProps> = ({
  locationMarker,
  isBroadcasting,
  onToggleBroadcast,
  onCallHotline,
  assignedUnitPlate = 'XD 4921 B',
}) => {
  const [alertDismissed, setAlertDismissed] = useState(false);

  return (
    <div className="w-full relative overflow-hidden rounded-xl bg-gradient-to-r from-red-50/90 via-white to-rose-50/70 border border-red-200 shadow-md">
      {/* Warning Left Red Strip & Background Glow */}
      <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-red-600"></div>
      <div className="absolute -right-20 -top-20 w-96 h-96 rounded-full bg-red-100/50 blur-3xl pointer-events-none"></div>

      <div className="p-4 sm:p-6 lg:p-7 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5 relative z-10 pl-6 sm:pl-8">
        {/* Telemetry Data & Incident Status */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <span className="material-symbols-outlined text-sm">e911_emergency</span>
              Rapid Response Dispatch • Priority L1
            </span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
              Avg ETA: 15–25 Mins
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
              LTA Recovery Corridor
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-xl sm:text-2xl lg:text-[26px] text-slate-900 font-extrabold tracking-tight leading-snug">
              Expressway Incident Dispatch &amp; Accredited Workshop Network
            </h1>
            <div className="flex items-start sm:items-center gap-1.5 text-slate-600 text-xs sm:text-sm">
              <span className="material-symbols-outlined text-sky-600 text-base shrink-0 mt-0.5 sm:mt-0">
                pin_drop
              </span>
              <span>Highway Telemetry Marker:</span>
              <span className="text-slate-900 font-bold font-mono break-all sm:break-normal">
                {locationMarker}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              LTA EMAS Expressway Towing: Subsidized to nearest designated bay
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-600 shrink-0"></span>
              CASETrust &amp; IDAC Accredited Hubs
            </span>
          </div>
        </div>

        {/* Primary Action CTAs */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 w-full xl:w-auto">
          <button
            onClick={onToggleBroadcast}
            type="button"
            className={`group relative px-5 py-3.5 rounded-lg text-white text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer font-bold ${
              isBroadcasting
                ? 'bg-emerald-700 hover:bg-emerald-800 ring-4 ring-emerald-200'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            <span
              className={`material-symbols-outlined text-lg ${
                isBroadcasting ? 'animate-spin' : 'group-hover:scale-110 transition-transform'
              }`}
            >
              {isBroadcasting ? 'sync' : 'sensors'}
            </span>
            <span className="text-center">
              {isBroadcasting
                ? 'GPS Broadcast Active (Signal Transmitting)'
                : 'Broadcast GPS to EMAS & Tow Trucks'}
            </span>
          </button>

          <button
            onClick={() => onCallHotline('18002255582', 'EMAS Hotline (1800-225-5582)')}
            className="px-4 py-3.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shadow-xs cursor-pointer font-bold"
          >
            <span className="material-symbols-outlined text-red-600 text-lg">phone_in_talk</span>
            <span>EMAS Hotline: 1800-225-5582</span>
          </button>
        </div>
      </div>

      {/* Live Broadcast Confirmation Banner */}
      {isBroadcasting && !alertDismissed && (
        <div className="bg-red-600 px-4 sm:px-6 py-2.5 text-white text-xs sm:text-sm flex items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base animate-spin shrink-0">sync</span>
            <span>
              Emergency telemetry sent to LTA EMAS Operation Center • Nearest flatbed assigned (Plate:{' '}
              <strong className="underline decoration-dotted">{assignedUnitPlate}</strong>, 6 min away)
            </span>
          </div>
          <button
            onClick={() => setAlertDismissed(true)}
            className="text-white hover:underline uppercase font-bold text-[11px] shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
