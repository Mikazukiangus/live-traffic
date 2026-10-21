import { useEffect, useRef, useSyncExternalStore } from 'react';
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
export const deleteCommute = (id: string) => getCommuteRepository().remove(id);
export const commuteCodes = (commute: Commute) => [...new Set(commute.legs.map((l) => l.code))];

// ---- Alerts: a browser notification when a new incident appears on a commute with alerts on ----

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Asks for notification permission; true if granted. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

// LTA incident ids start with the record's position in the feed, which shifts; the rest is its location.
const incidentKey = (i: IncidentAlert) => `${i.id}|${i.type}`;

async function notify(title: string, body: string) {
  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: title,
    data: { url: '/?page=radar&tab=incidents' },
  };
  try {
    // Through the service worker where there is one (required on Android), else directly.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, options);
  } catch {
    // Fall through
  }
  new Notification(title, options);
}

/**
 * Watches the LTA incident feed while the app is open (including in a background tab or the
 * installed app) and notifies about incidents that are new since the app opened.
 */
export function useCommuteAlerts(incidents: IncidentAlert[], status: string) {
  const list = useCommutes();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (status !== 'live' && status !== 'error') return;
    const keys = incidents.map(incidentKey);
    // The first answer is the baseline: only incidents that appear after it are new.
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const watched = list.filter((c) => c.alerts);
    if (watched.length && notificationsSupported() && Notification.permission === 'granted') {
      incidents.forEach((inc, i) => {
        if (seen.current!.has(keys[i]) || !inc.corridorCode) return;
        const commute = watched.find((c) => commuteCodes(c).includes(inc.corridorCode!));
        if (commute)
          notify(
            `${inc.type} on ${inc.corridorCode} · ${commute.name}`,
            `${inc.location}${inc.lane ? ` · ${inc.lane}` : ''}`,
          );
      });
    }
    keys.forEach((k) => seen.current!.add(k));
  }, [incidents, status, list]);
}
