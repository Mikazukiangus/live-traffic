import { config } from '../../../config/client';
import {
  fromPublicCameras,
  isCameraPayload,
  isPublicCameras,
  type CameraPayload,
} from '../../../shared/traffic/cameras';
import { readValidatedJson } from '../../../shared/traffic/validation';
import { normalizeCameraFeed } from './normalizeCameraFeed';
import { fetchWithTimeout } from '../../utils/request';

export async function fetchCameras() {
  let payload: CameraPayload | undefined;
  let offlineCameraCopy = false;
  try {
    const result = await fetchWithTimeout('/api/trafficimages', async (res) => {
      if (!res.ok) {
        await res.body?.cancel();
        return undefined;
      }
      return { payload: await readValidatedJson(res, isCameraPayload), offline: res.headers.get('X-TrafficPulse-Offline') === '1' };
    });
    payload = result?.payload;
    offlineCameraCopy = result?.offline ?? false;
  } catch {
    // A malformed snapshot follows the same fallback path as a failed request.
  }

  if (!payload?.cameras.length) {
    payload = await fetchWithTimeout(config.trafficImagesUrl, async (response) => {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Camera feed unavailable');
      }
      return fromPublicCameras(await readValidatedJson(response, isPublicCameras));
    }, { redirect: 'error' });
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
