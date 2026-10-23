import { config } from '../../../config/client';
import { withRequestDeadline } from '../../../shared/requestDeadline';

/** Abort the image request and detach handlers when the photo stalls. */
export function loadImage(url: string, timeoutMs = config.timeouts.request, createImage = () => new Image(), parent?: AbortSignal): Promise<HTMLImageElement> {
  return withRequestDeadline(timeoutMs, (signal) => new Promise((resolve, reject) => {
    const img = createImage();
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      img.removeAttribute('src');
      reject(signal.reason);
    };
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); reject(new Error('Camera image failed to load')); };
    signal.addEventListener('abort', cancel, { once: true });
    img.src = url;
  }), parent);
}
