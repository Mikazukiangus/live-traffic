import { ERP_EXPRESSWAY_GANTRIES, ErpExpresswayGantry } from '../data/erpRates';

import { EARLY_CLOSING_EVES, ERP_CALENDAR_YEARS, PUBLIC_HOLIDAYS } from '../data/erpCalendar';

export type GantryState = 'Charging' | 'Free now' | 'No charge' | 'Unverified';

export function erpCalendar(date: Date) {
  const day = new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  return { holiday: PUBLIC_HOLIDAYS[day] || null, earlyClosing: EARLY_CLOSING_EVES.has(day), known: ERP_CALENDAR_YEARS.includes(Number(day.slice(0, 4))) };
}

export const formatSgd = (amount: number) => `S$${amount.toFixed(2)}`;

/** Status notes contain upcoming base rates too; apply the chosen vehicle factor consistently. */
export const vehicleRateNote = (note: string, factor: number) =>
  note.replace(/S\$(\d+\.\d{2})/g, (_, amount: string) => formatSgd(Number(amount) * factor));

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

export function describe(gantry: ErpExpresswayGantry, isWeekday: boolean, hhmm: string, calendar?: ReturnType<typeof erpCalendar>): { state: GantryState; carRate: number; note: string } {
  const schedule = calendar?.earlyClosing
    ? gantry.weekdaySchedule.filter(([start]) => start < '13:00').map(([start, end, rate]) => [start, end > '13:00' ? '13:00' : end, rate] as [string, string, number])
    : gantry.weekdaySchedule;
  if (gantry.weekdaySchedule.length === 0) {
    return { state: 'No charge', carRate: 0, note: 'S$0.00 at all times' };
  }
  if (calendar?.holiday) return { state: 'Free now', carRate: 0, note: `${calendar.holiday} • no ERP today` };
  if (!isWeekday) return { state: 'Free now', carRate: 0, note: 'Weekends free' };
  if (calendar && !calendar.known) return { state: 'Unverified', carRate: 0, note: 'Holiday calendar needs updating' };
  if (calendar?.earlyClosing && hhmm >= '13:00') return { state: 'Free now', carRate: 0, note: 'Holiday eve • ERP ends at 13:00' };

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

export interface ErpSummary {
  // Gantries on these expressways charging right now (car rate)
  charging: { gantry: ErpExpresswayGantry; rate: number; note: string }[];
  // The next gantry on these expressways to start charging today, if none is charging
  next: { gantry: ErpExpresswayGantry; start: string; rate: number } | null;
  calendarKnown: boolean;
}

/** ERP on the given expressways at `date` (cars; gantries on each road, either direction). */
export function erpOn(codes: string[], date: Date): ErpSummary {
  const { isWeekday, hhmm } = singaporeNow(date);
  const calendar = erpCalendar(date);
  const gantries = ERP_EXPRESSWAY_GANTRIES.filter((g) => codes.includes(g.code) && g.weekdaySchedule.length);
  const charging = gantries
    .map((gantry) => ({ gantry, ...describe(gantry, isWeekday, hhmm, calendar) }))
    .filter((d) => d.state === 'Charging')
    .map(({ gantry, carRate, note }) => ({ gantry, rate: carRate, note }))
    .sort((a, b) => b.rate - a.rate);
  let next: ErpSummary['next'] = null;
  if (!charging.length && isWeekday && calendar.known && !calendar.holiday) {
    for (const gantry of gantries) {
      const slot = gantry.weekdaySchedule.find(([start]) => start > hhmm && (!calendar.earlyClosing || start < '13:00'));
      if (slot && (!next || slot[0] < next.start)) next = { gantry, start: slot[0], rate: slot[2] };
    }
  }
  return { charging, next, calendarKnown: calendar.known };
}
