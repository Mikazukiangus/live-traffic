import React, { useState, useEffect } from 'react';
import { ActiveDispatch } from '../types/traffic';

interface ActiveDispatchTrackerProps {
  dispatch: ActiveDispatch;
  onCancel: () => void;
  onCallDriver: (phone: string, name: string) => void;
}

export const ActiveDispatchTracker: React.FC<ActiveDispatchTrackerProps> = ({
  dispatch,
  onCancel,
  onCallDriver,
}) => {
  const [eta, setEta] = useState(dispatch.etaMins);
  const [distance, setDistance] = useState(1.4);

  // Simulated ETA tick down every 20 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setEta((prev) => {
        if (prev > 1) {
          setDistance((d) => Math.max(0.1, +(d - 0.2).toFixed(1)));
          return prev - 1;
        }
        return 1;
      });
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full bg-gradient-to-r from-emerald-900 to-slate-900 text-white rounded-xl p-4 sm:p-5 shadow-lg border border-emerald-500/30 flex flex-col gap-3 relative overflow-hidden animate-in slide-in-from-top-4 duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-800/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></div>
          <div>
            <div className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider">
              Live Recovery Dispatch Active
            </div>
            <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <span>{dispatch.unitCode}</span>
              <span className="text-slate-300 font-normal text-xs sm:text-sm">
                ({dispatch.truckPlate})
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px] font-mono border border-emerald-500/30">
                Ticket #{dispatch.id}
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase block font-semibold">
              Live Responder ETA
            </span>
            <span className="text-xl sm:text-2xl font-mono font-extrabold text-emerald-400">
              {eta} MINS
            </span>
          </div>
          <div className="h-8 w-px bg-slate-700 hidden sm:block"></div>
          <div className="text-right hidden sm:block">
            <span className="text-[10px] text-slate-400 uppercase block font-semibold">
              Distance
            </span>
            <span className="text-lg font-mono font-bold text-white">{distance} km</span>
          </div>
        </div>
      </div>

      {/* Stepper Status */}
      <div className="grid grid-cols-4 gap-2 pt-1 text-xs">
        <div className="flex flex-col gap-1 text-emerald-300">
          <div className="h-1.5 rounded-full bg-emerald-400"></div>
          <span className="font-semibold text-[11px]">1. Pinned &amp; Dispatched</span>
        </div>
        <div className="flex flex-col gap-1 text-emerald-300">
          <div className="h-1.5 rounded-full bg-emerald-400"></div>
          <span className="font-semibold text-[11px]">2. Unit Assigned</span>
        </div>
        <div className="flex flex-col gap-1 text-emerald-300">
          <div className="h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
          <span className="font-semibold text-[11px]">3. En Route ({distance}km)</span>
        </div>
        <div className="flex flex-col gap-1 text-slate-500">
          <div className="h-1.5 rounded-full bg-slate-700"></div>
          <span className="font-semibold text-[11px]">4. On Scene Extrication</span>
        </div>
      </div>

      {/* Driver and action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-emerald-900/60 text-xs">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-slate-400 text-sm">badge</span>
          <span>
            Responder: <strong className="text-white">{dispatch.driverName}</strong> • Plate:{' '}
            <strong className="text-white font-mono">{dispatch.vehiclePlate}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onCallDriver(dispatch.driverPhone, dispatch.driverName)}
            type="button"
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-semibold text-xs transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-sm">call</span>
            <span>Call Driver ({dispatch.driverPhone})</span>
          </button>
          <button
            onClick={onCancel}
            type="button"
            className="fixed-palette px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel Dispatch
          </button>
        </div>
      </div>
    </div>
  );
};
