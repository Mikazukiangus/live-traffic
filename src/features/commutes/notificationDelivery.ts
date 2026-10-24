import { reportNotificationFailure } from '../../../shared/applicationDiagnostics';

export type PermissionOutcome = 'granted' | 'denied' | 'dismissed' | 'unsupported' | 'failed';
export type DeliveryOutcome = 'sent' | 'blocked' | 'unsupported' | 'failed';
export interface NotificationPort {
  supported: () => boolean;
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  worker: () => Promise<Pick<ServiceWorkerRegistration, 'showNotification'> | undefined>;
  show: (title: string, options: NotificationOptions) => void;
}
const browser: NotificationPort = {
  supported: () => typeof window !== 'undefined' && 'Notification' in window,
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  worker: async () => navigator.serviceWorker?.getRegistration(),
  show: (title, options) => { new Notification(title, options); },
};
export const notificationsSupported = () => browser.supported();

/** Permission denial/dismissal is an outcome, not an unhandled click-handler rejection. */
export async function requestCommuteNotifications(port = browser): Promise<PermissionOutcome> {
  try {
    if (!port.supported()) return 'unsupported';
    const current = port.permission();
    const permission = current === 'default' ? await port.requestPermission() : current;
    return permission === 'default' ? 'dismissed' : permission;
  } catch {
    reportNotificationFailure('permission');
    return 'failed';
  }
}

/** 'sent' means the browser accepted it, not proof that the OS displayed it or a person read it. */
export async function sendCommuteNotification(title: string, body: string, port = browser, signal?: AbortSignal): Promise<DeliveryOutcome> {
  try {
    if (signal?.aborted) return 'failed';
    if (!port.supported()) return 'unsupported';
    if (port.permission() !== 'granted') return 'blocked';
    const options: NotificationOptions = {
      body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: title,
      data: { url: '/?page=radar&tab=incidents' },
    };
    try {
      const registration = await port.worker();
      if (signal?.aborted) return 'failed';
      if (port.permission() !== 'granted') return 'blocked';
      if (registration) {
        await registration.showNotification(title, options);
        return 'sent';
      }
    } catch {
      // Desktop may still support the constructor; both paths have their own rejection handler.
    }
    if (signal?.aborted) return 'failed';
    if (port.permission() !== 'granted') return 'blocked';
    port.show(title, options);
    return 'sent';
  } catch {
    reportNotificationFailure('delivery');
    return 'failed';
  }
}

export const PERMISSION_NOTICE: Record<Exclude<PermissionOutcome, 'granted'>, string> = {
  denied: 'Notifications are blocked. Allow them in your browser settings to get commute alerts.',
  dismissed: 'Notifications weren’t enabled. Tap the bell to try again.',
  unsupported: 'Commute notifications aren’t supported in this browser.',
  failed: 'Notifications couldn’t be enabled. Please try again.',
};
