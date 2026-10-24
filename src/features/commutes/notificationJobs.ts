import type { BackgroundQueue } from '../background/taskQueue';
import type { AlertDispatch } from './commuteAlertQueue';
import type { DeliveryOutcome } from './notificationDelivery';

/** Alert policy owns retries/expiry; the shared queue only bounds physical delivery concurrency. */
export function createNotificationJobs(queue: BackgroundQueue, owner: string,
  send: (title: string, body: string, signal: AbortSignal) => Promise<DeliveryOutcome>) {
  return async (title: string, body: string, context: AlertDispatch): Promise<DeliveryOutcome> => {
    if (context.signal.aborted) return 'failed';
    const handle = queue.enqueue({ lane: 'notifications', key: `${owner}:${context.key}`, expiresAt: context.expiresAt,
      run: signal => send(title, body, AbortSignal.any([signal, context.signal])) });
    const cancel = () => handle.cancel();
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel();
    try {
      const result = await handle.result;
      return result.state === 'done' ? result.value : 'failed';
    } finally { context.signal.removeEventListener('abort', cancel); }
  };
}
