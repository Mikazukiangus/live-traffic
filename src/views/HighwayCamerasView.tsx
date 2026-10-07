import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LiveVmsBoards } from '../components/LiveVmsBoards';
import { HighwayCameraFeed } from '../types/traffic';
import { RAIN_LEVEL_STYLE, nearestArea, rainLevel, useRainForecast } from '../utils/rainForecast';
import { REGION_LABEL, nearestRegion, pm25Band, psiBand, sgtHour, useAirQuality } from '../utils/airQuality';
import { JAM_STYLE, JamLevel, NearbyTraffic, jamLevel, trafficNear } from '../utils/expresswaySpeeds';
import type { SpeedSegment } from '../components/SpeedBandMap';
import { useVehicleCounts } from '../utils/vehicleDetection';
import { readParam, useUrlParam, writeParams } from '../utils/urlState';
import { loadSpeedSnapshot, saveSpeedSnapshot } from '../utils/speedSnapshot';
import { minutesBetween, useLtaTravelTimes } from '../utils/ltaTravelTimes';
import { StaleFeed, parseSgt, sgtClock, useOnline } from '../utils/freshness';
import { formatKm, kmBetween, locate, useNearMe } from '../utils/nearMe';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { ShareButton } from '../components/ShareButton';
import { useRefreshRequests, useShortcuts } from '../utils/appEvents';
import { useWallCycle } from '../utils/wallDisplay';

interface HighwayCamerasViewProps {
  onCallHotline: (phone: string, title: string) => void;
  // Wall display: place tabs cycle and the page's own controls are hidden
  wall?: boolean;
}

// data.gov.sg serves images as octet-stream with nosniff, and LTA DataMall's S3 links send no
// CORS headers (needed to count vehicles in the photo), so both go through our image proxy.
const PROXIED_IMAGE_HOSTS = ['https://images.data.gov.sg/', 'https://dm-traffic-camera-itsc.s3.ap-southeast-1.amazonaws.com/'];
const getResolvedCameraUrl = (url: string): string =>
  PROXIED_IMAGE_HOSTS.some((h) => url.startsWith(h)) ? `/api/imageproxy?url=${encodeURIComponent(url)}` : url;

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

const COUNT_NOTE =
  'Counted on this device by an open-source model (YOLOX-Nano). It misses some motorcycles and distant vehicles.';

// Hide a live image that fails to load rather than show a substitute.
const hideBrokenImage = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden';
};

// Official verified LTA directory for live cameras based on real-world coordinates and Singapore gantry IDs
type CameraPlace = 'woodlands' | 'tuas' | 'sentosa';

const REAL_LTA_CAMERA_DIRECTORY: Record<
  string,
  { name: string; short: string; place: CameraPlace; corridor: string; locationDesc: string }
> = {
  '2701': {
    name: 'BKE • Woodlands Causeway (Towards Johor)',
    short: 'Causeway towards Johor',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'Causeway Bridge Inspection Entry • Camera #2701',
  },
  '2702': {
    name: 'BKE • Woodlands Checkpoint Viaduct',
    short: 'Checkpoint viaduct',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'Woodlands Crossing Approach to BKE • Camera #2702',
  },
  '2704': {
    name: 'BKE • Woodlands South Flyover (Exit 10)',
    short: 'Woodlands South flyover',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'BKE before Turf Club Avenue • Camera #2704',
  },
  '4703': {
    name: 'AYE • Tuas Second Link Bridge (Towards Malaysia)',
    short: 'Second Link towards Malaysia',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Second Link International Bridge KM 1.2 • Camera #4703',
  },
  '4712': {
    name: 'AYE • Tuas Checkpoint Arrival Viaduct',
    short: 'Checkpoint arrival viaduct',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Jalan Ahmad Ibrahim Approach • Camera #4712',
  },
  '4713': {
    name: 'AYE • Tuas West Checkpoint Departure',
    short: 'Tuas West departure',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Tuas West Extension Viaduct • Camera #4713',
  },
  '4798': {
    name: 'MCE • Sentosa Gateway / HarbourFront Viaduct',
    short: 'Sentosa Gateway',
    place: 'sentosa',
    corridor: 'MCE',
    locationDesc: 'Sentosa Gateway after Telok Blangah Rd • Camera #4798',
  },
  '4799': {
    name: 'MCE • Telok Blangah Rd / Keppel Bay Approach',
    short: 'Telok Blangah / Keppel Bay',
    place: 'sentosa',
    corridor: 'MCE',
    locationDesc: 'HarbourFront towards Marina Coastal Expressway • Camera #4799',
  },
};

type TabId = CameraPlace | 'other' | 'all' | 'signs';

