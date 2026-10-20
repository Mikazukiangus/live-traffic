const UNPUBLISHED = ['KPE', 'MCE'];
import React, { useMemo } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { TravelRoute } from '../../utils/ltaTravelTimes';
import { CommuteLeg } from '../../utils/commutes';

const selectClass =
  'h-10 px-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 min-w-0';

export const LegEditor: React.FC<{
  index: number;
  leg: CommuteLeg;
  routes: TravelRoute[];
  onChange: (c: Partial<CommuteLeg>) => void;
  onRemove?: () => void;
}> = ({ index, leg, routes, onChange, onRemove }) => {
  const directions = routes.filter((r) => r.code === leg.code);
  const route = directions.find((r) => r.direction === leg.direction);
  const fromIdx = route ? route.stretches.findIndex((s) => s.from === leg.from) : -1;
  const ends = useMemo(
    () => (route && fromIdx >= 0 ? route.stretches.slice(fromIdx).map((s) => s.to) : []),
    [route, fromIdx],
  );
  const unpublished = UNPUBLISHED.includes(leg.code);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-500 w-4">{index + 1}</span>
        <select
          aria-label="Expressway"
          value={leg.code}
          onChange={(e) => onChange({ code: e.target.value, direction: 0, from: '', to: '' })}
          className={`${selectClass} flex-1`}
        >
          <option value="">Choose expressway</option>
          {EXPRESSWAY_CORRIDORS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label="Remove this expressway"
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-200 cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        )}
      </div>

      {unpublished && (
        <p className="text-xs text-slate-500 pl-6">
          LTA doesn't publish points for {leg.code}; its time is estimated end to end.
        </p>
      )}

      {leg.code && !unpublished && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-6">
          <select
            aria-label="Direction"
            value={leg.direction || ''}
            onChange={(e) => onChange({ direction: Number(e.target.value), from: '', to: '' })}
            className={selectClass}
          >
            <option value="">Direction</option>
            {directions.map((r) => (
              <option key={r.direction} value={r.direction}>
                Towards {r.towards}
              </option>
            ))}
          </select>
          <select
            aria-label="From"
            value={leg.from}
            onChange={(e) => onChange({ from: e.target.value, to: '' })}
            disabled={!route}
            className={selectClass}
          >
            <option value="">From</option>
            {route?.stretches.map((s) => (
              <option key={s.from} value={s.from}>
                {s.from}
              </option>
            ))}
          </select>
          <select
            aria-label="To"
            value={leg.to}
            onChange={(e) => onChange({ to: e.target.value })}
            disabled={!ends.length}
            className={selectClass}
          >
            <option value="">To</option>
            {ends.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}
      {leg.code && !unpublished && directions.length === 0 && (
        <p className="text-xs text-amber-700 pl-6">Loading LTA travel time points…</p>
      )}
    </div>
  );
};
