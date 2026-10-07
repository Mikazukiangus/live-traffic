import { useEffect, useState } from 'react';

/**
 * Page, tab and camera live in the query string (?page=radar&tab=weather, ?page=cameras&cam=2701)
 * so every view can be bookmarked or shared, and Back/Forward move between them.
 * Query parameters need no server rewrites, so /api routing on Vercel is untouched.
 */

const URL_CHANGE = 'trafficpulse:urlchange';

export const readParam = (key: string) => new URLSearchParams(window.location.search).get(key);

/** Set or remove (null) query parameters. `push` adds a history entry; otherwise the current one is replaced. */
export function writeParams(changes: Record<string, string | null>, push = false) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event(URL_CHANGE));
}

/** One query parameter, kept in step with Back/Forward and with other writers. */
export function useUrlParam(key: string): [string | null, (value: string | null, push?: boolean) => void] {
  const [value, setValue] = useState(() => readParam(key));

  useEffect(() => {
    const sync = () => setValue(readParam(key));
    window.addEventListener('popstate', sync);
    window.addEventListener(URL_CHANGE, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(URL_CHANGE, sync);
    };
  }, [key]);

  const set = (next: string | null, push = true) => writeParams({ [key]: next }, push);
  return [value, set];
}
