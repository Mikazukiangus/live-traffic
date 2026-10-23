/** Reserve ownership before running work or notifying observers, including synchronous re-entry. */
export function createSingleFlight<T>(onSettled?: () => void) {
  let pending: Promise<T> | null = null;
  return {
    get current() { return pending; },
    run(work: () => T | PromiseLike<T>): Promise<T> {
      if (pending) return pending;
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason: unknown) => void;
      const task = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      pending = task;
      const settle = (ok: boolean, value: unknown) => {
        if (pending === task) pending = null;
        try { onSettled?.(); } catch (error) { reject(error); return; }
        if (ok) resolve(value as T); else reject(value);
      };
      try { Promise.resolve(work()).then(value => settle(true, value), error => settle(false, error)); }
      catch (error) { settle(false, error); }
      return task;
    },
  };
}
