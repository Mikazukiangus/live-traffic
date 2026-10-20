import { CongestionStatus } from '../../types/traffic';
import { RAIN_LEVEL_STYLE, describeCorridorRain } from '../../utils/rainForecast';
import { LIGHTNING_NEAR_KM } from '../../../shared/geography/hazardMatching';
import { floodLabel } from '../../utils/floodAlerts';

// Speed bar scale; LTA's top speed band is 70+ km/h and most expressways are signed 80–90 km/h.
const SPEED_BAR_MAX_KMH = 90;

const STATUS_BADGE: Record<CongestionStatus, string> = {
  Congested: 'bg-red-100 text-red-700 border-red-200',
  Heavy: 'bg-amber-100 text-amber-800 border-amber-200',
  Moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Smooth: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const STATUS_BAR: Record<CongestionStatus, string> = {
  Congested: 'bg-red-500',
  Heavy: 'bg-amber-500',
  Moderate: 'bg-yellow-400',
  Smooth: 'bg-emerald-500',
};

import { ExpresswaysPanelProps } from './expresswayPanelTypes';
import { ExpresswayCorridor } from '../../types/traffic';
type Props = {
  readings: Pick<
    ExpresswaysPanelProps['readings'],
    | 'incidents'
    | 'incidentStatus'
    | 'incidentCounts'
    | 'speedDetails'
    | 'travelTimes'
    | 'worksByCode'
    | 'lightningByCode'
    | 'floodsByCode'
    | 'rainByCode'
    | 'selectedCorridor'
    | 'travelTimeText'
    | 'speedUnavailableText'
    | 'strikes'
  >;
  navigation: Pick<ExpresswaysPanelProps['navigation'], 'setSelectedCorridorCode'>;
  corridor: ExpresswayCorridor;
};
export function CorridorCard({ readings, navigation, corridor }: Props) {
  const {
    incidentStatus,
    incidentCounts,
    speedDetails,
    travelTimes,
    worksByCode,
    lightningByCode,
    floodsByCode,
    rainByCode,
    selectedCorridor,
    travelTimeText,
    speedUnavailableText,
  } = readings;
  const { setSelectedCorridorCode } = navigation;
  const isSelected = selectedCorridor.code === corridor.code;
  const liveSpeed = speedDetails?.[corridor.code];
  const rain = rainByCode[corridor.code];

  return (
    <div
      key={corridor.code}
      id={`road-${corridor.code}`}
      tabIndex={0}
      role="button"
      aria-label={`${corridor.code} ${corridor.name}`}
      aria-pressed={isSelected}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelectedCorridorCode(corridor.code);
        }
      }}
      onClick={() => setSelectedCorridorCode(corridor.code)}
      className={`p-4 rounded-xl border bg-white cursor-pointer transition-all shadow-xs flex flex-col justify-between gap-3 relative overflow-hidden ${
        isSelected ? 'border-sky-500 ring-2 ring-sky-500/20 shadow-md' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Active selection accent line */}
      {isSelected && <div className="absolute top-0 left-0 right-0 h-1 bg-sky-500"></div>}

      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-extrabold text-slate-900 font-mono">{corridor.code}</span>
            <span className="text-xs text-slate-500 line-clamp-1">{corridor.name}</span>
          </div>
          {liveSpeed ? (
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${STATUS_BADGE[liveSpeed.status]}`}>
              {liveSpeed.status}
            </span>
          ) : travelTimes.byCode[corridor.code]?.length ? (
            <span
              className="px-2 py-0.5 rounded text-[11px] font-bold border bg-slate-50 text-slate-600 border-slate-200 font-mono"
              title="LTA end-to-end travel time each way (speeds unavailable)"
            >
              {travelTimes.byCode[corridor.code].map((t) => t.minutes).join(' / ')} min
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold border bg-slate-50 text-slate-400 border-slate-200">
              —
            </span>
          )}
        </div>

        <div className="text-[11px] text-slate-400 mt-1">{corridor.fromTo}</div>
      </div>

      {/* LTA speed */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${liveSpeed ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}
            ></span>
            <span>Avg Speed (LTA)</span>
          </span>
          <span className="font-mono font-bold text-slate-900">
            {liveSpeed ? (
              `${liveSpeed.avgSpeedKmH} km/h`
            ) : (
              <span className="text-slate-400 font-normal">{speedUnavailableText}</span>
            )}
          </span>
        </div>

        <div className={`w-full h-2 bg-slate-100 rounded-full overflow-hidden ${liveSpeed ? '' : 'hidden'}`}>
          {liveSpeed && (
            <div
              className={`h-full rounded-full transition-all duration-500 ${STATUS_BAR[liveSpeed.status]}`}
              style={{ width: `${Math.min(100, (liveSpeed.avgSpeedKmH / SPEED_BAR_MAX_KMH) * 100)}%` }}
            ></div>
          )}
        </div>

        {liveSpeed && (
          <div className="text-[11px] text-slate-500">
            {liveSpeed.slowLinkPct}% of {liveSpeed.linkCount} segments below 40 km/h
          </div>
        )}

        {rain && (
          <div
            className={`text-[11px] flex items-center gap-1 ${RAIN_LEVEL_STYLE[rain.level].className}`}
            title={rain.wetAreas.map((a) => `${a.name}: ${a.forecast}`).join('\n') || undefined}
          >
            <span className="material-symbols-outlined text-sm">{RAIN_LEVEL_STYLE[rain.level].icon}</span>
            <span className="line-clamp-1">Next 2h: {describeCorridorRain(rain)}</span>
          </div>
        )}

        {floodsByCode[corridor.code]?.length > 0 && (
          <div
            className="text-[11px] flex items-center gap-1 text-sky-800 font-semibold"
            title={floodsByCode[corridor.code].map((f) => `${floodLabel(f)}: ${f.description}`).join('\n')}
          >
            <span className="material-symbols-outlined text-sm">flood</span>
            <span className="line-clamp-1">
              PUB flood alert: {floodsByCode[corridor.code][0].area || floodsByCode[corridor.code][0].headline}
            </span>
          </div>
        )}

        {lightningByCode[corridor.code] > 0 && (
          <div
            className="text-[11px] flex items-center gap-1 text-violet-800 font-semibold"
            title={`NEA lightning observation: ${lightningByCode[corridor.code]} strikes within ${LIGHTNING_NEAR_KM} km of areas along the ${corridor.code}`}
          >
            <span className="material-symbols-outlined text-sm">bolt</span>
            Lightning nearby ({lightningByCode[corridor.code]})
          </div>
        )}

        <div className="text-[11px] text-slate-500 pt-1 flex items-start gap-1" title={travelTimeText(corridor.code)}>
          <span className="material-symbols-outlined text-sm text-slate-400">schedule</span>
          <span className="line-clamp-2">Travel time: {travelTimeText(corridor.code)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
        <span className="text-[11px] text-slate-400 font-mono">
          {incidentStatus === 'loading'
            ? 'Loading incidents…'
            : `${incidentCounts[corridor.code] || 0} active LTA ${incidentCounts[corridor.code] === 1 ? 'incident' : 'incidents'}`}
          {worksByCode[corridor.code]?.length ? ` · ${worksByCode[corridor.code].length} road works` : ''}
        </span>
      </div>
    </div>
  );
}
