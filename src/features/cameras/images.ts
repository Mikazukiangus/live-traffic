import { IMAGE_PROXY_HOSTS } from '../../../config/policy';
const PROXIED_IMAGE_HOSTS = IMAGE_PROXY_HOSTS.map((host) => `https://${host}/`);
export const getResolvedCameraUrl = (url: string): string =>
  PROXIED_IMAGE_HOSTS.some((h) => url.startsWith(h)) ? `/api/imageproxy?url=${encodeURIComponent(url)}` : url;

export const formatSgt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });

export const captureAge = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? 'just now' : `${mins} min ago`;
};
