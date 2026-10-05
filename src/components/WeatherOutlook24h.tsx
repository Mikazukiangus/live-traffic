import React, { useEffect, useState } from 'react';
import { RAIN_LEVEL_STYLE, rainLevel } from '../utils/rainForecast';

const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;
type Region = (typeof REGIONS)[number];

interface Forecast24h {
  issuedAt: string;
  general: {
    validPeriod: { text: string };
    forecast: string;
    temperature: { low: number; high: number };
    humidity: { low: number; high: number };
    wind: { direction: string; lowKmH: number; highKmH: number };
  };
  periods: { text: string; start: string; end: string; regions: Record<Region, string | null> }[];
}

// NEA reissues the 24-hour forecast a few times a day; the endpoint is CDN-cached for 15 minutes.
const POLL_MS = 15 * 60_000;

const ForecastText: React.FC<{ text: string }> = ({ text }) => {
  const level = rainLevel(text);
  const style = RAIN_LEVEL_STYLE[level];
  const icon = level === 'dry' && /night/i.test(text) ? 'partly_cloudy_night' : style.icon;
  return (
    <span className={`flex items-center gap-1 ${style.className}`}>
      <span className="material-symbols-outlined text-sm">{icon}</span>
      <span>{text}</span>
    </span>
  );
};

export const WeatherOutlook24h: React.FC = () => {
  const [forecast, setForecast] = useState<Forecast24h | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/forecast24h');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.general || !Array.isArray(json.periods)) throw new Error('Unexpected forecast payload');
        setForecast(json);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!forecast) {
    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs text-xs text-slate-500">
        {failed ? 'NEA 24-hour forecast unavailable.' : 'Loading NEA 24-hour forecast…'}
      </div>
    );
  }

  const { general, periods } = forecast;
  const issued = new Date(forecast.issuedAt).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA 24-Hour Outlook</span>
          <h3 className="text-lg font-bold text-slate-900">Expressway Weather • {general.validPeriod.text}</h3>
        </div>
        <span className="text-xs text-slate-500 font-mono">Issued {issued} SGT{failed ? ' • refresh failed' : ''}</span>
      </div>

      {/* Island-wide summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[10px] text-slate-400 font-semibold uppercase">Island-wide</div>
          <div className="mt-1 font-bold">
            <ForecastText text={general.forecast} />
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[10px] text-slate-400 font-semibold uppercase">Temperature</div>
          <div className="mt-1 font-mono font-bold text-slate-900">
            {general.temperature.low}–{general.temperature.high}°C
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[10px] text-slate-400 font-semibold uppercase">Humidity</div>
          <div className="mt-1 font-mono font-bold text-slate-900">
            {general.humidity.low}–{general.humidity.high}%
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[10px] text-slate-400 font-semibold uppercase">Wind</div>
          <div className="mt-1 font-mono font-bold text-slate-900">
            {general.wind.direction} {general.wind.lowKmH}–{general.wind.highKmH} km/h
          </div>
        </div>
      </div>

      {/* Regional forecast per period */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
              <th className="py-2 px-3">Region</th>
              {periods.map((p) => (
                <th key={p.start} className="py-2 px-3">
                  {p.text}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {REGIONS.map((region) => (
              <tr key={region}>
                <td className="py-2 px-3 font-semibold text-slate-900 capitalize">{region}</td>
                {periods.map((p) => (
                  <td key={p.start} className="py-2 px-3">
                    {p.regions[region] ? <ForecastText text={p.regions[region]!} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
