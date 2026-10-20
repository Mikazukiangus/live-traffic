import { InvalidPayloadError } from '../diagnostics.ts';
import { isImageUrl, isLatitude, isLongitude, isRecord, isText, isTimestamp } from './validation.ts';

export interface TrafficCamera {
  camera_id: string;
  image: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}
export interface CameraPayload {
  success: true;
  source: 'lta_datamall_v2' | 'data_gov_sg_lta_live';
  totalCameras: number;
  timestamp: string;
  cameras: TrafficCamera[];
}
export interface DataMallCamera {
  CameraID: string | number;
  ImageLink: string;
  Latitude: number;
  Longitude: number;
}
export interface DataMallCameras {
  value: DataMallCamera[];
}
export interface PublicCamera {
  camera_id: string | number;
  image: string;
  location: { latitude: number; longitude: number };
  timestamp?: string;
}
export interface PublicCameras {
  items: { timestamp: string; cameras: PublicCamera[] }[];
}

const isId = (value: unknown): value is string | number =>
  (isText(value) && value === value.trim()) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
const uniqueIds = (values: (string | number)[]) => new Set(values.map(String)).size === values.length;

export function isDataMallCameras(value: unknown): value is DataMallCameras {
  return (
    isRecord(value) &&
    Array.isArray(value.value) &&
    value.value.every(
      (row: unknown) =>
        isRecord(row) &&
        isId(row.CameraID) &&
        isImageUrl(row.ImageLink) &&
        hasValidCaptureTime(row.ImageLink) &&
        isLatitude(row.Latitude) &&
        isLongitude(row.Longitude),
    ) &&
    uniqueIds(value.value.map((row) => row.CameraID))
  );
}

export function isPublicCameras(value: unknown): value is PublicCameras {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item: unknown) =>
        isRecord(item) &&
        isTimestamp(item.timestamp) &&
        Array.isArray(item.cameras) &&
        item.cameras.every(
          (row: unknown) =>
            isRecord(row) &&
            isId(row.camera_id) &&
            isImageUrl(row.image) &&
            isRecord(row.location) &&
            isLatitude(row.location.latitude) &&
            isLongitude(row.location.longitude) &&
            (row.timestamp === undefined || isTimestamp(row.timestamp)),
        ) &&
        uniqueIds(item.cameras.map((row) => row.camera_id)),
    )
  );
}

export function isCameraPayload(value: unknown): value is CameraPayload {
  return (
    isRecord(value) &&
    value.success === true &&
    (value.source === 'lta_datamall_v2' || value.source === 'data_gov_sg_lta_live') &&
    isTimestamp(value.timestamp) &&
    Array.isArray(value.cameras) &&
    value.totalCameras === value.cameras.length &&
    value.cameras.every(
      (row: unknown) =>
        isRecord(row) &&
        isText(row.camera_id) &&
        row.camera_id === row.camera_id.trim() &&
        isImageUrl(row.image) &&
        isLatitude(row.latitude) &&
        isLongitude(row.longitude) &&
        isTimestamp(row.timestamp),
    ) &&
    uniqueIds(value.cameras.map((row) => row.camera_id))
  );
}

/** Source filenames encode UTC capture time. A malformed embedded date must never become "now". */
export function captureTimeFromLink(link: string): string | null {
  const match = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[^/_]*\.jpg/i.exec(new URL(link).pathname);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  if (!isTimestamp(timestamp)) throw new InvalidPayloadError();
  return new Date(timestamp).toISOString();
}

function hasValidCaptureTime(link: string): boolean {
  try {
    captureTimeFromLink(link);
    return true;
  } catch {
    return false;
  }
}

export function fromDataMallCameras(data: DataMallCameras, fetchedAt: string): CameraPayload {
  const cameras = data.value.map((row) => ({
    camera_id: String(row.CameraID),
    image: row.ImageLink,
    latitude: row.Latitude,
    longitude: row.Longitude,
    timestamp: captureTimeFromLink(row.ImageLink) ?? fetchedAt,
  }));
  const timestamp = cameras.reduce(
    (latest, camera) => (Date.parse(camera.timestamp) > Date.parse(latest) ? camera.timestamp : latest),
    cameras[0]?.timestamp ?? fetchedAt,
  );
  const result = {
    success: true as const,
    source: 'lta_datamall_v2' as const,
    totalCameras: cameras.length,
    timestamp,
    cameras,
  };
  if (!isCameraPayload(result)) throw new InvalidPayloadError();
  return result;
}

export function fromPublicCameras(data: PublicCameras): CameraPayload {
  // Current requests have one item; select by actual instant if the provider adds snapshots.
  const item = data.items.reduce((latest, candidate) =>
    Date.parse(candidate.timestamp) > Date.parse(latest.timestamp) ? candidate : latest,
  );
  const cameras = item.cameras.map((row) => ({
    camera_id: String(row.camera_id),
    image: row.image,
    latitude: row.location.latitude,
    longitude: row.location.longitude,
    timestamp: row.timestamp ?? item.timestamp,
  }));
  const result = {
    success: true as const,
    source: 'data_gov_sg_lta_live' as const,
    totalCameras: cameras.length,
    timestamp: item.timestamp,
    cameras,
  };
  if (!isCameraPayload(result)) throw new InvalidPayloadError();
  return result;
}
