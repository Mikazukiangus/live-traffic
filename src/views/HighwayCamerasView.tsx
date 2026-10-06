import React, { useState, useEffect, useMemo } from 'react';
import { LiveVmsBoards } from '../components/LiveVmsBoards';
import { HighwayCameraFeed } from '../types/traffic';
import { RAIN_LEVEL_STYLE, nearestArea, rainLevel, useRainForecast } from '../utils/rainForecast';

interface HighwayCamerasViewProps {
  onCallHotline: (phone: string, title: string) => void;
}

const getResolvedCameraUrl = (url: string): string =>
  // data.gov.sg serves images as octet-stream with nosniff, so pipe them through our proxy.
  url.startsWith('https://images.data.gov.sg/') ? `/api/imageproxy?url=${encodeURIComponent(url)}` : url;

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

type TabId = CameraPlace | 'other' | 'signs';

const PLACE_TABS: { id: CameraPlace | 'other'; label: string; icon: string }[] = [
  { id: 'woodlands', label: 'Woodlands', icon: 'directions_car' },
  { id: 'tuas', label: 'Tuas', icon: 'directions_car' },
  { id: 'sentosa', label: 'Sentosa', icon: 'beach_access' },
  { id: 'other', label: 'Other', icon: 'videocam' },
];

const TAB_STORAGE_KEY = 'trafficpulse.cameraTab';

const readSavedTab = (): TabId => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved && ['woodlands', 'tuas', 'sentosa', 'other', 'signs'].includes(saved)) return saved as TabId;
  } catch {
    // Storage blocked; use the default tab
  }
  return 'woodlands';
};

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

export const HighwayCamerasView: React.FC<HighwayCamerasViewProps> = ({ onCallHotline }) => {
  const [cameras, setCameras] = useState<CameraCard[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, ExpresswaySpeed>>({});
  const [now, setNow] = useState(() => Date.now());
  const [selectedCam, setSelectedCam] = useState<CameraCard | null>(null);
  const rainForecast = useRainForecast();
  const [activeTab, setActiveTab] = useState<TabId>(readSavedTab);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [feedFailed, setFeedFailed] = useState<boolean>(false);
  const [latestCapture, setLatestCapture] = useState<string>('');
  const [liveSourceDesc, setLiveSourceDesc] = useState<string>('LTA Traffic Images');

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage blocked; the tab just isn't remembered
    }
  };

  // Live LTA corridor speeds (CDN-cached speed bands) replace per-camera speed guesses.
  const fetchSpeeds = async () => {
    try {
      const res = await fetch('/api/expresswayspeeds');
      if (!res.ok) return;
      const json = await res.json();
      if (!Array.isArray(json?.expressways)) return;
      setSpeeds(Object.fromEntries(json.expressways.map((e: ExpresswaySpeed) => [e.code, e])));
    } catch {
      // Cards fall back to showing no speed.
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
  const cameraRain = (cam: CameraCard) => {
    if (!rainForecast || cam.lat == null || cam.lon == null) return null;
    const area = nearestArea(cam.lat, cam.lon, rainForecast.areas);
    return area ? { area, style: RAIN_LEVEL_STYLE[rainLevel(area.forecast)] } : null;
  };

  const speedText = (corridor: string) => {
    const s = speeds[corridor];
    return s ? `${corridor} ${s.avgSpeedKmH} km/h • ${s.status}` : null;
  };

  const camerasByPlace = useMemo(() => {
    const groups: Record<string, CameraCard[]> = {};
    for (const cam of cameras) (groups[cam.place] ||= []).push(cam);
    return groups;
  }, [cameras]);

  // "Other" only appears if LTA publishes a camera missing from the directory.
  const placeTabs = PLACE_TABS.filter((t) => t.id !== 'other' || camerasByPlace.other?.length);
  const shownTab: TabId = activeTab === 'other' && !camerasByPlace.other?.length ? 'woodlands' : activeTab;

  const tabClass = (selected: boolean) =>
    `flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
      selected ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const latestAge = latestCapture ? captureAge(latestCapture, now) : null;

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
          <button onClick={() => selectTab('signs')} className={tabClass(shownTab === 'signs')}>
            Road Signs
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
        const speed = speedText(placeCams[0].corridor);
        const rain = cameraRain(placeCams[0]);

        return (
          <section key={t.id} className={shownTab === t.id ? 'flex flex-col gap-5' : 'hidden'}>
            {/* One-line summary for the place */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {placeCams.map((cam) => {
                const isStale = now - new Date(cam.capturedAt).getTime() > STALE_CAPTURE_MS;
                return (
                  <button
                    key={cam.id}
                    onClick={() => setSelectedCam(cam)}
                    className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow cursor-pointer group"
                  >
                    <div className="aspect-video relative bg-slate-900 overflow-hidden">
                      <img
                        src={getResolvedCameraUrl(cam.imageUrl)}
                        alt={cam.short}
                        loading="eager"
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
                    </div>
                    <div className="px-4 py-3 text-sm font-semibold text-slate-900 group-hover:text-sky-600 transition-colors">
                      {cam.short}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className={shownTab === 'signs' ? '' : 'hidden'}>
        <LiveVmsBoards areas={rainForecast?.areas} />
      </section>

      {/* Enlarged camera */}
      {selectedCam && (
        <div
          onClick={() => setSelectedCam(null)}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-4xl w-full p-5 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">{selectedCam.short}</h3>
                <p className="text-xs text-slate-500">{selectedCam.name}</p>
              </div>
              <button
                onClick={() => setSelectedCam(null)}
                aria-label="Close"
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-900">
              <img
                src={getResolvedCameraUrl(selectedCam.imageUrl)}
                alt={selectedCam.short}
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
              {speedText(selectedCam.corridor) && (
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-sky-600">speed</span>
                  {speedText(selectedCam.corridor)}
                </span>
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
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">{selectedCam.location}</span>
              <button
                onClick={() => {
                  setSelectedCam(null);
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
