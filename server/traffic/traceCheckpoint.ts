import { BAND_SPEED_KMH, inBoothZone } from '../../shared/traffic/rules.ts';
import type { CheckpointApproach } from '../../shared/traffic/types.ts';
// Drive from the expressway to each land checkpoint towards Johor, Singapore side only.
// Each route is traced backwards along mainline links (RoadCategory 1) from the checkpoint end.
interface CheckpointRoute {
  id: 'woodlands' | 'tuas';
  name: string;
  via: string;
  road: string;
  heading: (l: RouteLink) => boolean; // links in the direction of travel
  endScore: (l: RouteLink) => number; // highest score = link reaching the checkpoint
  stop: (l: RouteLink) => boolean; // trace start reached
}

// [startLon, startLat, endLon, endLat, band]; band 0 = no reading
export type RouteLink = [number, number, number, number, number];

export const CHECKPOINT_ROUTES: CheckpointRoute[] = [
  {
    id: 'woodlands',
    name: 'Woodlands Checkpoint',
    via: 'BKE northbound from PIE, up to the checkpoint slip roads',
    road: 'BUKIT TIMAH EXPRESSWAY',
    heading: (l) => l[3] > l[1],
    endScore: (l) => l[3],
    stop: () => false, // whole BKE
  },
  {
    id: 'tuas',
    name: 'Tuas Checkpoint',
    via: 'last 6 km of AYE westbound, up to the booths',
    road: 'AYER RAJAH EXPRESSWAY',
    heading: (l) => l[2] < l[0],
    endScore: (l) => -l[2],
    stop: (l) => l[0] > 103.68,
  },
];

// Near the checkpoint, report the average speed over this distance as the queue reading.
const QUEUE_KM = 1;

const linkKm = (l: RouteLink) =>
  Math.hypot((l[1] - l[3]) * 111.32, (l[0] - l[2]) * 111.32 * Math.cos((1.35 * Math.PI) / 180));
const linkHeading = (l: RouteLink) => Math.atan2(l[3] - l[1], (l[2] - l[0]) * Math.cos((1.35 * Math.PI) / 180));
const pointKey = (lon: number, lat: number) => `${lon.toFixed(4)},${lat.toFixed(4)}`;

export function traceCheckpoint(route: CheckpointRoute, allLinks: RouteLink[]): CheckpointApproach | null {
  const links = allLinks.filter((l) => !inBoothZone((l[1] + l[3]) / 2, (l[0] + l[2]) / 2));
  const candidates = links.filter(route.heading);
  if (candidates.length === 0) return null;
  const byEnd = new Map<string, RouteLink[]>();
  for (const l of links) {
    const k = pointKey(l[2], l[3]);
    byEnd.set(k, [...(byEnd.get(k) || []), l]);
  }

  // Walk back from the checkpoint; at merges follow the link heading most like the current one.
  let current = candidates.reduce((a, b) => (route.endScore(b) > route.endScore(a) ? b : a));
  const path = [current];
  const seen = new Set([current]);
  while (!route.stop(current)) {
    const preds = (byEnd.get(pointKey(current[0], current[1])) || []).filter((p) => !seen.has(p));
    if (preds.length === 0) break;
    const h = linkHeading(current);
    const turn = (p: RouteLink) => Math.abs(Math.atan2(Math.sin(linkHeading(p) - h), Math.cos(linkHeading(p) - h)));
    current = preds.reduce((a, b) => (turn(b) < turn(a) ? b : a));
    seen.add(current);
    path.push(current);
  }

  let km = 0,
    knownKm = 0,
    typical = 0,
    fast = 0,
    slow = 0;
  let queueKm = 0,
    queueHours = 0;
  for (const l of path) {
    const len = linkKm(l);
    km += len;
    const band = l[4];
    if (!BAND_SPEED_KMH[band]) continue;
    knownKm += len;
    typical += len / BAND_SPEED_KMH[band];
    fast += len / (band === 8 ? 90 : band * 10);
    slow += len / (band === 8 ? 70 : Math.max(5, (band - 1) * 10));
    // path[0] touches the checkpoint, so the first links walked make up the queue stretch
    if (queueKm < QUEUE_KM) {
      queueKm += len;
      queueHours += len / BAND_SPEED_KMH[band];
    }
  }
  if (knownKm < km * 0.7) return null; // too many links without a reading
  const scale = km / knownKm; // links without a reading are assumed to move at the average pace
  const toMinutes = (hours: number) => Math.round(hours * scale * 60);
  return {
    id: route.id,
    name: route.name,
    via: route.via,
    km: Math.round(km * 10) / 10,
    minutes: toMinutes(typical),
    minMinutes: toMinutes(fast),
    maxMinutes: toMinutes(slow),
    queueSpeedKmH: queueHours > 0 ? Math.round(queueKm / queueHours) : null,
  };
}
