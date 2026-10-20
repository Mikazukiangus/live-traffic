/** Browser-only commute data. Draft editor legs may be incomplete; saved legs must validate. */
export interface CommuteLeg {
  code: string;
  direction: number;
  from: string;
  to: string;
}
export interface Commute {
  id: string;
  name: string;
  legs: CommuteLeg[];
  alerts: boolean;
  routeRevision?: number;
}
export type Sample = [receivedAt: number, minutes: number];
export interface RouteHistory {
  commuteId: string;
  routeKey: string;
  samples: Sample[];
}
export const MAX_COMMUTES = 3;
export const MAX_LEGS = 4;
export const MAX_NAME_LENGTH = 40;
export const HISTORY_KEEP_MS = 3 * 60 * 60_000;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
export const isCommuteId = (v: unknown): v is string => text(v, 128) && v === v.trim();
export const isSample = (v: unknown): v is Sample =>
  Array.isArray(v) &&
  v.length === 2 &&
  Number.isSafeInteger(v[0]) &&
  v[0] >= 0 &&
  v[0] <= 8.64e15 &&
  typeof v[1] === 'number' &&
  Number.isFinite(v[1]) &&
  v[1] >= 0;

export function isCommute(value: unknown, codes: ReadonlySet<string>): value is Commute {
  return (
    record(value) &&
    isCommuteId(value.id) &&
    text(value.name, MAX_NAME_LENGTH) &&
    typeof value.alerts === 'boolean' &&
    (value.routeRevision === undefined ||
      (Number.isSafeInteger(value.routeRevision) &&
        Number(value.routeRevision) >= 0 &&
        Number(value.routeRevision) < Number.MAX_SAFE_INTEGER)) &&
    Array.isArray(value.legs) &&
    value.legs.length > 0 &&
    value.legs.length <= MAX_LEGS &&
    value.legs.every((leg: unknown) => {
      if (!record(leg) || typeof leg.code !== 'string' || !codes.has(leg.code)) return false;
      if (leg.code === 'KPE' || leg.code === 'MCE') return leg.direction === 0 && leg.from === '' && leg.to === '';
      return (
        (leg.direction === 1 || leg.direction === 2) &&
        text(leg.from, 200) &&
        text(leg.to, 200) &&
        normalizePoint(leg.from) !== normalizePoint(leg.to)
      );
    })
  );
}
const normalizePoint = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** Full canonical route description, without a collision-prone hash; ordered legs matter. */
export const commutePathKey = (commute: Pick<Commute, 'legs'>): string =>
  JSON.stringify(commute.legs.map((l) => [l.code, l.direction, normalizePoint(l.from), normalizePoint(l.to)]));
/** A revision survives partial history-write failures and prevents A-to-B-to-A resurrection. */
export const commuteRouteKey = (commute: Pick<Commute, 'legs' | 'routeRevision'>): string =>
  JSON.stringify([commute.routeRevision ?? 0, JSON.parse(commutePathKey(commute))]);

export interface Decoded<T> {
  value: T;
  writable: boolean;
  recovered: boolean;
}

/** Existing legacy arrays migrate on a later save; original storage is never overwritten. */
export function decodeCommutes(raw: string | null, codes: ReadonlySet<string>, legacy = false): Decoded<Commute[]> {
  if (raw === null) return { value: [], writable: true, recovered: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: [], writable: false, recovered: true };
  }
  const rows = legacy ? parsed : record(parsed) && parsed.schemaVersion === 1 ? parsed.commutes : null;
  if (!Array.isArray(rows)) return { value: [], writable: false, recovered: true };
  const ids = new Set<string>();
  const valid: Commute[] = [];
  for (const row of rows) {
    if (!isCommute(row, codes) || ids.has(row.id) || valid.length >= MAX_COMMUTES) continue;
    ids.add(row.id);
    valid.push({
      id: row.id,
      name: row.name.trim(),
      alerts: row.alerts,
      routeRevision: row.routeRevision ?? 0,
      legs: row.legs.map((l) => ({ code: l.code, direction: l.direction, from: l.from.trim(), to: l.to.trim() })),
    });
  }
  const recovered = valid.length !== rows.length;
  return { value: valid, writable: legacy || !recovered, recovered };
}

export function decodeHistories(raw: string | null): Decoded<RouteHistory[]> {
  if (raw === null) return { value: [], writable: true, recovered: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: [], writable: false, recovered: true };
  }
  if (!record(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.histories))
    return { value: [], writable: false, recovered: true };
  const ids = new Set<string>();
  const histories: RouteHistory[] = [];
  for (const h of parsed.histories) {
    if (
      !record(h) ||
      !isCommuteId(h.commuteId) ||
      ids.has(h.commuteId) ||
      !text(h.routeKey, 4096) ||
      !Array.isArray(h.samples) ||
      h.samples.length > 181 ||
      !h.samples.every(isSample)
    )
      continue;
    const samples = h.samples as Sample[];
    if (samples.some((sample, i) => i > 0 && sample[0] <= samples[i - 1][0])) continue;
    ids.add(h.commuteId);
    histories.push({ commuteId: h.commuteId, routeKey: h.routeKey, samples: h.samples.map((s) => [s[0], s[1]]) });
  }
  const recovered = histories.length !== parsed.histories.length;
  return { value: histories, writable: !recovered, recovered };
}
