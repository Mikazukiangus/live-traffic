import { CAMERA_DIRECTORY } from '../../data/cameras';
import type { CameraCard } from './types';
import { formatSgt } from './images';

export function normalizeCameraFeed(rawCameras: any[], timestamp: string): CameraCard[] {
  return rawCameras
    .filter((c) => c.image || c.ImageLink)
    .map((c) => {
      const camId = String(c.camera_id || c.CameraID);
      const meta = CAMERA_DIRECTORY[camId];
      const capturedAt = c.timestamp || timestamp || new Date().toISOString();
      return {
        id: `lta-live-${camId}`,
        name: meta?.name || `LTA Camera #${camId}`,
        short: meta?.short || `Camera #${camId}`,
        place: meta?.place || 'other',
        corridor: meta?.corridor || 'LTA',
        location: meta?.locationDesc || `Camera #${camId}`,
        imageUrl: c.image || c.ImageLink,
        updatedTime: `Captured ${formatSgt(capturedAt)}`,
        speedStatus: '',
        weather: 'Dry',
        capturedAt,
        lat: c.latitude ?? c.Latitude ?? c.location?.latitude,
        lon: c.longitude ?? c.Longitude ?? c.location?.longitude,
      };
    });
}
