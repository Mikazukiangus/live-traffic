import { cameraAir, cameraRain, COUNT_NOTE, checkpointReadings } from './cameraReadings';
import { JAM_STYLE } from '../../utils/expresswaySpeeds';
import { RainForecast } from '../../utils/rainForecast';
interface Props {
  summary: ReturnType<typeof checkpointReadings>[number];
  label: string;
  rain: ReturnType<typeof cameraRain>;
  air: ReturnType<typeof cameraAir>;
  rainForecast: RainForecast | null;
}
export function CheckpointSummary({ summary, label, rain, air, rainForecast }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-bold text-slate-900">{label} · towards Johor</span>
        {summary.approach ? (
          <span className="font-semibold text-slate-800">~{summary.approach.minutes} min approach</span>
        ) : summary.ltaMinutes != null ? (
          <span className="font-semibold text-slate-800">
            {summary.travel.label}: {summary.ltaMinutes} min
          </span>
        ) : (
          <span className="text-slate-500">Approach time unavailable</span>
        )}
        {summary.reading ? (
          <span className={`flex items-center gap-1.5 font-semibold ${JAM_STYLE[summary.reading.level].text}`}>
            <span className={`w-2 h-2 rounded-full ${JAM_STYLE[summary.reading.level].dot}`}></span>
            {summary.bridge}: {summary.reading.level}
          </span>
        ) : summary.count != null ? (
          <span className="text-slate-600">
            {summary.bridge}: ~{summary.count} vehicles
          </span>
        ) : null}
        {summary.queue && (
          <span className={`flex items-center gap-1.5 ${JAM_STYLE[summary.queue].text}`}>
            <span className={`w-2 h-2 rounded-full ${JAM_STYLE[summary.queue].dot}`}></span>
            {summary.queue} near checkpoint
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {rain && (
          <span className={`flex items-center gap-1.5 ${rain.style.className}`}>
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {rain.style.icon}
            </span>
            Next 2h: {rain.area.forecast}
          </span>
        )}
        {air && (
          <span className={`flex items-center gap-1.5 ${air.band.text}`}>
            <span className={`w-2 h-2 rounded-full ${air.band.dot}`}></span>
            PSI {air.psi} · {air.band.label}
          </span>
        )}
      </div>
      <details className="text-xs text-slate-500">
        <summary className="min-h-11 flex items-center gap-1 cursor-pointer">
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            info
          </span>
          Singapore approach only · excludes checkpoint queue and immigration
        </summary>
        <div className="pt-1 space-y-1 leading-relaxed">
          {summary.approach ? (
            <p>
              Estimated {summary.approach.minMinutes}–{summary.approach.maxMinutes} min over {summary.approach.km} km (
              {summary.approach.via}), from LTA speed bands.
            </p>
          ) : summary.ltaMinutes != null ? (
            <p>
              LTA estimated travel time: {summary.travel.from} to {summary.travel.to}.
            </p>
          ) : null}
          {summary.reading && (
            <p>
              {summary.bridge}: {summary.reading.detail}. {summary.reading.source}.
            </p>
          )}
          {summary.count != null && <p>{COUNT_NOTE}</p>}
          {summary.approach?.queueSpeedKmH != null && (
            <p>Last 1 km before the checkpoint: {summary.approach.queueSpeedKmH} km/h (LTA).</p>
          )}
          {rain && (
            <p>
              NEA forecast for {rain.area.name}: {rainForecast?.validPeriod.text}.
            </p>
          )}
          {air && <p>{air.detail}</p>}
        </div>
      </details>
    </div>
  );
}
