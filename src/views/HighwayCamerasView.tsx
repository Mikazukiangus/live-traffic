import React, { useState, useEffect, useMemo } from 'react';
import { HIGHWAY_CAMERAS } from '../data/mockData';
import { LiveVmsBoards } from '../components/LiveVmsBoards';
import { HighwayCameraFeed } from '../types/traffic';

interface HighwayCamerasViewProps {
  onCallHotline: (phone: string, title: string) => void;
}

// Guaranteed local fallback images for all 10 Singapore expressways (stored in /public/images)
const CORRIDOR_FALLBACK_IMAGES: Record<string, string> = {
  PIE: '/images/cctv_pie_interchange.jpg',
  AYE: '/images/cctv_aye_jurong.jpg',
  ECP: '/images/cctv_ecp_sheares.jpg',
  CTE: '/images/cctv_cte_flyover.jpg',
  TPE: '/images/cctv_tpe_punggol.jpg',
  KPE: '/images/cctv_kpe_tunnel.jpg',
  SLE: '/images/cctv_sle_lentor.jpg',
  BKE: '/images/cctv_woodlands_checkpoint.jpg',
  KJE: '/images/cctv_kje_choachukang.jpg',
  MCE: '/images/cctv_mce_undersea.jpg',
};

const getFallbackForCorridor = (corridor: string): string => {
  return CORRIDOR_FALLBACK_IMAGES[corridor] || '/images/cctv_pie_interchange.jpg';
};

const getResolvedCameraUrl = (url: string, corridor: string): string => {
  if (!url) return getFallbackForCorridor(corridor);
  if (url.startsWith('/images/')) return url;
  if (url.startsWith('https://images.data.gov.sg/')) {
    // Pipe through our serverless image proxy to bypass browser octet-stream/nosniff blocking
    return `/api/imageproxy?url=${encodeURIComponent(url)}`;
  }
  return url;
};

// Official verified LTA directory for live cameras based on real-world coordinates and Singapore gantry IDs
const REAL_LTA_CAMERA_DIRECTORY: Record<
  string,
  { name: string; corridor: string; locationDesc: string }
> = {
  '2701': {
    name: 'BKE • Woodlands Causeway (Towards Johor)',
    corridor: 'BKE',
    locationDesc: 'Causeway Bridge Inspection Entry • Camera #2701',
  },
  '2702': {
    name: 'BKE • Woodlands Checkpoint Viaduct',
    corridor: 'BKE',
    locationDesc: 'Woodlands Crossing Approach to BKE • Camera #2702',
  },
  '2704': {
    name: 'BKE • Woodlands South Flyover (Exit 10)',
    corridor: 'BKE',
    locationDesc: 'BKE before Turf Club Avenue • Camera #2704',
  },
  '4703': {
    name: 'AYE • Tuas Second Link Bridge (Towards Malaysia)',
    corridor: 'AYE',
    locationDesc: 'Second Link International Bridge KM 1.2 • Camera #4703',
  },
  '4712': {
    name: 'AYE • Tuas Checkpoint Arrival Viaduct',
    corridor: 'AYE',
    locationDesc: 'Jalan Ahmad Ibrahim Approach • Camera #4712',
  },
  '4713': {
    name: 'AYE • Tuas West Checkpoint Departure',
    corridor: 'AYE',
    locationDesc: 'Tuas West Extension Viaduct • Camera #4713',
  },
  '4798': {
    name: 'MCE • Sentosa Gateway / HarbourFront Viaduct',
    corridor: 'MCE',
    locationDesc: 'Sentosa Gateway after Telok Blangah Rd • Camera #4798',
  },
  '4799': {
    name: 'MCE • Telok Blangah Rd / Keppel Bay Approach',
    corridor: 'MCE',
    locationDesc: 'HarbourFront towards Marina Coastal Expressway • Camera #4799',
  },
};

// LTA stopped publishing all other expressway camera feeds on this date (ERP 2.0 transition).
const LTA_CAMERAS_RETIRED_ON = '30 Jun 2026';
// LTA captures roughly every 1–5 minutes; older than this means the feed has stalled.
const STALE_CAPTURE_MS = 15 * 60_000;

