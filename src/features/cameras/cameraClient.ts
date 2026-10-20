import { config } from '../../../config/client';
import { normalizeCameraFeed } from './normalizeCameraFeed';

export async function fetchCameras() {
  let source = 'LTA Traffic Images';
  let rawCameras: any[] = [];
  let captureTimestamp = '';
  let offlineCameraCopy = false;

  // 1. Try our internal serverless API route which proxies LTA DataMall or Data.gov.sg
  try {
    const res = await fetch('/api/trafficimages');
    if (res.ok) {
      const json = await res.json();
      rawCameras = json?.cameras || [];
      offlineCameraCopy = res.headers.get('X-TrafficPulse-Offline') === '1';
      captureTimestamp = json?.timestamp || '';
      source = json?.source === 'lta_datamall_v2' ? 'LTA DataMall Traffic Images' : 'Data.gov.sg Traffic Images';
    }
  } catch {
    // Fall back to the public Data.gov.sg endpoint below
  }

  // 2. Direct fallback to Data.gov.sg open endpoint if needed
  if (!rawCameras || rawCameras.length === 0) {
    const fallbackRes = await fetch(config.trafficImagesUrl);
    if (fallbackRes.ok) {
      const fbJson = await fallbackRes.json();
      rawCameras = fbJson?.items?.[0]?.cameras || [];
      captureTimestamp = fbJson?.items?.[0]?.timestamp || '';
      source = 'Data.gov.sg Traffic Images';
      offlineCameraCopy = false;
    }
  }

  if (!rawCameras.length) throw new Error('Camera feed unavailable');
  return {
    cameras: normalizeCameraFeed(rawCameras, captureTimestamp),
    timestamp: captureTimestamp,
    offline: offlineCameraCopy,
    source,
  };
}
