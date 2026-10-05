/**
 * Maps LTA DataMall TrafficIncidents records into IncidentAlert objects.
 *
 * LTA records only carry Type, Latitude, Longitude and Message, e.g.
 *   "(5/10)10:53 Vehicle Breakdown on KJE (towards PIE) after PIE(Changi). Avoid lane 3."
 * so the expressway, location, lane and time are parsed out of the message text.
 */
import { useCallback, useEffect, useState } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../data/mockData';
import { IncidentAlert } from '../types/traffic';

export const NON_EXPRESSWAY_CORRIDOR = 'Singapore Road Network';

export interface LtaIncidentRecord {
  Type?: string;
  Latitude?: number;
  Longitude?: number;
  Message?: string;
}

// LTA Type -> app incident type and severity
const LTA_TYPE_MAP: Record<string, { type: IncidentAlert['type']; severity: IncidentAlert['severity'] }> = {
  accident: { type: 'Accident', severity: 'Critical' },
  fire: { type: 'Other', severity: 'Critical' },
  'vehicle breakdown': { type: 'Breakdown', severity: 'Warning' },
  obstacle: { type: 'Obstacle', severity: 'Warning' },
  'unattended vehicle': { type: 'Obstacle', severity: 'Warning' },
  'road block': { type: 'Road Block', severity: 'Warning' },
  weather: { type: 'Flash Flood', severity: 'Warning' },
  'heavy traffic': { type: 'Heavy Congestion', severity: 'Info' },
  roadwork: { type: 'Roadwork', severity: 'Info' },
  diversion: { type: 'Diversion', severity: 'Info' },
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Codes ("PIE") and full names ("Central Expressway", "Kallang Paya Lebar Expressway") -> code
const EXPRESSWAY_PATTERN = new RegExp(
  `^(${EXPRESSWAY_CORRIDORS.flatMap((c) => [
    c.code,
    escapeRegex(c.name).replace(/[- ]+/g, '[-\\s]+'),
  ]).join('|')})\\b`,
  'i'
);

const codeFor = (match: string): string | undefined => {
  const norm = match.toLowerCase().replace(/[-\s]+/g, ' ');
  return EXPRESSWAY_CORRIDORS.find(
    (c) => c.code.toLowerCase() === norm || c.name.toLowerCase().replace(/[-\s]+/g, ' ') === norm
  )?.code;
};

// "(5/10)10:53" is day/month and Singapore time (UTC+8)
const parseTimestamp = (msg: string, now: Date): Date | null => {
  const m = msg.match(/^\((\d{1,2})\/(\d{1,2})\)(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, d, mo, h, mi] = m.map(Number);
  const build = (year: number) => new Date(Date.UTC(year, mo - 1, d, h - 8, mi));
  let t = build(now.getUTCFullYear());
  // A December report read in early January belongs to last year
  if (t.getTime() - now.getTime() > 24 * 3600 * 1000) t = build(now.getUTCFullYear() - 1);
  return t;
};

export const formatTimeAgo = (reported: Date | null, now: Date): string => {
  if (!reported) return 'Live (LTA Feed)';
  const mins = Math.max(0, Math.round((now.getTime() - reported.getTime()) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
};

export interface ParsedLtaIncident {
  corridorCode?: string;
  location: string;
  lane: string;
  reportedAt: Date | null;
}

export const parseLtaMessage = (message: string, now: Date = new Date()): ParsedLtaIncident => {
  const reportedAt = parseTimestamp(message, now);
  let body = message.replace(/^\(\d{1,2}\/\d{1,2}\)\d{1,2}:\d{2}\s*/, '').trim();

  // "Avoid lane 3." / "Avoid lanes 1 and 2." -> lane field
  let lane = 'Lane not specified';
  const laneMatch = body.match(/\.?\s*Avoid (lanes? [^.]+)\.?\s*$/i);
  if (laneMatch) {
    const lanes = laneMatch[1].replace(/^lanes?/i, '').trim();
    lane = `${/^lanes/i.test(laneMatch[1]) ? 'Lanes' : 'Lane'} ${lanes} affected`;
    body = body.slice(0, laneMatch.index).trim();
  }
  body = body.replace(/\.\s*$/, '');

  // Text after the first " on " / " at " is the road and position
  const onAt = body.match(/\s(?:on|at)\s+(.+)$/i);
  const roadPart = onAt ? onAt[1] : body;

  const exMatch = roadPart.match(EXPRESSWAY_PATTERN);
  if (!exMatch) {
    return { location: roadPart || 'Location not specified', lane, reportedAt };
  }

  // "(towards PIE) after PIE(Changi)" -> "towards PIE, after PIE(Changi)"
  const rest = roadPart
    .slice(exMatch[0].length)
    .trim()
    .replace(/^\(([^)]*)\)\s*/, (_, dir) => `${dir}, `)
    .replace(/,\s*$/, '');

  return {
    corridorCode: codeFor(exMatch[1]),
    location: rest || 'Along expressway',
    lane,
    reportedAt,
  };
};

const corridorName = (code?: string) =>
  EXPRESSWAY_CORRIDORS.find((c) => c.code === code)?.name || NON_EXPRESSWAY_CORRIDOR;

export const mapLtaIncident = (item: LtaIncidentRecord, idx: number, now: Date = new Date()): IncidentAlert => {
  const msg = item.Message || 'Incident reported';
  const parsed = parseLtaMessage(msg, now);
  const ltaType = (item.Type || '').trim();
  const { type, severity } = LTA_TYPE_MAP[ltaType.toLowerCase()] || { type: 'Other', severity: 'Info' };

  return {
    id: `lta-inc-${idx}-${item.Latitude ?? 0}-${item.Longitude ?? 0}`,
    corridor: corridorName(parsed.corridorCode),
    corridorCode: parsed.corridorCode,
    location: parsed.location,
    type,
    lane: parsed.lane,
    severity,
    timeAgo: formatTimeAgo(parsed.reportedAt, now),
    advice: msg,
  };
};

const SEVERITY_RANK: Record<IncidentAlert['severity'], number> = { Critical: 0, Warning: 1, Info: 2 };

// Most severe first; within a severity, expressway incidents before other roads.
export const sortBySeverity = (incidents: IncidentAlert[]) =>
  [...incidents].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(!a.corridorCode) - Number(!b.corridorCode)
  );

export const countByCorridor = (incidents: IncidentAlert[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const inc of incidents) {
    if (inc.corridorCode) counts[inc.corridorCode] = (counts[inc.corridorCode] || 0) + 1;
  }
  return counts;
};

export type IncidentFeedStatus = 'loading' | 'live' | 'error';

export interface IncidentFeed {
  incidents: IncidentAlert[];
  status: IncidentFeedStatus;
  // SGT time of the last successful fetch, e.g. "18:44"
  fetchedAt: string | null;
  refresh: () => Promise<void>;
}

// LTA updates incidents every couple of minutes; /api/traffic is CDN-cached for 30s.
const INCIDENT_POLL_MS = 60_000;

/**
 * Live LTA TrafficIncidents. No sample data: until the first response the list is empty
 * ("loading"), and an empty LTA response means there are no active incidents.
 * After a failed refresh the last live list is kept and status becomes "error".
 */
export function useLtaIncidents(): IncidentFeed {
  const [incidents, setIncidents] = useState<IncidentAlert[]>([]);
  const [status, setStatus] = useState<IncidentFeedStatus>('loading');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/traffic');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json?.value)) throw new Error('Unexpected incidents payload');
      const now = new Date();
      setIncidents(
        sortBySeverity(json.value.map((item: LtaIncidentRecord, idx: number) => mapLtaIncident(item, idx, now)))
      );
      setFetchedAt(
        now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
      );
      setStatus('live');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, INCIDENT_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { incidents, status, fetchedAt, refresh };
}
