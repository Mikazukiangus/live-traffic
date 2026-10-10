import React from 'react';
import { CarParkAvailability } from '../components/CarParkAvailability';
import { GnssMarker } from '../types/traffic';
import { writeParams } from '../utils/urlState';

interface CourierHubViewProps {
  onOpenSlaModal: () => void;
  onCallHotline: (phone: string, title: string) => void;
  pickup: GnssMarker;
}

export const CourierHubView: React.FC<CourierHubViewProps> = ({
  onOpenSlaModal,
  onCallHotline,
  pickup,
}) => {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
              For Drivers
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            Car Parks, Heavy Vehicles &amp; Couriers
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Free car park lots, heavy vehicle tunnel rules, wreckers and delivery delay logs.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenSlaModal}
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">verified</span>
            <span>Issue SLA Protection Log</span>
          </button>
        </div>
      </div>

      <CarParkAvailability lat={pickup.lat} lon={pickup.lng} placeLabel={pickup.marker} />

      {/* 3 Action Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pillar 1: SLA Protection */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
              <span className="material-symbols-outlined text-xl">timer</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">Cargo SLA Protection Certificate</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              If your commercial vehicle breaks down or is held up by an expressway accident,
              generate an LTA timestamped certificate to waive delivery penalty fees.
            </p>
          </div>
          <button
            onClick={onOpenSlaModal}
            className="w-full py-2 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold rounded-lg transition-colors border border-sky-200"
          >
            Generate Protection Log
          </button>
        </div>

        {/* Pillar 2: Heavy Vehicle Tunnel Escorts */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <span className="material-symbols-outlined text-xl">rv_hookup</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">Tunnel Height &amp; DG Regulations</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              KPE &amp; MCE Tunnel height restriction is <strong>4.5 meters</strong>. Dangerous goods
              (DG) carriers must obtain clearance escort before entering subterranean corridors.
            </p>
          </div>
          <button
            onClick={() => onCallHotline('18002255582', 'LTA Heavy Vehicle Escort')}
            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
          >
            Request Tunnel Escort
          </button>
        </div>

        {/* Pillar 3: Heavy Wreckers */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <span className="material-symbols-outlined text-xl">local_shipping</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">20-Ton Heavy Wrecker Network</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Prime movers, tipper lorries, and container chassis breakdowns require dedicated under-lift
              rigs with hydraulic winch capability to avoid blocking peak container traffic.
            </p>
          </div>
          <button
            onClick={() => onCallHotline('6568613300', 'Jurong Heavy Wrecker Dispatch')}
            className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg transition-colors border border-emerald-200"
          >
            Call Heavy Rig Dispatch
          </button>
        </div>
      </div>

      {/* ERP rates live with the traffic now */}
      <button
        onClick={() => writeParams({ page: 'radar', tab: 'erp' }, true)}
        className="self-start flex items-center gap-2 px-4 py-3 rounded-xl bg-white border border-slate-200 shadow-xs text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
      >
        <span className="material-symbols-outlined text-base text-amber-700">toll</span>
        ERP rates are on Live Traffic, under the ERP tab
        <span className="material-symbols-outlined text-base text-slate-400">arrow_forward</span>
      </button>
    </div>
  );
};
