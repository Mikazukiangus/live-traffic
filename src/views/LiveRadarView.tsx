import React, { useState } from 'react';
import { EXPRESSWAY_CORRIDORS, INCIDENT_ALERTS, TOW_FLEET_UNITS } from '../data/mockData';
import { ExpresswayCorridor } from '../types/traffic';

interface LiveRadarViewProps {
  onSwitchToSos: (corridorCode: string) => void;
  onCallHotline: (phone: string, title: string) => void;
}

export const LiveRadarView: React.FC<LiveRadarViewProps> = ({
  onSwitchToSos,
  onCallHotline,
}) => {
  const [selectedCorridor, setSelectedCorridor] = useState<ExpresswayCorridor>(
    EXPRESSWAY_CORRIDORS[0]
  );
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning'>('all');

  const filteredIncidents = INCIDENT_ALERTS.filter((inc) => {
    if (filterSeverity === 'all') return true;
    if (filterSeverity === 'critical') return inc.severity === 'Critical';
    if (filterSeverity === 'warning') return inc.severity === 'Warning';
    return true;
  });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
              LTA EMAS Telemetry Grid
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            Singapore Expressway Radar &amp; Traffic Health
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time average expressway speed sensors, congestion heatmaps, and active dispatch units.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onCallHotline('18002255582', 'EMAS Operation Center')}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">emergency</span>
            <span>Report Road Hazard</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Expressway Corridors Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {EXPRESSWAY_CORRIDORS.map((corridor) => {
          const isCongested = corridor.status === 'Congested';
          const isHeavy = corridor.status === 'Heavy';
          const isModerate = corridor.status === 'Moderate';
          const isSmooth = corridor.status === 'Smooth';

          const getStatusBadge = () => {
            if (isCongested) return 'bg-red-100 text-red-700 border-red-200';
            if (isHeavy) return 'bg-amber-100 text-amber-800 border-amber-200';
            if (isModerate) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            return 'bg-emerald-100 text-emerald-800 border-emerald-200';
          };

          const isSelected = selectedCorridor.code === corridor.code;

          return (
            <div
              key={corridor.code}
              onClick={() => setSelectedCorridor(corridor)}
              className={`p-4 rounded-xl border bg-white cursor-pointer transition-all shadow-xs flex flex-col justify-between gap-3 ${
                isSelected
                  ? 'border-sky-500 ring-2 ring-sky-500/20 shadow-md'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold text-slate-900 font-mono">
                      {corridor.code}
                    </span>
                    <span className="text-xs text-slate-500 line-clamp-1">{corridor.name}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getStatusBadge()}`}
                  >
                    {corridor.status}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 mt-1">{corridor.fromTo}</div>
              </div>

              {/* Speed Meter Bar */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Avg Speed</span>
                  <span className="font-mono font-bold text-slate-900">
                    {corridor.speedKmH} km/h{' '}
                    <span className="text-slate-400 font-normal">/ {corridor.speedLimit} max</span>
                  </span>
                </div>

                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isCongested
                        ? 'bg-red-500'
                        : isHeavy
                        ? 'bg-amber-500'
                        : isModerate
                        ? 'bg-yellow-400'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (corridor.speedKmH / corridor.speedLimit) * 100)}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>Travel Time: ~{corridor.travelTimeMins} mins</span>
                  <span className="font-semibold text-sky-600">
                    {corridor.towsOnline} tows patrolling
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
                <span className="text-[11px] text-slate-400">
                  {corridor.incidentsCount} active incidents
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSwitchToSos(corridor.code);
                  }}
                  className="text-sky-600 hover:text-sky-700 font-bold flex items-center gap-0.5 text-xs"
                >
                  <span>Dispatch Here</span>
                  <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Corridor Live Radar Deep-Dive & Incidents Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Map visual & Radar Tracking Details */}
        <div className="lg:col-span-7 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">
                Telemetry Focus
              </span>
              <h3 className="text-lg font-bold text-slate-900">
                {selectedCorridor.name} ({selectedCorridor.code}) Sector View
              </h3>
            </div>
            <span className="text-xs font-mono text-emerald-600 font-semibold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
              Flow: {selectedCorridor.speedKmH} km/h
            </span>
          </div>

          <div
            className="w-full h-64 bg-cover bg-center rounded-lg relative overflow-hidden flex flex-col justify-between p-4 border border-slate-200"
            style={{
              backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuCItIrdEl7mm-abwQ1MF_ktzx1ry68GXRKZJLj9O414zBhYmEVEqYSsMSaSoBPFooWyERT_WbP3kAYTiIZTc_ViHyAlePZVhguyc4w30dKUyy9qJ6M0zw1aLohRxtGC8Ie7DfjIx43MYhWSIWW765z_mLbSPAiN9crJoBX7ZyJYbHA9QYVwkir39zS05six5_DooZXGOlFYWIPy2tio8xtaQUYsdLfR1yHdz-3kWt0WaSSCTNmQBgoJ')`,
            }}
          >
            {/* Live radar overlay elements */}
            <div className="bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-white text-xs max-w-xs flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>EMAS High-Sensitivity Speed Loop 14-B</span>
            </div>

            <div className="bg-white/95 backdrop-blur-md p-3 rounded-lg border border-slate-200 shadow-md flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sky-600">gps_fixed</span>
                <div>
                  <div className="font-bold text-slate-900">
                    Nearest LTA Designated Recovery Bay
                  </div>
                  <div className="text-slate-500 font-mono text-[11px]">
                    {selectedCorridor.code} Mile Marker 6.4 (Exit 2)
                  </div>
                </div>
              </div>
              <button
                onClick={() => onSwitchToSos(selectedCorridor.code)}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-xs"
              >
                Request Tow
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Tows Ready</span>
              <span className="text-base font-bold text-slate-900">{selectedCorridor.towsOnline} units</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Corridor Length</span>
              <span className="text-base font-bold text-slate-900">12.0 km</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Congestion Index</span>
              <span className="text-base font-bold text-amber-600">
                {selectedCorridor.status === 'Congested' ? '88%' : '45%'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Live Corridor Incidents Feed */}
        <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-base">Active Expressway Incidents</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterSeverity('all')}
                className={`px-2 py-0.5 text-[11px] rounded ${
                  filterSeverity === 'all' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterSeverity('critical')}
                className={`px-2 py-0.5 text-[11px] rounded ${
                  filterSeverity === 'critical' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                Critical
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {filteredIncidents.map((inc) => (
              <div
                key={inc.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">
                    {inc.corridor}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{inc.timeAgo}</span>
                </div>
                <div className="text-slate-600">{inc.location} • {inc.lane}</div>
                <div className="text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200 text-[11px]">
                  {inc.advice}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
