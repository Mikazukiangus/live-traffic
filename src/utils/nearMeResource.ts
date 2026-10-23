export type NearMeStatus = 'idle' | 'locating' | 'found' | 'denied' | 'unavailable';
export interface NearMeState { status: NearMeStatus; lat?: number; lon?: number; at?: number }
interface Ports {
  locate: (success: PositionCallback, failure: PositionErrorCallback) => void;
  optedIn: () => boolean;
  remember: (enabled: boolean) => void;
  permission: () => Promise<boolean>;
  now: () => number;
}

/** Only the newest location request may commit coordinates or the opt-in preference. */
export function createNearMeResource(ports: Ports) {
  let state: NearMeState = { status: 'idle' };
  let generation = 0;
  let resumed = false;
  const listeners = new Set<() => void>();
  const publish = (next: NearMeState) => { state = next; listeners.forEach(fn => fn()); };
  const locate = () => {
    const ticket = ++generation;
    publish({ ...state, status: 'locating' });
    // A subscriber may synchronously initiate a newer request.
    if (ticket !== generation) return;
    const commit = (next: NearMeState, remember?: boolean) => {
      if (ticket !== generation) return;
      // Commit preference before notifying observers, which can start newer work.
      if (remember !== undefined) { try { ports.remember(remember); } catch { /* Optional preference. */ } }
      publish(next);
    };
    try {
      ports.locate(
        pos => commit({ status: 'found', lat: pos.coords.latitude, lon: pos.coords.longitude, at: ports.now() }, true),
        err => commit({ status: err.code === 1 ? 'denied' : 'unavailable' }, err.code === 1 ? false : undefined),
      );
    } catch { commit({ status: 'unavailable' }); }
  };
  return {
    locate,
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async resume() {
      if (resumed) return;
      resumed = true;
      const ticket = generation;
      try {
        if (ports.optedIn() && await ports.permission() && ticket === generation) locate();
      } catch { /* Permission/storage unavailable: wait for an explicit tap. */ }
    },
  };
}
