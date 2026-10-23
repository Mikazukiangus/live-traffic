import React, { useEffect, useMemo, useState } from 'react';
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
export const MyCommute: React.FC<MyCommuteProps> = (props) => {
  const commutes = useCommutes();
  const storageNotice = useCommuteStorageNotice();
  const [editing, setEditing] = useState<Commute | null>(null);
  const repository = getCommuteRepository();
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
    void repository.recordBatch(
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
    ).catch(() => { /* User-facing storage notices are published by the repository. */ });
  }, [repository, readings, travelStatus, travelFetchedAt]);

  return (
    <section id="commute" aria-label="My commute" className="flex flex-col gap-3 scroll-mt-24">
      {storageNotice && (
        <p role="status" className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          {storageNotice}
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
