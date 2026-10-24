import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Commute,
  commuteRouteKey,
  MAX_COMMUTES,
  useCommutes,
  useCommuteStorageNotice,
} from '../../utils/commutes';
import { MyCommuteProps } from './types';
import { CommuteCard } from './CommuteCard';
import { CommuteEditor } from './CommuteEditor';
import { summarizeCommute } from './summarizeCommute';
import { getCommuteRepository } from './commuteStorage';
import { createHistoryJobs } from './historyJobs';
import { backgroundOwner, getBackgroundQueue } from '../background/browserQueue';
export const MyCommute: React.FC<MyCommuteProps> = (props) => {
  const commutes = useCommutes();
  const storageNotice = useCommuteStorageNotice();
  const [editing, setEditing] = useState<Commute | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const repository = getCommuteRepository();
  const historyJobs = useRef<ReturnType<typeof createHistoryJobs> | null>(null);
  useEffect(() => {
    const jobs = createHistoryJobs(getBackgroundQueue(), backgroundOwner('history'), async rows => { await repository.recordBatch(rows); }, setHistoryNotice);
    historyJobs.current = jobs;
    return () => { jobs.dispose(); historyJobs.current = null; };
  }, [repository]);
  const {
    routes,
    estimateMinutes,
    incidents,
    roadWorks,
    rain,
    lightning,
    floods,
    travelStatus,
    travelFetchedAt,
  } = props;
  const readings = useMemo(
    () =>
      commutes.map((commute) => ({
        commute,
        summary: summarizeCommute(commute, {
          routes,
          estimateMinutes,
          incidents,
          roadWorks,
          rain,
          lightning,
          floods,
        }),
      })),
    [commutes, routes, estimateMinutes, incidents, roadWorks, rain, lightning, floods],
  );
  useEffect(() => {
    if (travelStatus !== 'live' || travelFetchedAt == null) return;
    historyJobs.current?.record(
      readings.flatMap(({ commute, summary }) =>
        summary.total == null || summary.anyEstimated
          ? []
          : [
              {
                id: commute.id,
                routeKey: commuteRouteKey(commute),
                minutes: summary.total,
                receivedAt: travelFetchedAt,
              },
            ],
      ),
    );
  }, [repository, readings, travelStatus, travelFetchedAt]);

  return (
    <section id="commute" aria-label="My commute" className="flex flex-col gap-3 scroll-mt-24">
      {(storageNotice || historyNotice) && (
        <p role="status" className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          {storageNotice || historyNotice}
        </p>
      )}
      {readings.map(({ commute, summary }) => (
        <CommuteCard
          key={commute.id}
          commute={commute}
          summary={summary}
          speeds={props.speeds}
          onShowOnMap={props.onShowOnMap}
          onEdit={() => setEditing(commute)}
        />
      ))}
      {commutes.length < MAX_COMMUTES && (
        <button
          onClick={() => setEditing({ id: `c${Date.now()}`, name: '', legs: [], alerts: false })}
          className="self-start h-9 px-3 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-white hover:border-sky-300 hover:text-sky-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">add_road</span>
          {commutes.length ? 'Add another commute' : 'Add my commute'}
        </button>
      )}
      {editing && <CommuteEditor initial={editing} routes={props.routes} onClose={() => setEditing(null)} />}
    </section>
  );
};
