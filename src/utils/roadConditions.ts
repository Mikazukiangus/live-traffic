import { usePolledJson } from './usePolledJson';

export interface RoadWork {
  id: string;
  code: string;
  road: string;
  start: string;
  end: string | null;
  by: string;
}

export interface FaultyLight {
  id: string;
  kind: string;
  since: string | null;
  message: string;
}

export interface RoadConditions {
  date: string;
  // null when that LTA feed failed
  roadWorks: RoadWork[] | null;
  faultyLights: FaultyLight[] | null;
}

/** Road works in progress on each expressway, and faulty traffic lights (LTA). */
export function useRoadConditions() {
  return usePolledJson<RoadConditions>('/api/live?feed=roadconditions', 5 * 60_000, (d) => !!d?.roadWorks && !!d.faultyLights, (d) => Array.isArray(d?.roadWorks) || Array.isArray(d?.faultyLights));
}

export const roadWorksByCode = (works: RoadWork[] | null | undefined) => {
  const byCode: Record<string, RoadWork[]> = {};
  for (const w of works || []) (byCode[w.code] ||= []).push(w);
  return byCode;
};

/** "9 Oct" from "2026-10-09" */
export const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00+08:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' }) : 'no end date';

/** "LTA" or "Private contractor" from LTA's service department names */
export const worksBy = (dept: string) => {
  if (/LAND TRANSPORT/i.test(dept)) return 'LTA';
  if (/^PRIVATE$/i.test(dept)) return 'Private contractor';
  return dept
    .split(/\s+-\s+|\s+\(/)[0]
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Pub|Sp|Jtc|Hdb|Ltd|Pte|M1)\b/gi, (m) => m.toUpperCase());
};
