import React, { useEffect, useMemo, useState } from 'react';
import {
  ERP_EXPRESSWAY_GANTRIES,
  ERP_RATES_EFFECTIVE_DATE,
  ERP_RATES_SOURCE_URL,
  ERP_VEHICLE_FACTORS,
  ErpExpresswayGantry,
} from '../data/erpRates';
import { GantryState, describe, erpCalendar, formatSgd, singaporeNow, vehicleRateNote } from '../utils/erp';

interface GantryRow {
  gantry: ErpExpresswayGantry;
  state: GantryState;
  carRate: number;
  note: string;
  windows: string;
}

// Join back-to-back slots into operating windows, e.g. "07:00–10:00, 17:30–18:30".
function operatingWindows(gantry: ErpExpresswayGantry): string {
  const windows: [string, string][] = [];
  for (const [start, end] of gantry.weekdaySchedule) {
    const last = windows[windows.length - 1];
    if (last && last[1] === start) last[1] = end;
    else windows.push([start, end]);
  }
  return windows.map(([s, e]) => `${s}–${e}`).join(', ');
}

const STATE_ORDER: Record<GantryState, number> = { Charging: 0, 'Free now': 1, 'No charge': 2, Unverified: 3 };
const STATE_BADGE: Record<GantryState, string> = {
  Charging: 'bg-amber-100 text-amber-800',
  'Free now': 'bg-emerald-100 text-emerald-800',
  'No charge': 'bg-slate-100 text-slate-600',
  Unverified: 'bg-amber-100 text-amber-800',
};

type Vehicle = keyof typeof ERP_VEHICLE_FACTORS;
const VEHICLES: Record<Vehicle, string> = {
  car: 'Car / taxi / light goods',
  motorcycle: 'Motorcycle',
  heavyGoods: 'Heavy goods / small bus',
  veryHeavyGoods: 'Very heavy goods / big bus',
};

export const ErpRatesTable: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  const [vehicle, setVehicle] = useState<Vehicle>('car');
  const factor = ERP_VEHICLE_FACTORS[vehicle];

  // ERP rates change on 5-minute boundaries; re-evaluate every 30 seconds.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { weekday, isWeekday, hhmm } = singaporeNow(now);
  const calendar = erpCalendar(now);

  const rows: GantryRow[] = useMemo(
    () =>
      ERP_EXPRESSWAY_GANTRIES.map((gantry) => ({
        gantry,
        windows: operatingWindows(gantry) || '—',
        ...describe(gantry, isWeekday, hhmm, erpCalendar(now)),
      })).sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          b.carRate - a.carRate ||
          a.gantry.code.localeCompare(b.gantry.code)
      ),
    [now, isWeekday, hhmm]
  );

  const chargingCount = rows.filter((r) => r.state === 'Charging').length;
  const effective = new Date(`${ERP_RATES_EFFECTIVE_DATE}T00:00:00+08:00`).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  });

  return (
    <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">LTA Rate Schedule</span>
          <h3 className="text-lg font-bold text-slate-900">ERP Gantry Rates</h3>
          <p className="text-sm text-slate-500 mt-1">
            {weekday} {hhmm} SGT •{' '}
            <span className={chargingCount ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>
              {calendar.known ? `${chargingCount} of ${rows.length} expressway gantries charging now` : 'Holiday calendar needs updating'}
            </span>
          </p>
        </div>
        <a
          href={ERP_RATES_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 font-mono hover:text-sky-600 hover:underline"
          title="LTA base ERP rate table (PDF)"
        >
          LTA rates effective {effective}
        </a>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm font-semibold text-slate-700">
        <label htmlFor="erp-vehicle">Vehicle</label>
        <select id="erp-vehicle" value={vehicle} onChange={(event) => setVehicle(event.target.value as Vehicle)} className="h-11 max-w-full sm:w-72 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
          {(Object.entries(VEHICLES) as [Vehicle, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="md:hidden flex flex-col gap-3" aria-label="ERP gantry cards">
        {rows.map(({ gantry, state, carRate, note, windows }) => (
          <article key={gantry.gantryNos} className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-sky-700">{gantry.code}</span>
              <span className={`px-2 py-1 rounded text-xs font-bold ${STATE_BADGE[state]}`}>{state}</span>
            </div>
            <h4 className="text-sm font-semibold text-slate-900 leading-relaxed">{gantry.location}</h4>
            <div>
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{state === 'Unverified' ? '—' : formatSgd(carRate * factor)}</span>
              <span className="ml-2 text-xs text-slate-500">now · per pass</span>
              <p className="text-sm text-slate-500 mt-1">{vehicleRateNote(note, factor)}</p>
            </div>
            <details className="border-t border-slate-100 text-sm">
              <summary className="min-h-11 flex items-center gap-1 cursor-pointer text-slate-600 font-semibold">
                Hours & gantries <span className="material-symbols-outlined text-lg ml-auto" aria-hidden="true">expand_more</span>
              </summary>
              <p className="text-slate-600 leading-relaxed">Weekday hours (SGT): {windows === '—' ? 'No scheduled charges' : windows}</p>
              <p className="mt-2 text-xs text-slate-500">Gantry {gantry.gantryNos}</p>
            </details>
          </article>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">ERP rates for {VEHICLES[vehicle]}, {weekday} {hhmm} SGT</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
              <th className="py-2.5 px-3">Gantry Location</th>
              <th className="py-2.5 px-3">Expressway</th>
              <th className="py-2.5 px-3">{VEHICLES[vehicle]} · now</th>
              <th className="py-2.5 px-3">Weekday Charging Hours</th>
              <th className="py-2.5 px-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ gantry, state, carRate, note, windows }) => (
              <tr key={gantry.gantryNos} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-3">
                  <div className="font-semibold text-slate-900">{gantry.location}</div>
                  <div className="text-[11px] text-slate-400 font-mono">Gantry {gantry.gantryNos}</div>
                </td>
                <td className="py-3 px-3 text-slate-500 font-mono font-bold">{gantry.code}</td>
                <td className="py-3 px-3 font-mono font-bold text-slate-900">
                  {state === 'Unverified' ? '—' : formatSgd(carRate * factor)}
                </td>
                <td className="py-3 px-3 text-slate-600 font-mono">{windows}</td>
                <td className="py-3 px-3 text-right">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATE_BADGE[state]}`}>{state}</span>
                  <div className="text-xs text-slate-500 mt-1">{vehicleRateNote(note, factor)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Rates from LTA's published schedule, adjusted for your vehicle. Expressway ERP
        operates on weekdays, excluding public holidays. The 2026–2027 holiday calendar and 13:00 closure on designated holiday eves are applied. Temporary school-holiday rate reductions are not reflected.
      </p>
    </div>
  );
};
