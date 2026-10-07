import React, { useEffect, useMemo, useState } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../data/mockData';
import { CongestionStatus, IncidentAlert } from '../types/traffic';
import { TravelRoute, minutesBetween } from '../utils/ltaTravelTimes';
import { CorridorRain, RAIN_LEVEL_STYLE } from '../utils/rainForecast';
import { RoadWork } from '../utils/roadConditions';
import {
  Commute,
  CommuteLeg,
  MAX_COMMUTES,
  commuteCodes,
  deleteCommute,
  enableNotifications,
  notificationsSupported,
  saveCommute,
  useCommutes,
} from '../utils/commutes';
import { Sample, forgetCommute, recordSample, trendOf } from '../utils/commuteHistory';
import { erpOn, formatSgd } from '../utils/erp';
import { FloodAlert, floodLabel } from '../utils/floodAlerts';
import { sgtClock, useNow } from '../utils/freshness';

interface SpeedSummary {
  avgSpeedKmH: number;
  status: CongestionStatus;
}

interface MyCommuteProps {
  routes: TravelRoute[];
  speeds: Record<string, SpeedSummary> | null;
  incidents: IncidentAlert[];
  roadWorks: Record<string, RoadWork[]>;
  rain: Record<string, CorridorRain>;
  lightning: Record<string, number>;
  floods: Record<string, FloodAlert[]>;
  // Whole-expressway estimate for KPE/MCE, which LTA doesn't publish travel times for
  estimateMinutes: (code: string) => number | null;
  onShowOnMap: (code: string) => void;
}

const STATUS_TEXT: Record<CongestionStatus, string> = {
  Congested: 'text-red-700',
  Heavy: 'text-amber-700',
  Moderate: 'text-yellow-800',
  Smooth: 'text-emerald-700',
};

const RAIN_RANK = { dry: 0, rain: 1, heavy: 2, thundery: 3 } as const;

export const MyCommute: React.FC<MyCommuteProps> = (props) => {
  const commutes = useCommutes();
  const [editing, setEditing] = useState<Commute | null>(null);

  return (
    <section id="commute" aria-label="My commute" className="flex flex-col gap-3 scroll-mt-24">
      {commutes.map((c) => (
        <CommuteCard key={c.id} commute={c} {...props} onEdit={() => setEditing(c)} />
      ))}
      {commutes.length < MAX_COMMUTES && (
        <button
          onClick={() => setEditing({ id: `c${Date.now()}`, name: '', legs: [], alerts: false })}
          className="self-start h-9 px-3 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-white hover:border-sky-300 hover:text-sky-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">add_road</span>
          {commutes.length ? 'Add another commute' : 'Add my commute'}
        </button>
      )}
      {editing && <CommuteEditor initial={editing} routes={props.routes} onClose={() => setEditing(null)} />}
    </section>
  );
};

// ---- One saved commute ----

