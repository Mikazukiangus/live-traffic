import React from 'react';
import { IncidentFeed } from '../utils/ltaIncidents';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIncident?: (corridor: string) => void;
  incidentFeed: IncidentFeed;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  onSelectIncident,
  incidentFeed,
}) => {
  if (!isOpen) return null;
  const { incidents, status, fetchedAt } = incidentFeed;

  return (
    <div className="fixed inset-0 z-50 bg-scrim/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col border-l border-slate-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-600">notifications_active</span>
            <h3 className="font-bold text-slate-900 text-base">Live Highway Incident Alerts</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Alerts list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Active LTA Traffic Incidents ({incidents.length})
          </div>

          {incidents.length === 0 && (
            <div className="p-6 text-center text-slate-400 text-xs">
              {status === 'loading'
                ? 'Loading LTA incidents…'
                : status === 'error'
                ? 'LTA incident feed unavailable. Retrying every minute.'
                : 'No active incidents reported by LTA.'}
            </div>
          )}

          {incidents.map((alert) => {
            const isCritical = alert.severity === 'Critical';
            const isWarning = alert.severity === 'Warning';
            return (
              <div
                key={alert.id}
                onClick={() => {
                  onSelectIncident?.(alert.corridor);
                  onClose();
                }}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs flex flex-col gap-1.5 ${
                  isCritical
                    ? 'bg-red-50/70 border-red-200 hover:border-red-300'
                    : isWarning
                    ? 'bg-amber-50/70 border-amber-200 hover:border-amber-300'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isCritical
                        ? 'bg-red-600 text-white'
                        : isWarning
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {alert.type}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">{alert.timeAgo}</span>
                </div>

                <div className="font-bold text-slate-900 text-xs sm:text-sm mt-0.5">
                  {alert.corridor} • {alert.location}
                </div>

                <div className="text-xs text-slate-600 font-medium">
                  {alert.lane}
                </div>

                <div className="text-[11px] text-slate-500 bg-white/80 p-2 rounded border border-slate-200/60 mt-1">
                  <strong>LTA:</strong> {alert.advice}
                </div>

                <div className="flex items-center justify-end pt-1 text-[11px] text-slate-400">
                  <span className="text-sky-600 font-semibold flex items-center gap-0.5">
                    View on radar <span className="material-symbols-outlined text-[12px]">chevron_right</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Source: LTA DataMall TrafficIncidents</span>
          <span className={status === 'error' ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
            {status === 'error'
              ? `● Refresh failed${fetchedAt ? ` • last ${fetchedAt} SGT` : ''}`
              : fetchedAt
              ? `● Updated ${fetchedAt} SGT`
              : '● Loading'}
          </span>
        </div>
      </div>
    </div>
  );
};
