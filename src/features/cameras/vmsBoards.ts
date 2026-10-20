import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { EmasVariableMessageSign } from '../../types/traffic';
import type { SpeedSegment } from '../../../shared/traffic/types';
import { ForecastArea, nearestArea } from '../../utils/rainForecast';

const MAX_MATCH_METRES = 300;
export interface LtaVmsSign {
  EquipmentID: string;
  Latitude: number;
  Longitude: number;
  Message: string;
}

export interface GantryLocation {
  id: string;
  code: string | null;
  area: string | null;
  lat: number;
  lon: number;
}

export interface VmsBoard extends Omit<EmasVariableMessageSign, 'line1' | 'line2'> {
  lines: string[];
  locations: GantryLocation[];
}

const EXPRESSWAY_NAMES: Record<string, string> = Object.fromEntries(EXPRESSWAY_CORRIDORS.map((c) => [c.code, c.name]));

export function classify(message: string): EmasVariableMessageSign['status'] {
  const m = message.toUpperCase();
  if (/ACCIDENT|CLOSED|CLOSURE|FLOOD|FIRE/.test(m)) return 'CRITICAL';
  if (/BREAKDOWN|JAM|CONGEST|HEAVY|ROAD ?WORK|LANE|OBSTACLE|SLOW|QUEUE/.test(m)) return 'WARNING';
  if (/DRIVE|SPEED|KEEP|STOP|CAMERA/.test(m)) return 'ADVISORY';
  return 'NORMAL';
}

// Equirectangular metres; fine at Singapore's latitude for a nearest-road lookup.
function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dy = (lat1 - lat2) * 111_320;
  const dx = (lon1 - lon2) * 111_320 * Math.cos((1.35 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function nearestExpressway(lat: number, lon: number, segments: SpeedSegment[]): string | null {
  let best: { code: string; d: number } | null = null;
  for (const [code, , sLon, sLat, eLon, eLat] of segments) {
    const d = Math.min(distanceMetres(lat, lon, sLat, sLon), distanceMetres(lat, lon, eLat, eLon));
    if (!best || d < best.d) best = { code, d };
  }
  return best && best.d <= MAX_MATCH_METRES ? best.code : null;
}

// Many gantries carry the same message, so show each distinct message once:
// most severe first, then the most widely displayed. Blank signs are skipped.
export function groupByMessage(signs: LtaVmsSign[]): LtaVmsSign[][] {
  const byMessage = new Map<string, LtaVmsSign[]>();
  for (const s of signs) {
    if (!s.Message?.replace(/,/g, '').trim()) continue;
    if (!byMessage.has(s.Message)) byMessage.set(s.Message, []);
    byMessage.get(s.Message)!.push(s);
  }
  const severityRank = { CRITICAL: 0, WARNING: 1, ADVISORY: 2, NORMAL: 3 };
  return [...byMessage.values()].sort(
    (a, b) => severityRank[classify(a[0].Message)] - severityRank[classify(b[0].Message)] || b.length - a.length,
  );
}

export function buildVmsBoards(
  signs: LtaVmsSign[],
  segments: SpeedSegment[],
  areas: ForecastArea[],
  fetchedAt: string,
): VmsBoard[] {
  return groupByMessage(signs).map((group) => {
    const message = group[0].Message;
    const locations: GantryLocation[] = group.map((s) => ({
      id: s.EquipmentID,
      code: segments.length ? nearestExpressway(s.Latitude, s.Longitude, segments) : null,
      area: nearestArea(s.Latitude, s.Longitude, areas)?.name ?? null,
      lat: s.Latitude,
      lon: s.Longitude,
    }));
    const codes = [...new Set(locations.map((l) => l.code).filter(Boolean))];
    const corridor =
      codes.length === 1
        ? `${codes[0]} • ${EXPRESSWAY_NAMES[codes[0]!] || codes[0]}`
        : codes.length > 1
          ? codes.join(' / ')
          : 'LTA Gantry';
    return {
      id: message,
      corridor,
      marker: group.length === 1 ? group[0].EquipmentID : `${group.length} gantries`,
      lines: message
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      status: classify(message),
      updatedAt: fetchedAt,
      locations,
    };
  });
}
