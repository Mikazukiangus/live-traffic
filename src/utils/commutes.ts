import { useEffect, useRef, useSyncExternalStore } from 'react';
import { IncidentAlert } from '../types/traffic';

/**
 * Saved commutes ("My commute"), kept in this browser only. A commute is one or more legs, each a
 * stretch of one expressway in one direction between two of LTA's travel-time points.
 * KPE and MCE have no LTA points, so their legs cover the whole expressway.
 */

export interface CommuteLeg {
  code: string;
  // LTA direction (1 or 2); 0 for KPE/MCE, which LTA doesn't publish
  direction: number;
  from: string;
  to: string;
}

export interface Commute {
  id: string;
  name: string;
  legs: CommuteLeg[];
  alerts: boolean;
}

const KEY = 'trafficpulse.commutes';
export const MAX_COMMUTES = 3;

const read = (): Commute[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

let commutes: Commute[] = read();
const listeners = new Set<() => void>();
const write = (next: Commute[]) => {
  commutes = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked; commutes last until the page closes
  }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useCommutes = () => useSyncExternalStore(subscribe, () => commutes);

export const saveCommute = (c: Commute) =>
  write(commutes.some((x) => x.id === c.id) ? commutes.map((x) => (x.id === c.id ? c : x)) : [...commutes, c].slice(0, MAX_COMMUTES));
export const deleteCommute = (id: string) => write(commutes.filter((c) => c.id !== id));
export const commuteCodes = (c: Commute) => [...new Set(c.legs.map((l) => l.code))];

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
const incidentKey = (i: IncidentAlert) => `${i.id.replace(/^lta-inc-\d+-/, '')}|${i.type}`;

async function notify(title: string, body: string) {
  const options = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: title, data: { url: '/?page=radar&tab=incidents' } };
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
        if (commute) notify(`${inc.type} on ${inc.corridorCode} · ${commute.name}`, `${inc.location}${inc.lane ? ` · ${inc.lane}` : ''}`);
      });
    }
    keys.forEach((k) => seen.current!.add(k));
  }, [incidents, status, list]);
}
