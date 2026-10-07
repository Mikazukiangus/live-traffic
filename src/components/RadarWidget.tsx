import React, { useState } from 'react';
import { TOW_FLEET_UNITS } from '../data/mockData';
import { TowUnit } from '../types/traffic';

interface RadarWidgetProps {
  onSelectUnit?: (unit: TowUnit) => void;
  corridorCode: string;
  // Live readings for the pickup expressway
  trafficSpeed: string;
  incidentsText: string;
  rainText: string | null;
}

export const RadarWidget: React.FC<RadarWidgetProps> = ({
  onSelectUnit,
  corridorCode,
  trafficSpeed,
  incidentsText,
  rainText,
}) => {
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const activeUnit = TOW_FLEET_UNITS[selectedUnitIndex];

  const handleNextUnit = () => {
    setSelectedUnitIndex((prev) => (prev + 1) % TOW_FLEET_UNITS.length);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
          <h3 className="text-base sm:text-lg text-slate-900 font-bold">Tow Fleet Radar</h3>
        </div>
        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase">
          Sample units
        </span>
      </div>

      {/* Radar Map Visual */}
      <div
        className="w-full h-48 bg-cover bg-center rounded-lg relative overflow-hidden flex flex-col justify-between p-3 border border-slate-200 shadow-inner group cursor-pointer"
        style={{
          backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuCItIrdEl7mm-abwQ1MF_ktzx1ry68GXRKZJLj9O414zBhYmEVEqYSsMSaSoBPFooWyERT_WbP3kAYTiIZTc_ViHyAlePZVhguyc4w30dKUyy9qJ6M0zw1aLohRxtGC8Ie7DfjIx43MYhWSIWW765z_mLbSPAiN9crJoBX7ZyJYbHA9QYVwkir39zS05six5_DooZXGOlFYWIPy2tio8xtaQUYsdLfR1yHdz-3kWt0WaSSCTNmQBgoJ')`,
        }}
        onClick={handleNextUnit}
        title="Click to cycle active radar tow unit"
      >
        {/* Radar ping rings in center */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-24 h-24 rounded-full border border-sky-400/40 animate-ping"></div>
          <div className="w-12 h-12 rounded-full border border-sky-500/60 bg-sky-500/10"></div>
          <span className="w-3 h-3 rounded-full bg-sky-600 shadow-md ring-2 ring-white"></span>
        </div>

        {/* Top unit selector hint */}
        <div className="self-end bg-scrim/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white font-mono flex items-center gap-1">
          <span>Sample {selectedUnitIndex + 1}/{TOW_FLEET_UNITS.length}</span>
          <span className="material-symbols-outlined text-[12px]">cycle</span>
        </div>

        {/* Bottom unit status pill overlay */}
        <div className="w-full bg-white/95 backdrop-blur-md p-2 rounded border border-slate-200 flex items-center justify-between text-xs shadow-sm">
          <span className="flex items-center gap-1.5 text-slate-900 font-semibold truncate">
            <span className="material-symbols-outlined text-sm text-sky-600">navigation</span>
            <span>
              {activeUnit.code}: {activeUnit.distanceKm}km away
            </span>
          </span>
          <span className="text-emerald-700 font-bold font-mono shrink-0 pl-1">
            ETA {activeUnit.etaMins} min
          </span>
        </div>
      </div>

      <p className="text-[10px] text-slate-400 -mt-1">
        Demo fleet: unit positions and ETAs are illustrative, not live vehicle tracking.
      </p>

      {/* Live LTA / NEA readings for the pickup expressway */}
      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
        <div className="bg-slate-50 border border-slate-200 p-2.5 rounded">
          <span className="text-slate-500 text-[10px] uppercase block font-semibold">{corridorCode} Traffic (LTA)</span>
          <span className="text-slate-900 font-bold">{trafficSpeed}</span>
        </div>
        <div className="bg-slate-50 border border-slate-200 p-2.5 rounded">
          <span className="text-slate-500 text-[10px] uppercase block font-semibold">{corridorCode} Incidents (LTA)</span>
          <span className="text-slate-900 font-bold">{incidentsText}</span>
        </div>
        {rainText && (
          <div className="col-span-2 bg-slate-50 border border-slate-200 p-2.5 rounded">
            <span className="text-slate-500 text-[10px] uppercase block font-semibold">Next 2h near pickup (NEA)</span>
            <span className="text-slate-900 font-bold">{rainText}</span>
          </div>
        )}
      </div>
    </div>
  );
};
