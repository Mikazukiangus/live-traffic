import { REGION_LABEL, nearestRegion, pm25Band, psiBand, sgtHour, type AirQuality } from '../../utils/airQuality';
import { RAIN_LEVEL_STYLE, nearestArea, rainLevel, type RainForecast } from '../../utils/rainForecast';
import { jamLevel, type JamLevel, type NearbyTraffic } from '../../utils/expresswaySpeeds';
import { currentVehicleCount, type VehicleCount } from '../../utils/vehicleDetection';
import { minutesBetween, type TravelRoute } from '../../utils/ltaTravelTimes';
import { getResolvedCameraUrl } from './images';
import type { CameraCard } from './types';
import type { CheckpointApproach } from '../../../shared/traffic/types';
// Vehicle counts that mean busy / jam / massive jam, for cameras with no LTA speed data close by.
// Calibrated by eye on the Causeway camera (#2701): about 75 found when the bridge was packed.
const COUNT_LEVELS: Record<string, { busy: number; jam: number; massive: number }> = {
  '2701': { busy: 30, jam: 50, massive: 65 },
};

const countLevel = (camId: string, count: number): JamLevel | null => {
  const t = COUNT_LEVELS[camId];
  if (!t) return null;
  return count >= t.massive ? 'Massive jam' : count >= t.jam ? 'Jam' : count >= t.busy ? 'Busy' : 'Smooth';
};

export const COUNT_NOTE =
  'Counted on this device by an open-source model (YOLOX-Nano). It misses some motorcycles and distant vehicles.';

const CHECKPOINT_SUMMARY: {
  id: 'woodlands' | 'tuas';
  name: string;
  bridgeCam: string;
  bridge: string;
  travel: { code: string; direction: number; from: string; to: string; label: string };
}[] = [
  {
    id: 'woodlands',
    name: 'Woodlands',
    bridgeCam: '2701',
    bridge: 'Causeway',
    travel: { code: 'BKE', direction: 1, from: 'BKE/PIE Interchange', to: 'Woodlands Centre', label: 'BKE from PIE' },
  },
  {
    id: 'tuas',
    name: 'Tuas',
    bridgeCam: '4703',
    bridge: 'Second Link',
    travel: {
      code: 'AYE',
      direction: 1,
      from: 'Jurong Town Hall Rd',
      to: 'Tuas Checkpoint',
      label: 'AYE from Jurong Town Hall',
    },
  },
];

export const cameraAir = (cam: CameraCard, airQuality: AirQuality | null) => {
  if (!airQuality || cam.lat == null || cam.lon == null) return null;
  const region = nearestRegion(cam.lat, cam.lon, airQuality);
  if (!region || region.psi24h == null) return null;
  const pm =
    region.pm25OneHour != null
      ? `, PM2.5 ${region.pm25OneHour} µg/m³ (${pm25Band(region.pm25OneHour).label.toLowerCase()}, 1-hour)`
      : '';
  return {
    psi: region.psi24h,
    band: psiBand(region.psi24h),
    detail: `NEA ${REGION_LABEL[region.name]} region at ${sgtHour(airQuality.psiTimestamp)} SGT: 24-hour PSI ${region.psi24h}${pm}`,
  };
};

export const cameraRain = (cam: CameraCard, rainForecast: RainForecast | null) => {
  if (!rainForecast || cam.lat == null || cam.lon == null) return null;
  const area = nearestArea(cam.lat, cam.lon, rainForecast.areas);
  return area ? { area, style: RAIN_LEVEL_STYLE[rainLevel(area.forecast)] } : null;
};

export const cameraLevel = (
  cam: CameraCard,
  traffic: NearbyTraffic | null | undefined,
  vehicleCounts: Record<string, VehicleCount>,
): { level: JamLevel; detail: string; source: string } | null => {
  if (traffic) {
    return {
      level: traffic.level,
      detail: `${traffic.speedKmH} km/h`,
      source: 'Slower direction within 400 m, from LTA speed bands',
    };
  }
  const counted = currentVehicleCount(vehicleCounts, cam.id, getResolvedCameraUrl(cam.imageUrl));
  const level = counted ? countLevel(cam.id.replace('lta-live-', ''), counted.count) : null;
  return level
    ? { level, detail: `${counted!.count} vehicles`, source: `Estimated from the vehicle count. ${COUNT_NOTE}` }
    : null;
};

export function checkpointReadings(
  cameras: CameraCard[],
  vehicleCounts: Record<string, VehicleCount>,
  checkpoints: Record<string, CheckpointApproach>,
  routes: TravelRoute[],
  readingFor: (cam: CameraCard) => ReturnType<typeof cameraLevel>,
) {
  return CHECKPOINT_SUMMARY.map((c) => {
    const cam = cameras.find((x) => x.id === `lta-live-${c.bridgeCam}`);
    const reading = cam ? readingFor(cam) : null;
    const count = cam
      ? (currentVehicleCount(vehicleCounts, cam.id, getResolvedCameraUrl(cam.imageUrl))?.count ?? null)
      : null;
    const approach = checkpoints[c.id];
    const route = routes.find((r) => r.code === c.travel.code && r.direction === c.travel.direction);
    const ltaMinutes = route ? minutesBetween(route, c.travel.from, c.travel.to) : null;
    const queue = approach?.queueSpeedKmH != null ? jamLevel(approach.queueSpeedKmH) : null;
    return { ...c, reading, count, approach, ltaMinutes, queue };
  });
}