const PLACE_TABS: { id: CameraPlace | 'other'; label: string; icon: string }[] = [
  { id: 'woodlands', label: 'Woodlands', icon: 'directions_car' },
  { id: 'tuas', label: 'Tuas', icon: 'directions_car' },
  { id: 'sentosa', label: 'Sentosa', icon: 'beach_access' },
  { id: 'other', label: 'Other', icon: 'videocam' },
];

const TAB_STORAGE_KEY = 'trafficpulse.cameraTab';
const CAMERA_TABS: TabId[] = ['woodlands', 'tuas', 'sentosa', 'other', 'all', 'signs'];
const isCameraTab = (t: string | null): t is TabId => !!t && (CAMERA_TABS as string[]).includes(t);

const readSavedTab = (): TabId => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (isCameraTab(saved)) return saved;
  } catch {
    // Storage blocked; use the default tab
  }
  return 'woodlands';
};

// Checkpoint summary at the top of the page. When LTA speeds are down, the drive comes from LTA's
// travel times for the stretch leading to the checkpoint instead.
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
    travel: { code: 'AYE', direction: 1, from: 'Jurong Town Hall Rd', to: 'Tuas Checkpoint', label: 'AYE from Jurong Town Hall' },
  },
];

// LTA retired every other expressway camera feed on this date (ERP 2.0 transition).
const LTA_CAMERAS_RETIRED_ON = '30 Jun 2026';
// LTA captures roughly every 1–5 minutes; older than this means the feed has stalled.
const STALE_CAPTURE_MS = 15 * 60_000;

interface CameraCard extends HighwayCameraFeed {
  // ISO capture time from LTA.
  capturedAt: string;
  short: string;
  place: CameraPlace | 'other';
  lat?: number;
  lon?: number;
}

interface ExpresswaySpeed {
  code: string;
  avgSpeedKmH: number;
  status: string;
}

// From /api/expresswayspeeds: drive to each checkpoint towards Johor, Singapore side only.
interface CheckpointApproach {
  id: 'woodlands' | 'tuas';
  name: string;
  via: string;
  km: number;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  queueSpeedKmH: number | null;
}

// LTA speed bands change every 5 minutes, so the 30-second camera refresh needn't refetch them.
const SPEEDS_REFRESH_MS = 2 * 60_000;
// Three missed speed band updates means LTA's feed has stalled.
const SPEEDS_STALE_MS = 15 * 60_000;

const formatSgt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });

const captureAge = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? 'just now' : `${mins} min ago`;
};

