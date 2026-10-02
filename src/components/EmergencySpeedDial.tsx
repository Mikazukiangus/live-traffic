import React from 'react';
import { EMERGENCY_NUMBERS } from '../data/mockData';

interface EmergencySpeedDialProps {
  onCall: (phone: string, title: string) => void;
  onOpenSlaModal: () => void;
}

export const EmergencySpeedDial: React.FC<EmergencySpeedDialProps> = ({
  onCall,
  onOpenSlaModal,
}) => {
  return (
    <div className="flex flex-col gap-4">
      {/* Toll-Free Emergency Hotlines Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col gap-3.5 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] text-red-600 font-bold uppercase tracking-wider">
              Speed Dial
            </span>
            <h3 className="text-base sm:text-lg text-slate-900 font-bold">
              Direct Emergency Lines
            </h3>
          </div>
          <span className="material-symbols-outlined text-slate-400">contact_phone</span>
        </div>

        {/* List of 4 Emergency Call rows */}
        <div className="flex flex-col gap-2">
          {EMERGENCY_NUMBERS.map((item, idx) => {
            const isRed = item.theme === 'red';
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onCall(item.tel, `${item.name} (${item.number})`)}
                className="w-full text-left p-2.5 rounded-lg bg-slate-50 hover:bg-sky-50/60 border border-slate-200/80 transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-9 h-9 rounded ${
                      isRed ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-600'
                    } flex items-center justify-center shrink-0`}
                  >
                    <span className="material-symbols-outlined text-lg">{item.icon}</span>
                  </div>
                  <div>
                    <span
                      className={`text-xs sm:text-sm font-bold block ${
                        isRed ? 'group-hover:text-red-600' : 'group-hover:text-sky-600'
                      } text-slate-900 transition-colors`}
                    >
                      {item.name}
                    </span>
                    <span className="text-[11px] text-slate-500">{item.subtitle}</span>
                  </div>
                </div>

                <span
                  className={`font-mono text-xs font-bold ${
                    isRed ? 'text-red-600' : 'text-sky-600'
                  }`}
                >
                  {item.number}
                </span>
              </button>
            );
          })}
        </div>

        {/* Telemetry Safety Directive */}
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-slate-800 text-xs flex items-start gap-2 leading-relaxed">
          <span className="material-symbols-outlined text-amber-700 text-base shrink-0 mt-0.5">
            report_problem
          </span>
          <div>
            <strong className="font-semibold text-amber-900">Safety Protocol:</strong> If stranded on
            expressway shoulder, turn on hazard blinkers, stay behind crash barriers, and do not
            stand behind the boot.
          </div>
        </div>
      </div>

      {/* Fleet Operator Protocol Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col gap-2 text-xs text-slate-600 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sky-600 font-bold">
            <span className="material-symbols-outlined text-base">badge</span>
            <span>Commercial Courier &amp; Heavy Fleet Protocol</span>
          </div>
        </div>
        <p className="leading-relaxed">
          Deliveries under time guarantee: Notify TrafficPulse Dispatch Hub to trigger SLA protection logs
          and automatically transfer cargo manifests to backup fleet units.
        </p>
        <button
          onClick={onOpenSlaModal}
          type="button"
          className="mt-1 w-full py-2 px-3 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm">schedule_send</span>
          <span>Activate SLA Cargo Protection Log</span>
        </button>
      </div>
    </div>
  );
};