const CommuteCard: React.FC<MyCommuteProps & { commute: Commute; onEdit: () => void }> = ({
  commute,
  routes,
  speeds,
  incidents,
  roadWorks,
  rain,
  lightning,
  floods,
  estimateMinutes,
  onShowOnMap,
  onEdit,
}) => {
  const codes = commuteCodes(commute);
  const legs = commute.legs.map((leg) => {
    const route = routes.find((r) => r.code === leg.code && r.direction === leg.direction);
    const lta = route ? minutesBetween(route, leg.from, leg.to) : null;
    const est = lta == null ? estimateMinutes(leg.code) : null;
    return { leg, minutes: lta ?? est, estimated: lta == null };
  });
  const total = legs.every((l) => l.minutes != null) ? legs.reduce((sum, l) => sum + (l.minutes || 0), 0) : null;
  const anyEstimated = legs.some((l) => l.estimated);
  const onRoute = incidents.filter((i) => i.corridorCode && codes.includes(i.corridorCode));
  const works = codes.reduce((n, c) => n + (roadWorks[c]?.length || 0), 0);
  const worstRain = codes
    .map((c) => rain[c])
    .filter(Boolean)
    .sort((a, b) => RAIN_RANK[b.level] - RAIN_RANK[a.level])[0];
  const strikes = codes.reduce((n, c) => n + (lightning[c] || 0), 0);
  const floodAlerts = [...new Map(codes.flatMap((c) => floods[c] || []).map((f) => [f.id, f])).values()];
  const now = useNow();
  const erp = useMemo(() => erpOn(codes, new Date(now)), [codes.join(), now]);

  // Travel time history for the trend; only LTA times count (estimates move with speed, not time).
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    if (total != null && !anyEstimated) setSamples(recordSample(commute.id, total));
  }, [commute.id, total, anyEstimated]);
  const trend = trendOf(samples, now);

  const toggleAlerts = async () => {
    if (!commute.alerts && !(await enableNotifications())) {
      window.alert('Notifications are blocked for this site. Allow them in your browser settings to get commute alerts.');
      return;
    }
    saveCommute({ ...commute, alerts: !commute.alerts });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs flex flex-col gap-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-base text-sky-600">commute</span>
          <span className="font-bold text-slate-900 truncate">{commute.name}</span>
          {total != null && (
            <span className="font-mono font-bold text-slate-900" title={anyEstimated ? 'Includes an estimate for KPE/MCE from length and average speed' : 'Sum of LTA estimated travel times'}>
              {anyEstimated ? '≈' : ''}
              {total} min
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {notificationsSupported() && (
            <button
              onClick={toggleAlerts}
              aria-pressed={commute.alerts}
              aria-label={commute.alerts ? 'Turn off alerts for this commute' : 'Alert me about new incidents on this commute'}
              title={
                commute.alerts
                  ? 'Alerts on: you get a notification when a new incident appears on these expressways while TrafficPulse is open'
                  : 'Alert me about new incidents on these expressways (while TrafficPulse is open)'
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${
                commute.alerts ? 'bg-sky-50 text-sky-700' : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-lg">{commute.alerts ? 'notifications_active' : 'notifications_off'}</span>
            </button>
          )}
          <button onClick={onEdit} aria-label="Edit commute" title="Edit commute" className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 flex items-center justify-center cursor-pointer">
            <span className="material-symbols-outlined text-lg">edit</span>
          </button>
        </div>
      </div>

      <ol className="flex flex-col gap-1">
        {legs.map(({ leg, minutes, estimated }, i) => {
          const s = speeds?.[leg.code];
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-700">
              <button onClick={() => onShowOnMap(leg.code)} className="font-mono font-bold text-slate-900 hover:text-sky-700 cursor-pointer" title="Show on the map">
                {leg.code}
              </button>
              <span className="text-slate-600">{leg.from ? `${leg.from} → ${leg.to}` : 'whole expressway'}</span>
              {minutes != null && (
                <span className="font-mono text-slate-900">
                  {estimated ? '≈' : ''}
                  {minutes} min
                </span>
              )}
              {s && <span className={`text-xs font-semibold ${STATUS_TEXT[s.status]}`}>{s.avgSpeedKmH} km/h · {s.status}</span>}
            </li>
          );
        })}
      </ol>

      {(trend || samples.length > 1) && (
        <div className="flex items-center gap-3 text-xs">
          {samples.length > 1 && <Sparkline samples={samples} />}
          {trend ? (
            <span className={`font-semibold ${TREND_STYLE[trend.direction].className}`} title={`Compared with ${sgtClock(trend.since)} SGT, from LTA travel times seen while TrafficPulse was open`}>
              <span className="material-symbols-outlined text-sm align-[-3px] mr-0.5">{TREND_STYLE[trend.direction].icon}</span>
              {trend.direction === 'steady'
                ? `Steady since ${sgtClock(trend.since)}`
                : `${trend.change > 0 ? '+' : '−'}${Math.abs(trend.change)} min since ${sgtClock(trend.since)}`}
              <span className="font-normal text-slate-500"> · {TREND_STYLE[trend.direction].advice}</span>
            </span>
          ) : (
            <span className="text-slate-500">Trend appears after about 15 minutes of travel times</span>
          )}
        </div>
      )}

      {(erp.charging.length > 0 || erp.next) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600" title="LTA ERP rates for cars on these expressways. Which gantries you pass depends on your direction and exits.">
          <span className="material-symbols-outlined text-sm text-amber-700">toll</span>
          {erp.charging.length > 0 ? (
            <>
              <span className="font-semibold text-amber-800">
                ERP now: {erp.charging.map((c) => `${formatSgd(c.rate)} ${c.gantry.code}`).join(', ')}
              </span>
              <span className="text-slate-500">
                ({erp.charging[0].gantry.location}, {erp.charging[0].note})
              </span>
            </>
          ) : (
            erp.next && (
              <span>
                ERP free now · {erp.next.gantry.code} from {erp.next.start} at {formatSgd(erp.next.rate)}
              </span>
            )
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-2 border-t border-slate-100">
        <span className={onRoute.length ? 'text-red-700 font-semibold' : ''} title={onRoute.map((i) => `${i.corridorCode}: ${i.type}, ${i.location}`).join('\n')}>
          {onRoute.length ? `${onRoute.length} incident${onRoute.length === 1 ? '' : 's'}: ${onRoute[0].type} on ${onRoute[0].corridorCode}` : 'No incidents'}
        </span>
        {works > 0 && <span>{works} road works</span>}
        {worstRain && (
          <span className={`flex items-center gap-1 ${RAIN_LEVEL_STYLE[worstRain.level].className}`}>
            <span className="material-symbols-outlined text-sm">{RAIN_LEVEL_STYLE[worstRain.level].icon}</span>
            {worstRain.wetAreas.length ? worstRain.wetAreas[0].forecast : 'No rain in the next 2h'}
          </span>
        )}
        {floodAlerts.length > 0 && (
          <span className="flex items-center gap-1 text-sky-800 font-semibold" title={floodAlerts.map((f) => `${floodLabel(f)}: ${f.description}`).join('\n')}>
            <span className="material-symbols-outlined text-sm">flood</span>
            {floodLabel(floodAlerts[0])}
          </span>
        )}
        {strikes > 0 && (
          <span className="flex items-center gap-1 text-violet-800 font-semibold">
            <span className="material-symbols-outlined text-sm">bolt</span>
            Lightning nearby
          </span>
        )}
      </div>
    </div>
  );
};

const TREND_STYLE = {
  building: { icon: 'trending_up', className: 'text-red-700', advice: 'traffic is building, leaving sooner is likely quicker' },
  easing: { icon: 'trending_down', className: 'text-emerald-700', advice: 'traffic is easing, waiting a little may save time' },
  steady: { icon: 'trending_flat', className: 'text-slate-700', advice: 'little difference between now and later' },
} as const;

/** Travel time over the last few hours, as a small line. */
const Sparkline: React.FC<{ samples: Sample[] }> = ({ samples }) => {
  const W = 72, H = 20;
  const t0 = samples[0][0], t1 = samples[samples.length - 1][0] || t0 + 1;
  const vals = samples.map(([, m]) => m);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (m: number) => (hi === lo ? H / 2 : H - 2 - ((m - lo) / (hi - lo)) * (H - 4));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 text-sky-600" role="img" aria-label={`Travel time from ${lo} to ${hi} minutes`}>
      <polyline points={samples.map(([t, m]) => `${x(t).toFixed(1)},${y(m).toFixed(1)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

// ---- Add / edit a commute ----

const UNPUBLISHED = ['KPE', 'MCE'];

const CommuteEditor: React.FC<{ initial: Commute; routes: TravelRoute[]; onClose: () => void }> = ({ initial, routes, onClose }) => {
  const [name, setName] = useState(initial.name);
  const [legs, setLegs] = useState<CommuteLeg[]>(initial.legs.length ? initial.legs : [{ code: '', direction: 0, from: '', to: '' }]);
  const isNew = !initial.legs.length;

  const update = (i: number, change: Partial<CommuteLeg>) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const complete = (l: CommuteLeg) => l.code && (UNPUBLISHED.includes(l.code) || (l.direction && l.from && l.to));
  const valid = name.trim() && legs.length > 0 && legs.every(complete);

  const save = () => {
    if (!valid) return;
    saveCommute({ ...initial, name: name.trim(), legs });
    onClose();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'Add a commute' : 'Edit commute'}
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{isNew ? 'Add a commute' : 'Edit commute'}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home to work"
            maxLength={40}
            className="h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </label>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-slate-700">Expressways, in the order you drive them</span>
          {legs.map((leg, i) => (
            <LegEditor
              key={i}
              index={i}
              leg={leg}
              routes={routes}
              onChange={(c) => update(i, c)}
              onRemove={legs.length > 1 ? () => setLegs((ls) => ls.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          {legs.length < 4 && (
            <button
              onClick={() => setLegs((ls) => [...ls, { code: '', direction: 0, from: '', to: '' }])}
              className="self-start text-xs font-bold text-sky-700 hover:underline cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-base">add</span>Add another expressway
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Times are LTA's estimates for the stretches you pick. Your commutes are saved in this browser only.
        </p>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {!isNew ? (
            <button
              onClick={() => {
                deleteCommute(initial.id);
                forgetCommute(initial.id);
                onClose();
              }}
              className="text-sm font-semibold text-red-700 hover:underline cursor-pointer"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={!valid}
            className="h-10 px-5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-40 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const selectClass =
  'h-10 px-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 min-w-0';

const LegEditor: React.FC<{
  index: number;
  leg: CommuteLeg;
  routes: TravelRoute[];
  onChange: (c: Partial<CommuteLeg>) => void;
  onRemove?: () => void;
}> = ({ index, leg, routes, onChange, onRemove }) => {
  const directions = routes.filter((r) => r.code === leg.code);
  const route = directions.find((r) => r.direction === leg.direction);
  const fromIdx = route ? route.stretches.findIndex((s) => s.from === leg.from) : -1;
  const ends = useMemo(() => (route && fromIdx >= 0 ? route.stretches.slice(fromIdx).map((s) => s.to) : []), [route, fromIdx]);
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
          <button onClick={onRemove} aria-label="Remove this expressway" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-200 cursor-pointer">
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        )}
      </div>

      {unpublished && <p className="text-xs text-slate-500 pl-6">LTA doesn't publish points for {leg.code}; its time is estimated end to end.</p>}

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
          <select aria-label="From" value={leg.from} onChange={(e) => onChange({ from: e.target.value, to: '' })} disabled={!route} className={selectClass}>
            <option value="">From</option>
            {route?.stretches.map((s) => (
              <option key={s.from} value={s.from}>
                {s.from}
              </option>
            ))}
          </select>
          <select aria-label="To" value={leg.to} onChange={(e) => onChange({ to: e.target.value })} disabled={!ends.length} className={selectClass}>
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
