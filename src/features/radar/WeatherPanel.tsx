import { WeatherOutlook24h } from '../../components/WeatherOutlook24h';
import { RAIN_LEVEL_STYLE, describeCorridorRain } from '../../utils/rainForecast';
import { REGION_LABEL, pm25Band, psiBand, sgtHour } from '../../utils/airQuality';
import { sgtClock } from '../../utils/freshness';
import { HEAT_STYLE } from '../../utils/weatherAlerts';
import { floodLabel } from '../../utils/floodAlerts';
import { RadarReadings } from './useRadarReadings';
import { useRadarNavigation } from './useRadarNavigation';
type Props = {
  readings: Pick<
    RadarReadings,
    | 'rainForecast'
    | 'rainFeed'
    | 'airQuality'
    | 'weatherAlerts'
    | 'floodFeed'
    | 'floodAlerts'
    | 'lightningByCode'
    | 'floodsByCode'
    | 'rainByCode'
    | 'strikes'
  >;
  navigation: Pick<ReturnType<typeof useRadarNavigation>, 'corridors' | 'activeTab'>;
};
export function WeatherPanel({ readings, navigation }: Props) {
  const {
    rainForecast,
    rainFeed,
    airQuality,
    weatherAlerts,
    floodFeed,
    floodAlerts,
    lightningByCode,
    floodsByCode,
    rainByCode,
  } = readings;
  const { corridors, activeTab } = navigation;

  return (
    <section className={activeTab === 'weather' ? 'flex flex-col gap-6' : 'hidden'}>
      {/* Air quality first, then rain, floods, lightning and heat, and the 24-hour outlook */}
      {/* NEA air quality: 24-hour PSI and 1-hour PM2.5 per region */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA Air Quality</span>
            <h3 className="text-lg font-bold text-slate-900">PSI &amp; PM2.5 by Region</h3>
          </div>
          {airQuality && (
            <span className="text-xs text-slate-500 font-mono">
              {sgtHour(airQuality.psiTimestamp ?? airQuality.pm25Timestamp)} SGT reading
            </span>
          )}
        </div>
        {!airQuality ? (
          <div className="text-xs text-slate-400">Loading NEA air quality…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            {airQuality.regions.map((r) => {
              const psi = r.psi24h != null ? psiBand(r.psi24h) : null;
              const pm = r.pm25OneHour != null ? pm25Band(r.pm25OneHour) : null;
              return (
                <div key={r.name} className="p-3 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-2">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">{REGION_LABEL[r.name]}</div>
                  <div title="24-hour Pollutant Standards Index">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-bold font-mono text-slate-900">{r.psi24h ?? '—'}</span>
                      <span className="text-[10px] text-slate-500">PSI</span>
                    </div>
                    {psi && (
                      <div className={`flex items-center gap-1 font-semibold ${psi.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${psi.dot}`}></span>
                        {psi.label}
                      </div>
                    )}
                  </div>
                  <div className="pt-2 border-t border-slate-200/70" title="Latest 1-hour PM2.5 concentration">
                    <span className="font-mono font-bold text-slate-900">{r.pm25OneHour ?? '—'}</span>
                    <span className="text-[10px] text-slate-500"> µg/m³ PM2.5</span>
                    {pm && <div className={`font-semibold ${pm.text}`}>{pm.label}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          PSI is the 24-hour index (Good up to 50, Moderate 51–100, Unhealthy 101–200). PM2.5 is the latest 1-hour
          reading.
        </p>
      </div>

      {/* NEA 2-hour rain forecast along each expressway */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA 2-Hour Forecast</span>
            <h3 className="text-lg font-bold text-slate-900">Rain Along Each Expressway</h3>
          </div>
          {rainForecast && <span className="text-xs text-slate-500 font-mono">{rainForecast.validPeriod.text}</span>}
        </div>
        {Object.keys(rainByCode).length === 0 ? (
          <div className="text-xs text-slate-400">
            {rainFeed.status === 'loading' ? 'Loading NEA rain forecast…' : 'Rain forecast unavailable; retrying…'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {corridors.map((corridor) => {
              const rain = rainByCode[corridor.code];
              if (!rain) return null;
              return (
                <div
                  key={corridor.code}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                  title={rain.wetAreas.map((a) => `${a.name}: ${a.forecast}`).join('\n') || undefined}
                >
                  <span className={`material-symbols-outlined text-xl ${RAIN_LEVEL_STYLE[rain.level].className}`}>
                    {RAIN_LEVEL_STYLE[rain.level].icon}
                  </span>
                  <span className="font-extrabold font-mono text-slate-900 w-10 shrink-0">{corridor.code}</span>
                  <span className={`line-clamp-2 ${RAIN_LEVEL_STYLE[rain.level].className}`}>
                    {describeCorridorRain(rain)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PUB flood alerts, only while there are any */}
      {floodAlerts.length > 0 && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">PUB Flood Alerts</span>
              <h3 className="text-lg font-bold text-slate-900">Flash Floods</h3>
            </div>
            {floodFeed.data?.checkedAt && (
              <span className="text-xs text-slate-500 font-mono">checked {sgtHour(floodFeed.data.checkedAt)} SGT</span>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {floodAlerts.map((f) => {
              const codes = Object.keys(floodsByCode).filter((c) => floodsByCode[c].some((x) => x.id === f.id));
              return (
                <li
                  key={f.id}
                  className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sm flex items-start gap-3"
                >
                  <span className="material-symbols-outlined text-xl text-sky-700">flood</span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-semibold text-slate-900">
                      {floodLabel(f)}
                      {f.severity ? (
                        <span className="ml-2 text-[11px] font-bold uppercase text-sky-800">{f.severity}</span>
                      ) : null}
                    </span>
                    {f.description && <span className="text-xs text-slate-600">{f.description}</span>}
                    <span className="text-[11px] text-slate-500 font-mono">
                      from {sgtClock(Date.parse(f.startsAt))} SGT{codes.length ? ` • near ${codes.join(', ')}` : ''}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-slate-500">
            PUB alerts when water rises at a sensor. Avoid the area and never drive through flood water.
          </p>
        </div>
      )}

      {/* NEA lightning and heat stress */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA Observations</span>
            <h3 className="text-lg font-bold text-slate-900">Lightning &amp; Heat Stress</h3>
          </div>
          {weatherAlerts.data?.heatAt && (
            <span className="text-xs text-slate-500 font-mono">
              {sgtHour(weatherAlerts.data.lightningAt)} / {sgtHour(weatherAlerts.data.heatAt)} SGT
            </span>
          )}
        </div>
        {!weatherAlerts.data ? (
          <div className="text-xs text-slate-400">Loading NEA lightning and heat stress…</div>
        ) : (
          <>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-sm">
              <span
                className={`material-symbols-outlined text-xl ${Object.keys(lightningByCode).length ? 'text-violet-800' : 'text-slate-400'}`}
              >
                bolt
              </span>
              {weatherAlerts.data.strikes == null ? (
                <span className="text-slate-500">Lightning data unavailable.</span>
              ) : Object.keys(lightningByCode).length ? (
                <span className="text-violet-800">
                  <span className="font-semibold">Lightning near </span>
                  {Object.entries(lightningByCode)
                    .map(([code, n]) => `${code} (${n})`)
                    .join(', ')}
                  . Take extra care if you have to stop on the shoulder.
                </span>
              ) : (
                <span className="text-slate-600">
                  No lightning near the expressways in NEA's latest observation
                  {weatherAlerts.data.strikes.length ? ` (${weatherAlerts.data.strikes.length} strikes elsewhere)` : ''}
                  .
                </span>
              )}
            </div>

            {weatherAlerts.data.heatStations?.length ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
                  {[...weatherAlerts.data.heatStations]
                    .sort((a, b) => b.wbgt - a.wbgt)
                    .map((st) => {
                      const style = HEAT_STYLE[st.heatStress] || HEAT_STYLE.Low;
                      return (
                        <div
                          key={st.id}
                          className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-0.5"
                        >
                          <span className="text-slate-500 truncate" title={st.name}>
                            {st.name}
                          </span>
                          <span className="font-mono font-bold text-slate-900">{st.wbgt.toFixed(1)}°C</span>
                          <span className={`flex items-center gap-1 font-semibold ${style.text}`}>
                            <span className={`w-2 h-2 rounded-full ${style.dot}`}></span>
                            {st.heatStress || '—'}
                          </span>
                        </div>
                      );
                    })}
                </div>
                <p className="text-[11px] text-slate-500">
                  Heat stress is NEA's Wet Bulb Globe Temperature (WBGT): Low below 31°C, Moderate 31–33°C, High 33°C
                  and above. Worth knowing for roadside work, breakdowns and deliveries.
                </p>
              </div>
            ) : (
              <div className="text-xs text-slate-500">Heat stress data unavailable.</div>
            )}
          </>
        )}
      </div>

      {/* NEA 24-hour weather outlook */}
      <WeatherOutlook24h />
    </section>
  );
}
