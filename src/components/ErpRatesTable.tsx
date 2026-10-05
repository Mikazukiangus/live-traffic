import React, { useEffect, useMemo, useState } from 'react';
import {
  ERP_EXPRESSWAY_GANTRIES,
  ERP_RATES_EFFECTIVE_DATE,
  ERP_RATES_SOURCE_URL,
  ERP_VEHICLE_FACTORS,
  ErpExpresswayGantry,
} from '../data/erpRates';

type GantryState = 'Charging' | 'Free now' | 'No charge';

interface GantryRow {
  gantry: ErpExpresswayGantry;
  state: GantryState;
  carRate: number;
  note: string;
  windows: string;
}

const formatSgd = (amount: number) => `S$${amount.toFixed(2)}`;

// Current weekday and HH:MM in Singapore, regardless of the viewer's time zone.
export function singaporeNow(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday');
  return {
    weekday,
    isWeekday: !['Sat', 'Sun'].includes(weekday),
    hhmm: `${get('hour')}:${get('minute')}`,
  };
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

export function describe(gantry: ErpExpresswayGantry, isWeekday: boolean, hhmm: string): Omit<GantryRow, 'gantry' | 'windows'> {
  const schedule = gantry.weekdaySchedule;
  if (schedule.length === 0) {
    return { state: 'No charge', carRate: 0, note: 'S$0.00 at all times' };
  }
  if (!isWeekday) {
    return { state: 'Free now', carRate: 0, note: `Weekends free • next Mon ${schedule[0][0]}` };
  }

  // Zero-padded HH:MM strings compare correctly as text.
  const index = schedule.findIndex(([start, end]) => start <= hhmm && hhmm < end);
  if (index >= 0) {
    const [, end, amount] = schedule[index];
    const next = schedule[index + 1];
    const after = next && next[0] === end ? formatSgd(next[2]) : 'free';
    return { state: 'Charging', carRate: amount, note: `until ${end}, then ${after}` };
  }

  const upcoming = schedule.find(([start]) => start > hhmm);
  return {
    state: 'Free now',
    carRate: 0,
    note: upcoming ? `from ${upcoming[0]} at ${formatSgd(upcoming[2])}` : 'no more charges today',
  };
}

const STATE_ORDER: Record<GantryState, number> = { Charging: 0, 'Free now': 1, 'No charge': 2 };
const STATE_BADGE: Record<GantryState, string> = {
  Charging: 'bg-amber-100 text-amber-800',
  'Free now': 'bg-emerald-100 text-emerald-800',
  'No charge': 'bg-slate-100 text-slate-600',
};

export const ErpRatesTable: React.FC = () => {
  const [now, setNow] = useState(() => new Date());

  // ERP rates change on 5-minute boundaries; re-evaluate every 30 seconds.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { weekday, isWeekday, hhmm } = singaporeNow(now);

  const rows: GantryRow[] = useMemo(
    () =>
      ERP_EXPRESSWAY_GANTRIES.map((gantry) => ({
        gantry,
        windows: operatingWindows(gantry) || '—',
        ...describe(gantry, isWeekday, hhmm),
      })).sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          b.carRate - a.carRate ||
          a.gantry.code.localeCompare(b.gantry.code)
      ),
    [isWeekday, hhmm]
  );

  const chargingCount = rows.filter((r) => r.state === 'Charging').length;
  const effective = new Date(`${ERP_RATES_EFFECTIVE_DATE}T00:00:00+08:00`).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  });

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">LTA Rate Schedule</span>
          <h3 className="text-lg font-bold text-slate-900">Active Electronic Road Pricing (ERP) Gantry Rates</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {weekday} {hhmm} SGT •{' '}
            <span className={chargingCount ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>
              {chargingCount} of {rows.length} expressway gantries charging now
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

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
              <th className="py-2.5 px-3">Gantry Location</th>
              <th className="py-2.5 px-3">Expressway</th>
              <th className="py-2.5 px-3">Passenger Car / Taxi</th>
              <th className="py-2.5 px-3">Heavy Goods Vehicle</th>
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
                <td className="py-3 px-3 font-mono font-bold text-slate-900">{formatSgd(carRate)}</td>
                <td className="py-3 px-3 font-mono font-bold text-slate-900">
                  {formatSgd(carRate * ERP_VEHICLE_FACTORS.heavyGoods)}
                </td>
                <td className="py-3 px-3 text-slate-600 font-mono">{windows}</td>
                <td className="py-3 px-3 text-right">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATE_BADGE[state]}`}>{state}</span>
                  <div className="text-[10px] text-slate-400 mt-1">{note}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400">
        Base rates from LTA's published rate table; heavy goods vehicles pay 1.5× the base rate. Expressway ERP
        operates on weekdays only. Public holidays and any temporary school-holiday rate reductions are not reflected.
      </p>
    </div>
  );
};
