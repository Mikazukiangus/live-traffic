import { createCommuteAlertQueue, type AlertCandidate } from '../features/commutes/commuteAlertQueue';
import { createNotificationJobs } from '../features/commutes/notificationJobs';
import { backgroundOwner, getBackgroundQueue } from '../features/background/browserQueue';
import { requestCommuteNotifications, sendCommuteNotification } from '../features/commutes/notificationDelivery';
export { notificationsSupported, requestCommuteNotifications } from '../features/commutes/notificationDelivery';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IncidentAlert } from '../types/traffic';

/**
 * Saved commutes ("My commute"), kept in this browser only. A commute is one or more legs, each a
 * stretch of one expressway in one direction between two of LTA's travel-time points.
 * KPE and MCE have no LTA points, so their legs cover the whole expressway.
 */

export type { Commute, CommuteLeg } from '../../shared/commutes/model';
export { MAX_COMMUTES, commuteRouteKey } from '../../shared/commutes/model';
import type { Commute } from '../../shared/commutes/model';
import { getCommuteRepository } from '../features/commutes/commuteStorage';

const subscribe = (fn: () => void) => getCommuteRepository().subscribe(fn);
const commutesSnapshot = () => getCommuteRepository().getSnapshot().commutes;
const noticeSnapshot = () => getCommuteRepository().getSnapshot().notice;
export const useCommutes = () => useSyncExternalStore(subscribe, commutesSnapshot);
export const useCommuteStorageNotice = () => useSyncExternalStore(subscribe, noticeSnapshot);
export const saveCommute = (commute: Commute) => getCommuteRepository().save(commute);
export const saveCommuteDetails = (id: string, name: string, legs: Commute['legs'], create = false) =>
  getCommuteRepository().saveDetails(id, name, legs, create);
export const setCommuteAlerts = (id: string, enabled: boolean) => getCommuteRepository().setAlerts(id, enabled);
export const deleteCommute = (id: string) => getCommuteRepository().remove(id);
export const commuteCodes = (commute: Commute) => [...new Set(commute.legs.map((l) => l.code))];

// ---- Alerts: a browser notification when a new incident appears on a commute with alerts on ----

/** Compatibility helper: permission errors always resolve to false. */
export async function enableNotifications(): Promise<boolean> {
  return (await requestCommuteNotifications()) === 'granted';
}

const incidentKey = (i: IncidentAlert) => `${i.id}|${i.type}`;

/**
 * Watches the LTA incident feed while the app is open (including in a background tab or the
 * installed app) and notifies about incidents that are new since the app opened.
 */
export function useCommuteAlerts(incidents: IncidentAlert[], status: string) {
  const list = useCommutes();
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useRef<ReturnType<typeof createCommuteAlertQueue> | null>(null);
  useEffect(() => {
    const current = createCommuteAlertQueue({
      send: createNotificationJobs(getBackgroundQueue(), backgroundOwner('notifications'),
        (title, body, signal) => sendCommuteNotification(title, body, undefined, signal)),
      now: Date.now, onNotice: setNotice,
      schedule: (run, ms) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); },
    });
    queue.current = current;
    return () => { current.dispose(); queue.current = null; };
  }, []);
  useEffect(() => {
    // Neither the initial failed request nor an offline copy establishes a live baseline.
    if (status !== 'live' && status !== 'error') return;
    const watched = list.filter(c => c.alerts);
    const candidates: AlertCandidate[] = incidents.flatMap(inc => {
      const commute = inc.corridorCode && watched.find(c => commuteCodes(c).includes(inc.corridorCode!));
      return commute ? [{ key: incidentKey(inc), title: `${inc.type} on ${inc.corridorCode} · ${commute.name}`,
        body: `${inc.location}${inc.lane ? ` · ${inc.lane}` : ''}` }] : [];
    });
    queue.current?.observe(incidents.map(incidentKey), candidates, status === 'live');
  }, [incidents, status, list]);
  return notice;
}
