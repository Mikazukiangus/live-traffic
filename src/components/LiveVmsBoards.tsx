import { buildVmsBoards, type VmsBoard, type LtaVmsSign } from '../features/cameras/vmsBoards';
import { GantryLocations } from '../features/cameras/GantryLocations';
import { useSpeedFeed } from '../features/traffic/useSpeedFeed';
import { config } from '../../config/client';
import React, { useMemo } from 'react';
import { EMAS_SIGNS } from '../data/demoData';

import { ForecastArea } from '../utils/rainForecast';
import { usePolledJson } from '../utils/usePolledJson';
import { useNow } from '../utils/freshness';

const SAMPLE_BOARD_COUNT = 6;
// LTA refreshes VMS messages about every 2 minutes.
const VMS_POLL_MS = config.poll.live;
// A sign further than this from any expressway link is labelled by equipment ID only.

// Gantries listed per board before "show all".

const NO_AREAS: ForecastArea[] = [];

export const LiveVmsBoards: React.FC<{ areas?: ForecastArea[] }> = ({ areas = NO_AREAS }) => {
  const feed = usePolledJson<{ value: LtaVmsSign[] }>('/api/vms', VMS_POLL_MS, (d) => Array.isArray(d?.value));
  const signs = feed.data?.value ?? null;
  const fetchedAt = feed.fetchedAt
    ? new Date(feed.fetchedAt).toLocaleTimeString('en-SG', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Singapore',
      }) + ' SGT'
    : '';
  const failed = feed.status === 'error';
  const now = useNow();
  const stale = failed || (feed.fetchedAt != null && now - feed.fetchedAt > 5 * 60_000);
  const segments = useSpeedFeed('geometry').geometry;

  const boards: VmsBoard[] = useMemo(() => {
    if (!signs) {
      return EMAS_SIGNS.slice(0, SAMPLE_BOARD_COUNT).map(({ line1, line2, ...rest }) => ({
        ...rest,
        lines: [line1, line2],
        locations: [],
      }));
    }
    return buildVmsBoards(signs, segments, areas, fetchedAt);
  }, [signs, segments, areas, fetchedAt]);

  const uniqueMessages = signs ? boards.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-500">traffic</span>
          <span>Expressway Message Signs</span>
        </h2>
        <span className="text-xs font-mono">
          {signs ? (
            <span className={stale ? 'text-amber-700' : 'text-emerald-700'}>
              {stale ? (failed ? 'Refresh failed • last received: ' : 'Outdated • last received: ') : ''}
              {uniqueMessages} {uniqueMessages === 1 ? 'message' : 'messages'} • {signs.length} signs
            </span>
          ) : failed ? (
            <span className="text-amber-700">Sample signs • LTA feed unavailable</span>
          ) : (
            <span className="text-slate-400">Loading…</span>
          )}
        </span>
      </div>

      {signs && boards.length === 0 && (
        <div className="p-6 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
          No messages are currently displayed on LTA expressway signs.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {boards.map((sign) => {
          const isCritical = sign.status === 'CRITICAL';
          const isWarning = sign.status === 'WARNING';
          const ledTextColor = isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-emerald-400';

          return (
            <div
              key={sign.id}
              className="fixed-palette bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col gap-3 relative overflow-hidden"
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

              <GantryLocations locations={sign.locations} />

              {/* Signboard footer status */}
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full animate-pulse ${signs && !stale ? 'bg-emerald-500' : 'bg-amber-400'}`}
                  ></span>
                  <span>{signs ? (stale ? 'Last received' : 'Live') : 'Sample'}</span>
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