interface CameraCard extends HighwayCameraFeed {
  // ISO capture time; only set for live LTA cameras.
  capturedAt?: string;
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

// Curated corridor cards whose camera LTA no longer publishes: shown as reference photos only.
const REFERENCE_CAMERAS: CameraCard[] = HIGHWAY_CAMERAS.map((cam) => ({
  ...cam,
  updatedTime: `No live feed since ${LTA_CAMERAS_RETIRED_ON}`,
}));

export const HighwayCamerasView: React.FC<HighwayCamerasViewProps> = ({ onCallHotline }) => {
  const [cameras, setCameras] = useState<CameraCard[]>(REFERENCE_CAMERAS);
  const [speeds, setSpeeds] = useState<Record<string, ExpresswaySpeed>>({});
  const [now, setNow] = useState(() => Date.now());
  const [selectedCam, setSelectedCam] = useState<CameraCard | null>(null);
  const [selectedCorridor, setSelectedCorridor] = useState<string>('ALL');
  const [showLiveOnly, setShowLiveOnly] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [liveSyncActive, setLiveSyncActive] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('Just now');
  const [liveCaptureTime, setLiveCaptureTime] = useState<string>('');
  const [liveSourceDesc, setLiveSourceDesc] = useState<string>('LTA Data Traffic Images');

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
        if (captureTimestamp) setLiveCaptureTime(formatSgt(captureTimestamp));

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
              corridor: meta?.corridor || 'LTA',
              location: meta?.locationDesc || `Camera #${camId}`,
              imageUrl: c.image || c.ImageLink,
              updatedTime: `Captured ${formatSgt(capturedAt)}`,
              speedStatus: '',
              weather: 'Dry',
              capturedAt,
            };
          });

        // Corridors without a live camera keep a reference photo card.
        const liveCorridors = new Set(liveCameras.map((c) => c.corridor));
        setCameras([...liveCameras, ...REFERENCE_CAMERAS.filter((ref) => !liveCorridors.has(ref.corridor))]);
        setLiveSyncActive(true);
        setNow(Date.now());
        setLastRefreshedAt(new Date().toLocaleTimeString());
        setRefreshing(false);
        return;
      }
    } catch {
      // Keep reference cameras if the network is offline
    }

    setCameras(REFERENCE_CAMERAS);
    setLiveSyncActive(false);
    setLastRefreshedAt(new Date().toLocaleTimeString());
    setRefreshing(false);
  };

  useEffect(() => {
    fetchLiveLtaCameras();
    const interval = setInterval(fetchLiveLtaCameras, 30000);
    return () => clearInterval(interval);
  }, []);

  const speedText = (corridor: string) => {
    const s = speeds[corridor];
    return s ? `${corridor} avg ${s.avgSpeedKmH} km/h • ${s.status}` : 'Corridor speed unavailable';
  };

  const corridors = [
    { id: 'ALL', label: 'All Expressways (10)' },
    { id: 'PIE', label: 'PIE' },
    { id: 'AYE', label: 'AYE' },
    { id: 'ECP', label: 'ECP' },
    { id: 'CTE', label: 'CTE' },
    { id: 'TPE', label: 'TPE' },
    { id: 'KPE', label: 'KPE' },
    { id: 'SLE', label: 'SLE' },
    { id: 'BKE', label: 'BKE' },
    { id: 'KJE', label: 'KJE' },
    { id: 'MCE', label: 'MCE' },
  ];

  const filteredCameras = useMemo(() => {
    let list = cameras;
    if (showLiveOnly) {
      list = list.filter((c) => c.id.startsWith('lta-live'));
    }
    if (selectedCorridor !== 'ALL') {
      list = list.filter((c) => c.corridor === selectedCorridor);
    }
    return list;
  }, [cameras, selectedCorridor, showLiveOnly]);

  const liveFeedsCount = useMemo(() => {
    return cameras.filter((c) => c.id.startsWith('lta-live')).length;
  }, [cameras]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Header with Live LTA Broadcast Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
              LTA EMAS Traffic CCTV Network
            </span>
            {liveSyncActive && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>{liveSourceDesc}</span>
              </span>
            )}
            {liveCaptureTime && (
              <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold font-mono">
                Latest LTA Photo Capture: {liveCaptureTime} SGT
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            Expressway Surveillance Live View
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Latest LTA traffic camera snapshots, refreshed every 30s. Since {LTA_CAMERAS_RETIRED_ON} LTA only publishes
            cameras at the Woodlands and Tuas Checkpoints and Sentosa Gateway; other expressways show a reference photo
            with live LTA corridor speeds.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowLiveOnly(!showLiveOnly)}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer border ${
              showLiveOnly
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
            }`}
          >
            <span className="material-symbols-outlined text-sm">sensors</span>
            <span>Live LTA Feeds Only ({liveFeedsCount})</span>
          </button>

          <button
            onClick={fetchLiveLtaCameras}
            disabled={refreshing}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-sm ${refreshing ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>{refreshing ? 'Fetching Live Photos...' : 'Sync Latest LTA Snapshots'}</span>
          </button>
        </div>
      </div>

      {/* Live LTA Variable Message Signboards */}
      <LiveVmsBoards />

      {/* Camera Grid Section */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-sky-600">videocam</span>
              <span>Expressway Surveillance Live View</span>
            </h2>
            <span className="text-xs text-slate-500">
              Showing {filteredCameras.length} active highway cameras • Feed synchronized at: {lastRefreshedAt}
            </span>
          </div>

          {/* Corridor filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {corridors.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCorridor(c.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  selectedCorridor === c.id
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live Traffic Camera Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCameras.map((cam) => {
            const isLiveLta = cam.id.startsWith('lta-live');
            const isStale = !!cam.capturedAt && now - new Date(cam.capturedAt).getTime() > STALE_CAPTURE_MS;
            const resolvedUrl = getResolvedCameraUrl(cam.imageUrl, cam.corridor);
            const fallbackSrc = getFallbackForCorridor(cam.corridor);

            return (
              <div
                key={cam.id}
                onClick={() => setSelectedCam(cam)}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all cursor-pointer group flex flex-col"
              >
                {/* CCTV Snapshot container */}
                <div className="h-56 relative bg-slate-950 overflow-hidden">
                  <img
                    src={resolvedUrl}
                    alt={cam.name}
                    loading="lazy"
                    onLoad={(e) => ((e.target as HTMLImageElement).style.visibility = 'visible')}
                    referrerPolicy="no-referrer"
                    className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${
                      isLiveLta ? '' : 'grayscale-[60%] opacity-80'
                    }`}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      // Never pass a stock photo off as a live camera; leave the frame dark instead.
                      if (isLiveLta) {
                        target.style.visibility = 'hidden';
                      } else if (!target.src.endsWith(fallbackSrc)) {
                        target.src = fallbackSrc;
                      }
                    }}
                  />

                  {/* CCTV Overlays */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-white text-[10px] font-mono flex items-center gap-1.5 border border-white/10">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isLiveLta ? (isStale ? 'bg-amber-400' : 'bg-red-500 animate-pulse') : 'bg-slate-400'
                      }`}
                    ></span>
                    <span>{isLiveLta ? (isStale ? 'DELAYED LTA FEED' : 'LIVE LTA CAMERA') : 'REFERENCE PHOTO'} • {cam.corridor}</span>
                  </div>

                  <div
                    className={`absolute top-2 right-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono border border-white/10 flex items-center gap-1 ${
                      isLiveLta ? 'text-emerald-400' : 'text-slate-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[11px]">{isLiveLta ? 'photo_camera' : 'no_photography'}</span>
                    <span>{isLiveLta && cam.capturedAt ? captureAge(cam.capturedAt, now) : 'NOT LIVE'}</span>
                  </div>

                  <div className="absolute bottom-2 left-2 right-2 px-2 py-1.5 rounded bg-black/85 backdrop-blur-md text-white text-[11px] font-mono flex items-center justify-between">
                    <span className="truncate">{speedText(cam.corridor)}</span>
                    <span
                      className={`text-[10px] shrink-0 pl-1 font-semibold ${
                        isLiveLta ? (isStale ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-400'
                      }`}
                    >
                      {cam.updatedTime}
                    </span>
                  </div>
                </div>

                {/* Card Footer Metadata */}
                <div className="p-3.5 flex flex-col gap-1.5 flex-1 justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-xs sm:text-sm group-hover:text-sky-600 transition-colors line-clamp-1">
                      {cam.name}
                    </h3>
                    <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-1">{cam.location}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span
                      className={`font-semibold flex items-center gap-1 ${
                        isLiveLta ? 'text-emerald-700' : 'text-slate-600'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isLiveLta ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      ></span>
                      <span>{isLiveLta ? 'Live LTA traffic camera' : 'Reference photo • live corridor speed'}</span>
                    </span>
                    <span className="text-sky-600 font-bold flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                      Enlarge <span className="material-symbols-outlined text-xs">zoom_in</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Snapshot Preview Modal */}
      {selectedCam && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-3xl w-full p-4 sm:p-5 flex flex-col gap-3 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedCam.name}</h3>
                <p className="text-xs text-slate-500">{selectedCam.location}</p>
              </div>
              <button
                onClick={() => setSelectedCam(null)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="w-full h-96 rounded-lg overflow-hidden relative bg-slate-950 flex items-center justify-center">
              <img
                src={getResolvedCameraUrl(selectedCam.imageUrl, selectedCam.corridor)}
                alt={selectedCam.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const fallback = getFallbackForCorridor(selectedCam.corridor);
                  if (!target.src.endsWith(fallback)) {
                    target.src = fallback;
                  }
                }}
              />
              <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-3 py-1 rounded text-white text-xs font-mono flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    selectedCam.capturedAt ? 'bg-red-500 animate-pulse' : 'bg-slate-400'
                  }`}
                ></span>
                <span>
                  {selectedCam.capturedAt ? 'LIVE LTA CAMERA' : 'REFERENCE PHOTO'} • {selectedCam.corridor}
                </span>
              </div>
              <div className="absolute bottom-3 left-3 right-3 bg-black/80 backdrop-blur-md px-3 py-2 rounded text-white text-xs font-mono flex items-center justify-between">
                <span>{speedText(selectedCam.corridor)}</span>
                <span className={selectedCam.capturedAt ? 'text-emerald-400' : 'text-slate-400'}>
                  {selectedCam.updatedTime}
                  {selectedCam.capturedAt ? ` SGT (${captureAge(selectedCam.capturedAt, now)})` : ''}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500">
                Source: Land Transport Authority Singapore Expressway Monitoring &amp; Advisory System (EMAS)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedCam(null)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setSelectedCam(null);
                    onCallHotline('18002255582', `EMAS Emergency on ${selectedCam.name}`);
                  }}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold cursor-pointer"
                >
                  Report Incident on this Feed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
