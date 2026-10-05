import React, { useEffect, useMemo, useState } from 'react';
import { EMAS_SIGNS, EXPRESSWAY_CORRIDORS } from '../data/mockData';
import { EmasVariableMessageSign } from '../types/traffic';
import type { SpeedSegment } from './SpeedBandMap';

const SAMPLE_BOARD_COUNT = 6;
// LTA refreshes VMS messages about every 2 minutes.
const VMS_POLL_MS = 60_000;
// A sign further than this from any expressway link is labelled by equipment ID only.
const MAX_MATCH_METRES = 300;

interface LtaVmsSign {
  EquipmentID: string;
  Latitude: number;
  Longitude: number;
  Message: string;
}

interface VmsBoard extends Omit<EmasVariableMessageSign, 'line1' | 'line2'> {
  lines: string[];
}

const EXPRESSWAY_NAMES: Record<string, string> = Object.fromEntries(
  EXPRESSWAY_CORRIDORS.map((c) => [c.code, c.name])
);

function classify(message: string): EmasVariableMessageSign['status'] {
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
function groupByMessage(signs: LtaVmsSign[]): LtaVmsSign[][] {
  const byMessage = new Map<string, LtaVmsSign[]>();
  for (const s of signs) {
    if (!s.Message?.replace(/,/g, '').trim()) continue;
    if (!byMessage.has(s.Message)) byMessage.set(s.Message, []);
    byMessage.get(s.Message)!.push(s);
  }
  const severityRank = { CRITICAL: 0, WARNING: 1, ADVISORY: 2, NORMAL: 3 };
  return [...byMessage.values()]
    .sort(
      (a, b) =>
        severityRank[classify(a[0].Message)] - severityRank[classify(b[0].Message)] || b.length - a.length
    );
}

export const LiveVmsBoards: React.FC = () => {
  const [signs, setSigns] = useState<LtaVmsSign[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const [segments, setSegments] = useState<SpeedSegment[]>([]);

  useEffect(() => {
    const loadSigns = async () => {
      try {
        const res = await fetch('/api/vms');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.value)) throw new Error('Unexpected VMS payload');
        setSigns(json.value);
        setFetchedAt(new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    };
    loadSigns();
    const interval = setInterval(loadSigns, VMS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // Expressway geometry (shared, CDN-cached speed band links) to name each sign's road.
  useEffect(() => {
    fetch('/api/expresswayspeeds?include=segments')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => Array.isArray(json?.segments) && setSegments(json.segments))
      .catch(() => undefined);
  }, []);

  const boards: VmsBoard[] = useMemo(() => {
    if (!signs) {
      return EMAS_SIGNS.slice(0, SAMPLE_BOARD_COUNT).map(({ line1, line2, ...rest }) => ({ ...rest, lines: [line1, line2] }));
    }
    return groupByMessage(signs).map((group) => {
      const message = group[0].Message;
      const codes = segments.length
        ? [...new Set(group.map((s) => nearestExpressway(s.Latitude, s.Longitude, segments)).filter(Boolean))]
        : [];
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
        lines: message.split(',').map((l) => l.trim()).filter(Boolean),
        status: classify(message),
        updatedAt: fetchedAt ? `Fetched ${fetchedAt}` : '',
      };
    });
  }, [signs, segments, fetchedAt]);

  const uniqueMessages = signs ? boards.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-500">traffic</span>
          <span>Live Expressway Variable Message Signboards (VMS)</span>
        </h2>
        <span className="text-xs font-mono">
          {signs ? (
            <span className="text-emerald-700">
              LTA DataMall • {uniqueMessages} unique {uniqueMessages === 1 ? 'message' : 'messages'} across{' '}
              {signs.length} signs
            </span>
          ) : failed ? (
            <span className="text-amber-700">Sample signs • LTA VMS feed unavailable</span>
          ) : (
            <span className="text-slate-400">Loading live LTA signs…</span>
          )}
        </span>
      </div>

      {signs && boards.length === 0 && (
        <div className="p-6 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
          No messages are currently displayed on LTA expressway signs.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {boards.map((sign) => {
          const isCritical = sign.status === 'CRITICAL';
          const isWarning = sign.status === 'WARNING';
          const ledTextColor = isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-emerald-400';

          return (
            <div
              key={sign.id}
              className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col gap-3 relative overflow-hidden"
            >
              {/* Header of signboard */}
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 border-b border-slate-800/80 pb-2">
                <span className="font-bold uppercase tracking-wider text-slate-300 truncate" title={sign.corridor}>
                  {sign.corridor}
                </span>
                <span className="font-mono text-slate-500 shrink-0">{sign.marker}</span>
              </div>

              {/* Amber/Red LED Display Area */}
              <div className="bg-black/95 p-3 rounded-lg border border-slate-800 font-mono tracking-widest text-center flex flex-col justify-center gap-1 shadow-inner min-h-[5.5rem]">
                {sign.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`text-xs sm:text-sm font-bold ${ledTextColor} drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]`}
                  >
                    {line}
                  </div>
                ))}
              </div>

              {/* Signboard footer status */}
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full animate-pulse ${signs ? 'bg-emerald-500' : 'bg-amber-400'}`}
                  ></span>
                  <span>{signs ? 'Live LTA message' : 'Sample message'}</span>
                </span>
                <span className="font-mono text-slate-500">{sign.updatedAt}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
