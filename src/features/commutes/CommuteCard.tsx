import React, { useMemo } from 'react';
import { CongestionStatus } from '../../types/traffic';
import { RAIN_LEVEL_STYLE } from '../../utils/rainForecast';
import { Commute, enableNotifications, notificationsSupported, saveCommute } from '../../utils/commutes';
import { erpOn, formatSgd } from '../../utils/erp';
import { floodLabel } from '../../utils/floodAlerts';
import { sgtClock, useNow } from '../../utils/freshness';
import { MyCommuteProps } from './types';
import { summarizeCommute } from './summarizeCommute';
import { useCommuteHistory } from './useCommuteHistory';
import { Sparkline } from './CommuteSparkline';
const STATUS_TEXT: Record<CongestionStatus, string> = {
  Congested: 'text-red-700',
  Heavy: 'text-amber-700',
  Moderate: 'text-yellow-800',
  Smooth: 'text-emerald-700',
};

export const CommuteCard: React.FC<MyCommuteProps & { commute: Commute; onEdit: () => void }> = ({
  commute,
  routes,
  travelFetchedAt,
  travelStatus,
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
  const { codes, legs, total, anyEstimated, onRoute, works, worstRain, strikes, floodAlerts } = summarizeCommute(
    commute,
    { routes, estimateMinutes, incidents, roadWorks, rain, lightning, floods },
  );
  const now = useNow();
  const erp = useMemo(() => erpOn(codes, new Date(now)), [codes.join(), now]);

  const { samples, trend } = useCommuteHistory(commute.id, total, anyEstimated, travelStatus, travelFetchedAt, now);

  const toggleAlerts = async () => {
    if (!commute.alerts && !(await enableNotifications())) {
      window.alert(
        'Notifications are blocked for this site. Allow them in your browser settings to get commute alerts.',
      );
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
            <span
              className="font-mono font-bold text-slate-900"
              title={
                anyEstimated
                  ? 'Includes an estimate for KPE/MCE from length and average speed'
                  : 'Sum of LTA estimated travel times'
              }
            >
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
              aria-label={
                commute.alerts ? 'Turn off alerts for this commute' : 'Alert me about new incidents on this commute'
              }
              title={
                commute.alerts
                  ? 'Alerts on: you get a notification when a new incident appears on these expressways while TrafficPulse is open'
                  : 'Alert me about new incidents on these expressways (while TrafficPulse is open)'
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${
                commute.alerts ? 'bg-sky-50 text-sky-700' : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-lg">
                {commute.alerts ? 'notifications_active' : 'notifications_off'}
              </span>
            </button>
          )}
          <button
            onClick={onEdit}
            aria-label="Edit commute"
            title="Edit commute"
            className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">edit</span>
          </button>
        </div>
      </div>

      <ol className="flex flex-col gap-1">
        {legs.map(({ leg, minutes, estimated }, i) => {
          const s = speeds?.[leg.code];
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-700">
              <button
                onClick={() => onShowOnMap(leg.code)}
                className="font-mono font-bold text-slate-900 hover:text-sky-700 cursor-pointer"
                title="Show on the map"
              >
                {leg.code}
              </button>
              <span className="text-slate-600">{leg.from ? `${leg.from} → ${leg.to}` : 'whole expressway'}</span>
              {minutes != null && (
                <span className="font-mono text-slate-900">
                  {estimated ? '≈' : ''}
                  {minutes} min
                </span>
              )}
              {s && (
                <span className={`text-xs font-semibold ${STATUS_TEXT[s.status]}`}>
                  {s.avgSpeedKmH} km/h · {s.status}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {(trend || samples.length > 1) && (
        <div className="flex items-center gap-3 text-xs">
          {samples.length > 1 && <Sparkline samples={samples} />}
          {trend ? (
            <span
              className={`font-semibold ${TREND_STYLE[trend.direction].className}`}
              title={`Compared with ${sgtClock(trend.since)} SGT, from LTA travel times seen while TrafficPulse was open`}
            >
              <span className="material-symbols-outlined text-sm align-[-3px] mr-0.5">
                {TREND_STYLE[trend.direction].icon}
              </span>
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
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600"
          title="LTA ERP rates for cars on these expressways. Which gantries you pass depends on your direction and exits."
        >
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
        <span
          className={onRoute.length ? 'text-red-700 font-semibold' : ''}
          title={onRoute.map((i) => `${i.corridorCode}: ${i.type}, ${i.location}`).join('\n')}
        >
          {onRoute.length
            ? `${onRoute.length} incident${onRoute.length === 1 ? '' : 's'}: ${onRoute[0].type} on ${onRoute[0].corridorCode}`
            : 'No incidents'}
        </span>
        {works > 0 && <span>{works} road works</span>}
        {worstRain && (
          <span className={`flex items-center gap-1 ${RAIN_LEVEL_STYLE[worstRain.level].className}`}>
            <span className="material-symbols-outlined text-sm">{RAIN_LEVEL_STYLE[worstRain.level].icon}</span>
            {worstRain.wetAreas.length ? worstRain.wetAreas[0].forecast : 'No rain in the next 2h'}
          </span>
        )}
        {floodAlerts.length > 0 && (
          <span
            className="flex items-center gap-1 text-sky-800 font-semibold"
            title={floodAlerts.map((f) => `${floodLabel(f)}: ${f.description}`).join('\n')}
          >
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
  building: {
    icon: 'trending_up',
    className: 'text-red-700',
    advice: 'traffic is building, leaving sooner is likely quicker',
  },
  easing: {
    icon: 'trending_down',
    className: 'text-emerald-700',
    advice: 'traffic is easing, waiting a little may save time',
  },
  steady: { icon: 'trending_flat', className: 'text-slate-700', advice: 'little difference between now and later' },
} as const;
