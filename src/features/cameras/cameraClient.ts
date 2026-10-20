import { config } from '../../../config/client';
import {
  fromPublicCameras,
  isCameraPayload,
  isPublicCameras,
  type CameraPayload,
} from '../../../shared/traffic/cameras';
import { readValidatedJson } from '../../../shared/traffic/validation';
import { normalizeCameraFeed } from './normalizeCameraFeed';

export async function fetchCameras() {
  let payload: CameraPayload | undefined;
  let offlineCameraCopy = false;
  try {
    const res = await fetch('/api/trafficimages');
    if (res.ok) {
      payload = await readValidatedJson(res, isCameraPayload);
      offlineCameraCopy = res.headers.get('X-TrafficPulse-Offline') === '1';
    }
  } catch {
    // A malformed snapshot follows the same fallback path as a failed request.
  }

  if (!payload?.cameras.length) {
    const response = await fetch(config.trafficImagesUrl);
    if (!response.ok) throw new Error('Camera feed unavailable');
    payload = fromPublicCameras(await readValidatedJson(response, isPublicCameras));
    offlineCameraCopy = false;
  }
  if (!payload.cameras.length) throw new Error('Camera feed unavailable');
  return {
    cameras: normalizeCameraFeed(payload.cameras, payload.timestamp),
    timestamp: payload.timestamp,
    offline: offlineCameraCopy,
    source: payload.source === 'lta_datamall_v2' ? 'LTA DataMall Traffic Images' : 'Data.gov.sg Traffic Images',
  };
}