export const HighwayCamerasView: React.FC<HighwayCamerasViewProps> = ({ onCallHotline, wall = false }) => {
  const [cameras, setCameras] = useState<CameraCard[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, ExpresswaySpeed>>({});
  const [segments, setSegments] = useState<SpeedSegment[]>([]);
  const [checkpoints, setCheckpoints] = useState<Record<string, CheckpointApproach>>({});
  const speedsFetchedAt = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [speedsUpdated, setSpeedsUpdated] = useState<string | null>(null);
  const speedsUpdatedRef = useRef<string | null>(null);
  speedsUpdatedRef.current = speedsUpdated;
  const travelTimes = useLtaTravelTimes();
  // All cameras grid: which cameras to show (?cams=2701,4703); all of them when not set
  const [camsParam, setCamsParam] = useUrlParam('cams');
  const [speedsFailed, setSpeedsFailed] = useState(false);
  const rainForecast = useRainForecast();
  const airQuality = useAirQuality();
  // Tab and enlarged camera are in the address (?tab=tuas&cam=4703) so they can be shared.
  const [tabParam, setTabParam] = useUrlParam('tab');
  const [savedTab] = useState<TabId>(readSavedTab);
  const activeTab: TabId = isCameraTab(tabParam) ? tabParam : savedTab;
  useEffect(() => {
    if (tabParam !== activeTab) setTabParam(activeTab, false);
  }, [tabParam, activeTab]);
  const [camParam] = useUrlParam('cam');
  // Whether this visit opened the camera (so closing can step Back instead of adding history).
  const openedHere = useRef(false);
  const online = useOnline();
  const nearMe = useNearMe();
  // A shared link's tab wins over Near me, unless Near me is tapped.
  const linkedTab = useRef(isCameraTab(readParam('tab')));
  const nearMeTapped = useRef(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [feedFailed, setFeedFailed] = useState<boolean>(false);
  const [latestCapture, setLatestCapture] = useState<string>('');
  const [liveSourceDesc, setLiveSourceDesc] = useState<string>('LTA Traffic Images');

  const selectTab = (tab: TabId, push = true) => {
    if (tab !== activeTab) setTabParam(tab, push);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage blocked; the tab just isn't remembered
    }
  };

  // Live LTA corridor speeds (CDN-cached speed bands) replace per-camera speed guesses.
  const fetchSpeeds = async () => {
    if (Date.now() - speedsFetchedAt.current < SPEEDS_REFRESH_MS) return;
    try {
      const res = await fetch('/api/expresswayspeeds?include=segments');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json?.expressways)) throw new Error('No speeds');
      setSpeedsUpdated(json.lastUpdatedTime || null);
      setSpeedsFailed(false);
      setSpeeds(Object.fromEntries(json.expressways.map((e: ExpresswaySpeed) => [e.code, e])));
      if (Array.isArray(json.segments)) setSegments(json.segments);
      if (Array.isArray(json.checkpoints)) {
        setCheckpoints(Object.fromEntries(json.checkpoints.map((c: CheckpointApproach) => [c.id, c])));
      }
      speedsFetchedAt.current = Date.now();
      saveSpeedSnapshot(json);
    } catch {
      // Cards keep the last speeds (flagged as old below), or the last copy this browser saved.
      setSpeedsFailed(true);
      if (!speedsUpdatedRef.current) {
        const json = loadSpeedSnapshot()?.json;
        if (json?.lastUpdatedTime) {
          setSpeedsUpdated(json.lastUpdatedTime);
          if (Array.isArray(json.expressways)) setSpeeds(Object.fromEntries(json.expressways.map((e: ExpresswaySpeed) => [e.code, e])));
          if (Array.isArray(json.segments)) setSegments(json.segments);
          if (Array.isArray(json.checkpoints)) setCheckpoints(Object.fromEntries(json.checkpoints.map((c: CheckpointApproach) => [c.id, c])));
        }
      }
    }
  };

  // Load the LTA camera feed from our serverless endpoint /api/trafficimages
  const fetchLiveLtaCameras = async () => {
    setRefreshing(true);
    fetchSpeeds();
    try {
      let rawCameras: any[] = [];
      let captureTimestamp = '';

      // 1. Try our internal serverless API route which proxies LTA DataMall or Data.gov.sg
      try {
        const res = await fetch('/api/trafficimages');
        if (res.ok) {
          const json = await res.json();
          rawCameras = json?.cameras || [];
          captureTimestamp = json?.timestamp || '';
          setLiveSourceDesc(json?.source === 'lta_datamall_v2' ? 'LTA DataMall Traffic Images' : 'Data.gov.sg Traffic Images');
        }
      } catch {
        // Fall back to the public Data.gov.sg endpoint below
      }

      // 2. Direct fallback to Data.gov.sg open endpoint if needed
      if (!rawCameras || rawCameras.length === 0) {
        const fallbackRes = await fetch('https://api.data.gov.sg/v1/transport/traffic-images');
        if (fallbackRes.ok) {
          const fbJson = await fallbackRes.json();
          rawCameras = fbJson?.items?.[0]?.cameras || [];
          captureTimestamp = fbJson?.items?.[0]?.timestamp || '';
          setLiveSourceDesc('Data.gov.sg Traffic Images');
        }
      }

      if (rawCameras.length > 0) {
        if (captureTimestamp) setLatestCapture(captureTimestamp);

        // Every camera LTA still publishes is shown, named from the directory where known.
        const liveCameras: CameraCard[] = rawCameras
          .filter((c) => c.image || c.ImageLink)
          .map((c) => {
            const camId = String(c.camera_id || c.CameraID);
            const meta = REAL_LTA_CAMERA_DIRECTORY[camId];
            const capturedAt = c.timestamp || captureTimestamp || new Date().toISOString();
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

        setCameras(liveCameras);
        setFeedFailed(false);
        setNow(Date.now());
        setRefreshing(false);
        return;
      }
    } catch {
      // Keep the last cameras if the network is offline; their capture age flags them as delayed.
    }

    setFeedFailed(true);
    setNow(Date.now());
    setRefreshing(false);
  };

  useEffect(() => {
    fetchLiveLtaCameras();
    const interval = setInterval(fetchLiveLtaCameras, 30000);
    return () => clearInterval(interval);
  }, []);

  // NEA 2-hour forecast for the area nearest each camera
  // NEA 24-hour PSI and 1-hour PM2.5 for the camera's region.
  const cameraAir = (cam: CameraCard) => {
    if (!airQuality || cam.lat == null || cam.lon == null) return null;
    const region = nearestRegion(cam.lat, cam.lon, airQuality);
    if (!region || region.psi24h == null) return null;
    const pm = region.pm25OneHour != null ? `, PM2.5 ${region.pm25OneHour} µg/m³ (${pm25Band(region.pm25OneHour).label.toLowerCase()}, 1-hour)` : '';
    return {
      psi: region.psi24h,
      band: psiBand(region.psi24h),
      detail: `NEA ${REGION_LABEL[region.name]} region at ${sgtHour(airQuality.psiTimestamp)} SGT: 24-hour PSI ${region.psi24h}${pm}`,
    };
  };

  const cameraRain = (cam: CameraCard) => {
    if (!rainForecast || cam.lat == null || cam.lon == null) return null;
    const area = nearestArea(cam.lat, cam.lon, rainForecast.areas);
    return area ? { area, style: RAIN_LEVEL_STYLE[rainLevel(area.forecast)] } : null;
  };

  const speedText = (corridor: string) => {
    const s = speeds[corridor];
    return s ? `${corridor} ${s.avgSpeedKmH} km/h • ${s.status}` : null;
  };

  // Slower direction of LTA expressway traffic within 400 m of each camera.
  const nearbyTraffic = useMemo(() => {
    const byCam: Record<string, NearbyTraffic | null> = {};
    for (const cam of cameras) {
      byCam[cam.id] = segments.length && cam.lat != null && cam.lon != null ? trafficNear(cam.lat, cam.lon, segments) : null;
    }
    return byCam;
  }, [cameras, segments]);

  const camerasByPlace = useMemo(() => {
    const groups: Record<string, CameraCard[]> = {};
    for (const cam of cameras) (groups[cam.place] ||= []).push(cam);
    return groups;
  }, [cameras]);

  // "Other" only appears if LTA publishes a camera missing from the directory.
  const placeTabs = PLACE_TABS.filter((t) => t.id !== 'other' || camerasByPlace.other?.length);
  const shownTab: TabId = activeTab === 'other' && !camerasByPlace.other?.length ? 'woodlands' : activeTab;

  // Count vehicles in each photo, cameras on the open tab first.
  const countQueue = useMemo(() => {
    const list = cameras.map((c) => ({ id: c.id, place: c.place, imageUrl: getResolvedCameraUrl(c.imageUrl) }));
    return [...list.filter((c) => c.place === shownTab), ...list.filter((c) => c.place !== shownTab)];
  }, [cameras, shownTab]);
  const { counts: vehicleCounts } = useVehicleCounts(countQueue);

  // One jam reading per camera: LTA speeds nearby, else the vehicle count where it's calibrated.
  const cameraLevel = (cam: CameraCard): { level: JamLevel; detail: string; source: string } | null => {
    const traffic = nearbyTraffic[cam.id];
    if (traffic) {
      return { level: traffic.level, detail: `${traffic.speedKmH} km/h`, source: 'Slower direction within 400 m, from LTA speed bands' };
    }
    const counted = vehicleCounts[cam.id];
    const level = counted ? countLevel(cam.id.replace('lta-live-', ''), counted.count) : null;
    return level ? { level, detail: `${counted!.count} vehicles`, source: `Estimated from the vehicle count. ${COUNT_NOTE}` } : null;
  };

  const selectedCam = camParam ? cameras.find((c) => c.id === `lta-live-${camParam}`) || null : null;
  const openCam = (cam: CameraCard) => {
    openedHere.current = true;
    writeParams({ tab: cam.place, cam: cam.id.replace('lta-live-', '') }, true);
  };
  const closeCam = () => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      writeParams({ cam: null });
    }
  };
  // Previous / next camera in the open camera's place (keys and swipes)
  const stepCam = (by: number) => {
    if (!selectedCam) return;
    const list = camerasByPlace[selectedCam.place] || [];
    const i = list.findIndex((c) => c.id === selectedCam.id);
    const next = list[(i + by + list.length) % list.length];
    if (next && next.id !== selectedCam.id) writeParams({ cam: next.id.replace('lta-live-', '') });
  };
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart = (e: React.TouchEvent) => (swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onSwipeEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepCam(dx < 0 ? 1 : -1);
  };

  // Keyboard: 1–4 switch tabs; with a camera open, ← → step through and Esc closes
  useShortcuts({
    '1': () => selectTab('woodlands'),
    '2': () => selectTab('tuas'),
    '3': () => selectTab('sentosa'),
    '4': () => selectTab('all'),
    '5': () => selectTab('signs'),
    ArrowLeft: () => stepCam(-1),
    ArrowRight: () => stepCam(1),
    ...(selectedCam ? { Escape: closeCam } : {}),
  });
  useRefreshRequests(fetchLiveLtaCameras);

  // Wall display shows each checkpoint and Sentosa in turn (the all-cameras grid stays put)
  const WALL_TABS: TabId[] = ['woodlands', 'tuas', 'sentosa'];
  useWallCycle(wall && activeTab !== 'all', () => selectTab(WALL_TABS[(WALL_TABS.indexOf(activeTab) + 1) % WALL_TABS.length], false));

  // Near me: the closest camera, and its tab opened (unless a shared link chose the tab)
  const nearestCam = useMemo(() => {
    if (nearMe.status !== 'found' || nearMe.lat == null || nearMe.lon == null) return null;
    let best: { cam: CameraCard; km: number } | null = null;
    for (const cam of cameras) {
      if (cam.place === 'other' || cam.lat == null || cam.lon == null) continue;
      const km = kmBetween(nearMe.lat, nearMe.lon, cam.lat, cam.lon);
      if (!best || km < best.km) best = { cam, km };
    }
    return best;
  }, [nearMe, cameras]);
  useEffect(() => {
    if (!nearestCam || (linkedTab.current && !nearMeTapped.current)) return;
    nearMeTapped.current = false;
    linkedTab.current = false;
    selectTab(nearestCam.cam.place, false);
  }, [nearestCam?.cam.place, nearMe.at]);

  const staleFeeds: StaleFeed[] = [];
  const speedsAt = parseSgt(speedsUpdated);
  if (speedsFailed || (speedsAt && now - speedsAt > SPEEDS_STALE_MS)) {
    staleFeeds.push({
      label: 'LTA speeds',
      detail: speedsAt
        ? `drive times and jam levels use speeds from ${sgtClock(speedsAt)} SGT${speedsFailed ? '; the feed is not responding' : ''}`
        : 'unavailable, so drive times and jam levels are missing',
    });
  }
  if (feedFailed && latestCapture) {
    staleFeeds.push({ label: 'LTA cameras', detail: `not responding; newest photo from ${formatSgt(latestCapture).slice(0, 5)} SGT` });
  }

  const tabClass = (selected: boolean) =>
    `flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
      selected ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const latestAge = latestCapture ? captureAge(latestCapture, now) : null;

  // Checkpoint summary: bridge camera reading, drive to the checkpoint, queue near it
  const checkpointSummary = CHECKPOINT_SUMMARY.map((c) => {
    const cam = cameras.find((x) => x.id === `lta-live-${c.bridgeCam}`);
    const reading = cam ? cameraLevel(cam) : null;
    const count = cam ? vehicleCounts[cam.id]?.count ?? null : null;
    const approach = checkpoints[c.id];
    const route = travelTimes.routes.find((r) => r.code === c.travel.code && r.direction === c.travel.direction);
    const ltaMinutes = route ? minutesBetween(route, c.travel.from, c.travel.to) : null;
    const queue = approach?.queueSpeedKmH != null ? jamLevel(approach.queueSpeedKmH) : null;
    return { ...c, reading, count, approach, ltaMinutes, queue };
  });

  // All cameras grid
  const gridIds = camsParam ? camsParam.split(',').filter(Boolean) : cameras.map((c) => c.id.replace('lta-live-', ''));
  const gridCams = cameras.filter((c) => gridIds.includes(c.id.replace('lta-live-', '')));
  const toggleGridCam = (id: string) => {
    const next = gridIds.includes(id) ? gridIds.filter((x) => x !== id) : [...gridIds, id];
    const all = cameras.map((c) => c.id.replace('lta-live-', ''));
    setCamsParam(next.length === all.length && all.every((x) => next.includes(x)) ? null : next.join(',') || 'none', false);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Live Cameras</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${feedFailed ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`}></span>
            <span>
              {feedFailed ? 'Feed unavailable, retrying' : latestAge ? `Updated ${latestAge}` : 'Loading…'}
            </span>
            <span
              className="material-symbols-outlined text-base text-slate-400 cursor-help"
              title={`${liveSourceDesc}, refreshed every 30 seconds. LTA retired its other expressway cameras on ${LTA_CAMERAS_RETIRED_ON}; only the Woodlands, Tuas and Sentosa cameras remain.`}
            >
              info
            </span>
          </p>
        </div>
        <div className={`items-center gap-2 shrink-0 ${wall ? 'hidden' : 'flex'}`}>
        <button
          onClick={() => {
            nearMeTapped.current = true;
            locate();
          }}
          disabled={nearMe.status === 'locating'}
          aria-label="Near me"
          title="Open the cameras nearest you. Your location stays on this device."
          className={`h-10 px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 ${
            nearMe.status === 'found' ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className={`material-symbols-outlined text-base ${nearMe.status === 'locating' ? 'animate-spin' : ''}`}>
            {nearMe.status === 'locating' ? 'progress_activity' : 'my_location'}
          </span>
          <span className="hidden sm:inline">Near me</span>
        </button>
        <ShareButton title="Live Cameras SG" />
        <button
          onClick={fetchLiveLtaCameras}
          disabled={refreshing}
          aria-label="Refresh cameras"
          title="Refresh cameras"
          className="w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer shadow-xs disabled:opacity-50"
        >
          <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
        </button>
        </div>
      </div>

      <StaleDataNotice feeds={staleFeeds} online={online} />

      {nearMe.status === 'found' && nearestCam && (
        <p className="text-sm text-slate-600 flex items-center gap-2 -mb-2">
          <span className="material-symbols-outlined text-base text-sky-600">my_location</span>
          Nearest camera: <span className="font-semibold text-slate-800">{nearestCam.cam.short}</span>, {formatKm(nearestCam.km)} away
        </p>
      )}
      {(nearMe.status === 'denied' || nearMe.status === 'unavailable') && (
        <p className="text-sm text-slate-600 flex items-center gap-2 -mb-2">
          <span className="material-symbols-outlined text-base text-slate-400">location_off</span>
          {nearMe.status === 'denied'
            ? 'Location is blocked for this site. Allow it in your browser settings to use Near me.'
            : "Couldn't find your location. Try again in a moment."}
        </p>
      )}

      {/* Checkpoints at a glance */}
      {cameras.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {checkpointSummary.map((c) => (
            <button
              key={c.id}
              onClick={() => selectTab(c.id)}
              className="text-left rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs hover:border-sky-300 cursor-pointer flex flex-col gap-1.5"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span className="material-symbols-outlined text-base text-sky-600">directions_car</span>
                {c.name} Checkpoint
                <span className="text-xs font-normal text-slate-500">towards Johor</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
                {c.reading ? (
                  <span className={`flex items-center gap-1.5 font-semibold ${JAM_STYLE[c.reading.level].text}`} title={`${c.bridge} camera: ${c.reading.detail}. ${c.reading.source}`}>
                    <span className={`w-2 h-2 rounded-full ${JAM_STYLE[c.reading.level].dot}`}></span>
                    {c.bridge}: {c.reading.level}
                  </span>
                ) : (
                  c.count != null && (
                    <span title={COUNT_NOTE}>
                      {c.bridge}: ~{c.count} vehicles in view
                    </span>
                  )
                )}
                {c.approach ? (
                  <span title={`Estimated from LTA speed bands over ${c.approach.km} km (${c.approach.via}). Excludes the checkpoint queue and immigration.`}>
                    ~{c.approach.minutes} min to checkpoint
                  </span>
                ) : (
                  c.ltaMinutes != null && (
                    <span title={`LTA estimated travel time, ${c.travel.from} to ${c.travel.to}. Excludes the checkpoint queue and immigration.`}>
                      {c.travel.label}: {c.ltaMinutes} min
                    </span>
                  )
                )}
                {c.queue && (
                  <span className={`flex items-center gap-1.5 ${JAM_STYLE[c.queue].text}`}>
                    <span className={`w-2 h-2 rounded-full ${JAM_STYLE[c.queue].dot}`}></span>
                    {c.queue} near checkpoint
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs stay pinned under the fixed site header while scrolling */}
      <nav className="sticky top-16 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-slate-50/95 backdrop-blur-sm">
        <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl shadow-xs w-full sm:w-fit">
          {placeTabs.map((t) => (
            <button key={t.id} onClick={() => selectTab(t.id)} className={tabClass(shownTab === t.id)}>
              <span>{t.label}</span>
              <span className={`hidden sm:inline text-xs ${shownTab === t.id ? 'text-sky-100' : 'text-slate-400'}`}>
                {camerasByPlace[t.id]?.length || 0}
              </span>
            </button>
          ))}
          <button onClick={() => selectTab('all')} className={tabClass(shownTab === 'all')}>
            <span className="sm:hidden">All</span>
            <span className="hidden sm:inline">All cameras</span>
          </button>
          <button onClick={() => selectTab('signs')} className={tabClass(shownTab === 'signs')}>
            <span className="sm:hidden">Signs</span>
            <span className="hidden sm:inline">Road Signs</span>
          </button>
        </div>
      </nav>

      {cameras.length === 0 && shownTab !== 'signs' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          {refreshing ? 'Loading cameras…' : 'Camera feed unavailable. Retrying every 30 seconds.'}
        </div>
      )}

      {/* Every tab stays mounted (hidden when inactive) so images and signs are ready on tap */}
      {placeTabs.map((t) => {
        const placeCams = camerasByPlace[t.id] || [];
        if (placeCams.length === 0) return null;
        const checkpoint = checkpoints[t.id];
        // Checkpoint tabs lead with the drive-time estimate; Sentosa shows its expressway average.
        const speed = checkpoint ? null : speedText(placeCams[0].corridor);
        const rain = cameraRain(placeCams[0]);
        const air = cameraAir(placeCams[0]);
        const queueLevel = checkpoint?.queueSpeedKmH != null ? jamLevel(checkpoint.queueSpeedKmH) : null;
        // The Causeway itself has no LTA speed data, so its reading comes from the camera's vehicle count.
        const causewayCam = t.id === 'woodlands' ? placeCams.find((c) => c.id === 'lta-live-2701') : undefined;
        const causeway = causewayCam ? cameraLevel(causewayCam) : null;

        return (
          <section key={t.id} className={shownTab === t.id ? 'flex flex-col gap-5' : 'hidden'}>
            {/* One-line summary for the place */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {checkpoint && (
                <span
                  className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold flex items-center gap-1.5 cursor-help"
                  title={`Estimated drive to ${checkpoint.name}: ${checkpoint.minMinutes}–${checkpoint.maxMinutes} min over ${checkpoint.km} km (${checkpoint.via}), from LTA speed bands. Singapore side only; excludes the checkpoint queue and immigration.`}
                >
                  <span className="material-symbols-outlined text-base text-sky-600">schedule</span>~{checkpoint.minutes} min to
                  checkpoint
                  <span className="text-xs font-normal text-slate-500">+ queue at checkpoint</span>
                </span>
              )}
              {checkpoint && queueLevel && (
                <span
                  className={`px-3 py-1 rounded-full bg-white border border-slate-200 flex items-center gap-1.5 cursor-help ${JAM_STYLE[queueLevel].text}`}
                  title={`Average LTA speed over the last 1 km before ${checkpoint.name}: ${checkpoint.queueSpeedKmH} km/h`}
                >
                  <span className={`w-2 h-2 rounded-full ${JAM_STYLE[queueLevel].dot}`}></span>
                  {queueLevel} near checkpoint
                </span>
              )}
              {causeway && (
                <span
                  className={`px-3 py-1 rounded-full bg-white border border-slate-200 flex items-center gap-1.5 cursor-help ${JAM_STYLE[causeway.level].text}`}
                  title={`Causeway camera: ${causeway.detail}. ${causeway.source}`}
                >
                  <span className={`w-2 h-2 rounded-full ${JAM_STYLE[causeway.level].dot}`}></span>
                  Causeway: {causeway.level}
                </span>
              )}
              {speed && (
                <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-700 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-sky-600">speed</span>
                  {speed}
                </span>
              )}
              {rain && (
                <span
                  className={`px-3 py-1 rounded-full bg-white border border-slate-200 flex items-center gap-1.5 ${rain.style.className}`}
                  title={`NEA 2-hour forecast for ${rain.area.name}, ${rainForecast?.validPeriod.text}`}
                >
                  <span className="material-symbols-outlined text-base">{rain.style.icon}</span>
                  {rain.area.forecast}
                </span>
              )}
              {air && (
                <span
                  className={`px-3 py-1 rounded-full bg-white border border-slate-200 flex items-center gap-1.5 cursor-help ${air.band.text}`}
                  title={air.detail}
                >
                  <span className={`w-2 h-2 rounded-full ${air.band.dot}`}></span>
                  PSI {air.psi} {air.band.label}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {placeCams.map((cam) => {
                const isStale = now - new Date(cam.capturedAt).getTime() > STALE_CAPTURE_MS;
                const reading = cameraLevel(cam);
                const counted = vehicleCounts[cam.id];
                return (
                  <button
                    key={cam.id}
                    onClick={() => openCam(cam)}
                    className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow cursor-pointer group"
                  >
                    <div className="fixed-palette aspect-video relative bg-slate-900 overflow-hidden">
                      <img
                        src={getResolvedCameraUrl(cam.imageUrl)}
                        alt={cam.short}
                        loading="eager"
                        crossOrigin="anonymous"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={hideBrokenImage}
                      />
                      <span
                        className={`absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/70 text-xs font-medium flex items-center gap-1.5 ${
                          isStale ? 'text-amber-300' : 'text-white'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isStale ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`}></span>
                        {isStale ? `Delayed • ${captureAge(cam.capturedAt, now)}` : captureAge(cam.capturedAt, now)}
                      </span>
                      {reading && (
                        <span
                          className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-white/95 text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                          title={reading.source}
                        >
                          <span className={`w-2 h-2 rounded-full ${JAM_STYLE[reading.level].dot}`}></span>
                          <span className={JAM_STYLE[reading.level].text}>{reading.level}</span>
                          <span className="text-slate-500 font-normal">{reading.detail}</span>
                        </span>
                      )}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900 group-hover:text-sky-600 transition-colors">
                        {cam.short}
                      </span>
                      {counted && (
                        <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0" title={COUNT_NOTE}>
                          <span className="material-symbols-outlined text-sm">directions_car</span>~{counted.count}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* All cameras at once, for a big screen; the choice is kept in the link (?cams=) */}
      <section className={shownTab === 'all' && cameras.length > 0 ? 'flex flex-col gap-4' : 'hidden'}>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Cameras to show">
          {cameras.map((cam) => {
            const id = cam.id.replace('lta-live-', '');
            const on = gridIds.includes(id);
            return (
              <button
                key={cam.id}
                onClick={() => toggleGridCam(id)}
                aria-pressed={on}
                className={`h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer flex items-center gap-1 ${
                  on ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-white border-slate-200 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-sm">{on ? 'check' : 'add'}</span>
                {cam.short}
              </button>
            );
          })}
        </div>
        {gridCams.length === 0 ? (
          <p className="text-sm text-slate-500">Pick cameras above to show them here.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
            {gridCams.map((cam) => {
              const isStale = now - new Date(cam.capturedAt).getTime() > STALE_CAPTURE_MS;
              const reading = cameraLevel(cam);
              return (
                <button
                  key={cam.id}
                  onClick={() => openCam(cam)}
                  className="fixed-palette relative aspect-video rounded-xl overflow-hidden bg-slate-900 cursor-pointer text-left"
                >
                  <img
                    src={getResolvedCameraUrl(cam.imageUrl)}
                    alt={cam.short}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={hideBrokenImage}
                  />
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-xs font-semibold">
                    {cam.short}
                  </span>
                  <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 text-xs ${isStale ? 'text-amber-300' : 'text-white'}`}>
                    {isStale ? 'Delayed • ' : ''}
                    {captureAge(cam.capturedAt, now)}
                  </span>
                  {reading && (
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-white/95 text-xs font-semibold flex items-center gap-1.5" title={reading.source}>
                      <span className={`w-2 h-2 rounded-full ${JAM_STYLE[reading.level].dot}`}></span>
                      <span className={JAM_STYLE[reading.level].text}>{reading.level}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className={shownTab === 'signs' ? '' : 'hidden'}>
        <LiveVmsBoards areas={rainForecast?.areas} />
      </section>

      {/* Enlarged camera */}
      {selectedCam && (
        <div
          onClick={closeCam}
          className="fixed inset-0 z-50 bg-scrim/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
            role="dialog"
            aria-label={selectedCam.short}
            className="bg-white rounded-2xl max-w-4xl w-full p-5 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">{selectedCam.short}</h3>
                <p className="text-xs text-slate-500">{selectedCam.name}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
              <ShareButton title={`${selectedCam.short} camera`} className="!h-9 !shadow-none !border-transparent" />
              <button
                onClick={closeCam}
                aria-label="Close"
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              </div>
            </div>

            <div className="fixed-palette relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900">
              {(camerasByPlace[selectedCam.place]?.length || 0) > 1 && (
                <>
                  <button
                    onClick={() => stepCam(-1)}
                    aria-label="Previous camera"
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-scrim/60 text-white flex items-center justify-center cursor-pointer hover:bg-scrim/80"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    onClick={() => stepCam(1)}
                    aria-label="Next camera"
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-scrim/60 text-white flex items-center justify-center cursor-pointer hover:bg-scrim/80"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </>
              )}
              <img
                src={getResolvedCameraUrl(selectedCam.imageUrl)}
                alt={selectedCam.short}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
                onError={hideBrokenImage}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-slate-400">schedule</span>
                {formatSgt(selectedCam.capturedAt)} SGT ({captureAge(selectedCam.capturedAt, now)})
              </span>
              {vehicleCounts[selectedCam.id] && (
                <span className="flex items-center gap-1.5" title={COUNT_NOTE}>
                  <span className="material-symbols-outlined text-base text-slate-400">directions_car</span>~
                  {vehicleCounts[selectedCam.id].count} vehicles in view
                </span>
              )}
              {cameraLevel(selectedCam) ? (
                <span className="flex items-center gap-1.5" title={cameraLevel(selectedCam)!.source}>
                  <span className={`w-2 h-2 rounded-full ${JAM_STYLE[cameraLevel(selectedCam)!.level].dot}`}></span>
                  {cameraLevel(selectedCam)!.level} here • {cameraLevel(selectedCam)!.detail}
                </span>
              ) : (
                speedText(selectedCam.corridor) && (
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-sky-600">speed</span>
                    {speedText(selectedCam.corridor)}
                  </span>
                )
              )}
              {(() => {
                const rain = cameraRain(selectedCam);
                return (
                  rain && (
                    <span className={`flex items-center gap-1.5 ${rain.style.className}`}>
                      <span className="material-symbols-outlined text-base">{rain.style.icon}</span>
                      Next 2h: {rain.area.forecast}
                    </span>
                  )
                );
              })()}
              {(() => {
                const air = cameraAir(selectedCam);
                return (
                  air && (
                    <span className={`flex items-center gap-1.5 cursor-help ${air.band.text}`} title={air.detail}>
                      <span className={`w-2 h-2 rounded-full ${air.band.dot}`}></span>
                      PSI {air.psi} {air.band.label}
                    </span>
                  )
                );
              })()}
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">{selectedCam.location}</span>
              <button
                onClick={() => {
                  closeCam();
                  onCallHotline('18002255582', `EMAS Emergency on ${selectedCam.name}`);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-bold cursor-pointer shrink-0"
              >
                Report incident
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
