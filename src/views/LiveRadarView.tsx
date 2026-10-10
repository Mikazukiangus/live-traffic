import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../data/mockData';
import { CongestionStatus } from '../types/traffic';
import { MapLayerToggles, MapMarker, SpeedBandMap, SpeedBandLegend, SpeedSegment } from '../components/SpeedBandMap';
import { IncidentFeed, countByCorridor } from '../utils/ltaIncidents';
import { WeatherOutlook24h } from '../components/WeatherOutlook24h';
import {
  EXPRESSWAY_RAIN_AREAS,
  RAIN_LEVEL_STYLE,
  describeCorridorRain,
  nearestArea,
  rainByExpressway,
  rainLevel,
  useRainForecast,
} from '../utils/rainForecast';
import { DirectionTravelTime, useLtaTravelTimes } from '../utils/ltaTravelTimes';
import { REGION_LABEL, nearestRegion, pm25Band, psiBand, sgtHour, useAirQuality } from '../utils/airQuality';
import { useUrlParam } from '../utils/urlState';
import { StaleFeed, parseSgt, sgtClock, useNow, useOnline } from '../utils/freshness';
import { formatKm, kmBetween, locate, nearestExpressway, useNearMe } from '../utils/nearMe';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { ShareButton } from '../components/ShareButton';
import { MyCommute } from '../components/MyCommute';
import { useRefreshRequests, useShortcuts } from '../utils/appEvents';
import { enterWallDisplay, useWallCycle } from '../utils/wallDisplay';
import { roadWorksByCode, shortDate, useRoadConditions, worksBy } from '../utils/roadConditions';
import { HEAT_STYLE, LIGHTNING_NEAR_KM, lightningByExpressway, useWeatherAlerts } from '../utils/weatherAlerts';
import { floodLabel, floodsByExpressway, useFloodAlerts } from '../utils/floodAlerts';
import { loadSpeedSnapshot, saveSpeedSnapshot } from '../utils/speedSnapshot';
import { erpOn, formatSgd } from '../utils/erp';
import { ErpRatesTable } from '../components/ErpRatesTable';
import { CarParkAvailability } from '../components/CarParkAvailability';

interface LiveRadarViewProps {
  onSwitchToSos: (corridorCode: string) => void;
  onCallHotline: (phone: string, title: string) => void;
  incidentFeed: IncidentFeed;
  // Wall display: tabs cycle and the page's own controls are hidden
  wall?: boolean;
}

interface ExpresswaySpeedSummary {
  code: string;
  avgSpeedKmH: number;
  linkCount: number;
  slowLinkPct: number;
  status: CongestionStatus;
}

// LTA speed bands refresh every 5 minutes; the endpoint is CDN-cached, so polling each minute is cheap.
const SPEED_BANDS_POLL_MS = 60_000;
// Speed bar scale; LTA's top speed band is 70+ km/h and most expressways are signed 80–90 km/h.
const SPEED_BAR_MAX_KMH = 90;

// LTA EstTravelTimes does not cover these, so their time is estimated from length and LTA average speed.
const UNPUBLISHED_TRAVEL_TIME_KM: Record<string, number> = { KPE: 12, MCE: 5 };

const STATUS_BADGE: Record<CongestionStatus, string> = {
  Congested: 'bg-red-100 text-red-700 border-red-200',
  Heavy: 'bg-amber-100 text-amber-800 border-amber-200',
  Moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Smooth: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const STATUS_BAR: Record<CongestionStatus, string> = {
  Congested: 'bg-red-500',
  Heavy: 'bg-amber-500',
  Moderate: 'bg-yellow-400',
  Smooth: 'bg-emerald-500',
};

const describeTravelTimes = (times: DirectionTravelTime[]) =>
  times.map((t) => `${t.minutes} min to ${t.towards}`).join(' • ');

type RadarTab = 'expressways' | 'incidents' | 'weather' | 'erp';
const RADAR_TABS: RadarTab[] = ['expressways', 'incidents', 'weather', 'erp'];
const isRadarTab = (t: string | null): t is RadarTab => RADAR_TABS.includes(t as RadarTab);

// LTA publishes speed bands every 5 minutes; three missed updates means the feed has stalled.
const SPEEDS_STALE_MS = 15 * 60_000;
// NEA publishes PSI hourly.
const AIR_STALE_MS = 3 * 60 * 60_000;
// NEA lightning observations come every few minutes.
const LIGHTNING_STALE_MS = 30 * 60_000;

const TAB_STORAGE_KEY = 'trafficpulse.radarTab';
const LAYERS_STORAGE_KEY = 'trafficpulse.mapLayers';
type MapLayer = 'incidents' | 'floods' | 'lightning';
const readLayers = (): Record<MapLayer, boolean> => {
  const all = { incidents: true, floods: true, lightning: true };
  try {
    return { ...all, ...JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY) || '{}') };
  } catch {
    return all;
  }
};

const readSavedTab = (): RadarTab => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (isRadarTab(saved)) return saved;
  } catch {
    // Storage blocked; use the default tab
  }
  return 'expressways';
};

const tabClass = (selected: boolean) =>
  `flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
    selected ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
  }`;

export const LiveRadarView: React.FC<LiveRadarViewProps> = ({
  onSwitchToSos,
  onCallHotline,
  incidentFeed,
  wall = false,
}) => {
  const corridors = EXPRESSWAY_CORRIDORS;
  const [selectedCorridorCode, setSelectedCorridorCode] = useState<string>('KPE');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning'>('all');
  // The tab is in the address (?tab=weather) so it can be shared; otherwise the last one used.
  const [tabParam, setTabParam] = useUrlParam('tab');
  const [savedTab] = useState<RadarTab>(readSavedTab);
  const activeTab: RadarTab = isRadarTab(tabParam) ? tabParam : savedTab;
  useEffect(() => {
    if (tabParam !== activeTab) setTabParam(activeTab, false);
  }, [tabParam, activeTab]);

  const selectTab = (tab: RadarTab) => {
    if (tab !== activeTab) setTabParam(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage blocked; the tab just isn't remembered
    }
  };

  // Live LTA incidents (shared with the notifications drawer)
  const { incidents, status: incidentStatus, fetchedAt: incidentsFetchedAt } = incidentFeed;
  const incidentCounts = useMemo(() => countByCorridor(incidents), [incidents]);
  const expresswayIncidentCount = incidents.filter((inc) => inc.corridorCode).length;
  const criticalCount = incidents.filter((inc) => inc.severity === 'Critical').length;

  // Real expressway speeds from LTA speed bands (no values until the first successful fetch)
  const [speedDetails, setSpeedDetails] = useState<Record<string, ExpresswaySpeedSummary> | null>(null);
  const [speedStatus, setSpeedStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [speedBandsUpdated, setSpeedBandsUpdated] = useState<string | null>(null);
  const [speedSegments, setSpeedSegments] = useState<SpeedSegment[]>([]);

  // LTA estimated travel times per expressway and direction
  const travelTimes = useLtaTravelTimes();

  // NEA 2-hour rain forecast for the areas along each expressway (needs no LTA speed data)
  const rainForecast = useRainForecast();

  // NEA 24-hour PSI and 1-hour PM2.5 for the five regions
  const airQuality = useAirQuality();

  // LTA road works on each expressway and faulty traffic lights
  const roadConditions = useRoadConditions();
  const worksByCode = useMemo(() => roadWorksByCode(roadConditions.data?.roadWorks), [roadConditions.data]);

  // NEA lightning near each expressway, and heat stress by station
  const weatherAlerts = useWeatherAlerts();
  // PUB flood alerts
  const floodFeed = useFloodAlerts();
  const floodAlerts = floodFeed.data?.alerts || [];
  const lightningByCode = useMemo(
    () => lightningByExpressway(weatherAlerts.data?.strikes, rainForecast?.areas),
    [weatherAlerts.data, rainForecast]
  );
  const floodsByCode = useMemo(() => floodsByExpressway(floodAlerts, rainForecast?.areas), [floodFeed.data, rainForecast]);
  const rainByCode = useMemo(
    () => (rainForecast ? rainByExpressway(rainForecast.areas) : {}),
    [rainForecast]
  );

  const selectedCorridor = corridors.find((c) => c.code === selectedCorridorCode) || corridors[0];
  const selectedSpeed = speedDetails?.[selectedCorridor.code];

  // Applies an /api/expresswayspeeds answer; false if it has no speeds.
  const haveSpeeds = useRef(false);
  const applySpeeds = useCallback((json: any) => {
    const byCode: Record<string, ExpresswaySpeedSummary> = {};
    for (const e of json?.expressways || []) byCode[e.code] = e;
    if (Object.keys(byCode).length === 0) return false;
    haveSpeeds.current = true;
    setSpeedDetails(byCode);
    setSpeedBandsUpdated(json.lastUpdatedTime || null);
    if (Array.isArray(json.segments)) setSpeedSegments(json.segments);
    return true;
  }, []);

  // While LTA's feed is down, the last speeds this browser saw are shown, marked with their time.
  const [speedsFromSnapshot, setSpeedsFromSnapshot] = useState(false);
  const loadSpeedBands = useCallback(async () => {
    try {
      const res = await fetch('/api/expresswayspeeds?include=segments');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!applySpeeds(json)) throw new Error('No expressway speeds');
      saveSpeedSnapshot(json);
      setSpeedsFromSnapshot(false);
      setSpeedStatus('live');
    } catch {
      // Keep the last live speeds, or fall back to the saved copy
      setSpeedStatus('error');
      if (!haveSpeeds.current) {
        const snap = loadSpeedSnapshot();
        if (snap && applySpeeds(snap.json)) setSpeedsFromSnapshot(true);
      }
    }
  }, [applySpeeds]);

  useEffect(() => {
    loadSpeedBands();
    const interval = setInterval(loadSpeedBands, SPEED_BANDS_POLL_MS);
    return () => clearInterval(interval);
  }, [loadSpeedBands]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([
      loadSpeedBands(),
      travelTimes.refresh(),
      incidentFeed.refresh(),
      roadConditions.refresh(),
      weatherAlerts.refresh(),
      floodFeed.refresh(),
    ]);
    setRefreshing(false);
  };

  useRefreshRequests(refreshAll);

  // Keyboard: 1–4 switch tabs, ← → step through the expressways
  const stepCorridor = (by: number) => {
    const i = corridors.findIndex((c) => c.code === selectedCorridorCode);
    setSelectedCorridorCode(corridors[(i + by + corridors.length) % corridors.length].code);
    if (activeTab !== 'expressways') selectTab('expressways');
  };
  useShortcuts({
    '1': () => selectTab('expressways'),
    '2': () => selectTab('incidents'),
    '3': () => selectTab('weather'),
    '4': () => selectTab('erp'),
    ArrowLeft: () => stepCorridor(-1),
    ArrowRight: () => stepCorridor(1),
  });

  // Wall display moves to the next tab every 30 seconds, without adding to Back history
  useWallCycle(wall, () => setTabParam(RADAR_TABS[(RADAR_TABS.indexOf(activeTab) + 1) % RADAR_TABS.length], false));

  // LTA travel time text, or an estimate (clearly labelled) where LTA publishes none
  const travelTimeText = (code: string): string => {
    const times = travelTimes.byCode[code];
    if (times?.length) return describeTravelTimes(times);
    const km = UNPUBLISHED_TRAVEL_TIME_KM[code];
    const speed = speedDetails?.[code]?.avgSpeedKmH;
    if (km && speed) return `≈${Math.max(1, Math.round((km / speed) * 60))} min end to end (estimated; not published by LTA)`;
    if (travelTimes.status === 'loading') return 'Loading…';
    return 'Not available';
  };

  // KPE and MCE: end to end from length and LTA average speed
  const estimateMinutes = (code: string) => {
    const km = UNPUBLISHED_TRAVEL_TIME_KM[code];
    const speed = speedDetails?.[code]?.avgSpeedKmH;
    return km && speed ? Math.max(1, Math.round((km / speed) * 60)) : null;
  };

  const speedUnavailableText = speedStatus === 'loading' ? 'Loading LTA speeds…' : 'LTA speeds unavailable';
  const speedsUpdatedSgt = speedBandsUpdated ? speedBandsUpdated.slice(11, 16) : null;

  // Which feeds are behind, said plainly rather than shown as if current
  const now = useNow();
  const online = useOnline();
  const staleFeeds: StaleFeed[] = [];
  const speedsAt = parseSgt(speedBandsUpdated);
  if (speedStatus === 'error' || (speedsAt && now - speedsAt > SPEEDS_STALE_MS)) {
    staleFeeds.push({
      label: 'LTA speeds',
      detail: speedsAt ? `from ${sgtClock(speedsAt)} SGT${speedStatus === 'error' ? ', the feed is not responding' : ''}` : 'unavailable, the feed is not responding',
    });
  }
  if (travelTimes.status === 'error') staleFeeds.push({ label: 'LTA travel times', detail: 'not responding; times may be old or missing' });
  if (incidentStatus === 'error') {
    staleFeeds.push({
      label: 'LTA incidents',
      detail: incidentsFetchedAt ? `last received ${incidentsFetchedAt} SGT, the feed is not responding` : 'unavailable, the feed is not responding',
    });
  }
  const rainEnds = parseSgt(rainForecast?.validPeriod.end);
  if (rainEnds && now > rainEnds) {
    staleFeeds.push({ label: 'NEA rain forecast', detail: `expired at ${sgtClock(rainEnds)} SGT; no newer forecast received` });
  }
  const psiAt = parseSgt(airQuality?.psiTimestamp);
  if (roadConditions.status === 'error') staleFeeds.push({ label: 'LTA road works & traffic lights', detail: 'not responding' });
  if (weatherAlerts.status === 'error') staleFeeds.push({ label: 'NEA lightning & heat stress', detail: 'not responding' });
  if (floodFeed.status === 'error') staleFeeds.push({ label: 'PUB flood alerts', detail: 'not responding; alerts may be missing' });
  const lightningAt = parseSgt(weatherAlerts.data?.lightningAt);
  if (lightningAt && now - lightningAt > LIGHTNING_STALE_MS) {
    staleFeeds.push({ label: 'NEA lightning', detail: `last observation ${sgtClock(lightningAt)} SGT` });
  }
  if (psiAt && now - psiAt > AIR_STALE_MS) staleFeeds.push({ label: 'NEA air quality', detail: `readings from ${sgtClock(psiAt)} SGT` });

  // Near me: nearest expressway, rain area and air region (location stays on the device)
  const nearMe = useNearMe();
  const nearYou = useMemo(() => {
    if (nearMe.status !== 'found' || nearMe.lat == null || nearMe.lon == null) return null;
    const { lat, lon } = nearMe;
    const area = rainForecast ? nearestArea(lat, lon, rainForecast.areas) : null;
    let road: { code: string; km: number; approx?: boolean } | null = speedSegments.length
      ? nearestExpressway(lat, lon, speedSegments)
      : null;
    // Without LTA speeds, use the nearest forecast area that an expressway passes through.
    if (!road && rainForecast) {
      const onRoute = rainForecast.areas.filter((a) => Object.values(EXPRESSWAY_RAIN_AREAS).some((names) => names.includes(a.name)));
      const via = nearestArea(lat, lon, onRoute);
      const code = via && Object.keys(EXPRESSWAY_RAIN_AREAS).find((c) => EXPRESSWAY_RAIN_AREAS[c].includes(via.name));
      if (via && code) road = { code, km: kmBetween(lat, lon, via.lat, via.lon), approx: true };
    }
    const region = airQuality ? nearestRegion(lat, lon, airQuality) : null;
    const erp = road ? erpOn([road.code], new Date()) : null;
    return { area, road, region, erp };
  }, [nearMe, rainForecast, speedSegments, airQuality]);

  // Map layers: incidents, flood alerts and lightning, each switchable
  const [layers, setLayers] = useState(readLayers);
  const toggleLayer = (layer: MapLayer) =>
    setLayers((l) => {
      const next = { ...l, [layer]: !l[layer] };
      try {
        localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked; the choice lasts until the page closes
      }
      return next;
    });
  const strikes = weatherAlerts.data?.strikes || [];
  const mappedIncidents = incidents.filter((i) => i.lat != null && i.lon != null);
  const mapMarkers = useMemo(() => {
    const list: MapMarker[] = [];
    if (layers.lightning)
      strikes.forEach((st, i) => list.push({ id: `lightning-${i}`, kind: 'lightning', lat: st.lat, lon: st.lon, label: 'Lightning strike (NEA)' }));
    if (layers.floods)
      floodAlerts.forEach((f) => list.push({ id: f.id, kind: 'flood', lat: f.lat, lon: f.lon, radiusKm: f.radiusKm, label: `${floodLabel(f)} (PUB)` }));
    if (layers.incidents)
      mappedIncidents.forEach((i) =>
        list.push({
          id: i.id,
          kind: i.severity === 'Critical' ? 'critical' : 'incident',
          lat: i.lat!,
          lon: i.lon!,
          code: i.corridorCode,
          label: `${i.type}${i.corridorCode ? ` on ${i.corridorCode}` : ''}: ${i.location}`,
        })
      );
    return list;
  }, [layers, strikes, floodAlerts, mappedIncidents]);

  const showOnMap = (code: string) => {
    setSelectedCorridorCode(code);
    selectTab('expressways');
    setTimeout(() => document.getElementById('speed-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  // Filtered incidents
  const filteredIncidents = incidents.filter((inc) => {
    if (filterSeverity === 'all') return true;
    if (filterSeverity === 'critical') return inc.severity === 'Critical';
    if (filterSeverity === 'warning') return inc.severity === 'Warning';
    return true;
  });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Live Traffic</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${speedStatus === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}
            ></span>
            <span>
              {speedsUpdatedSgt
                ? `Updated ${speedsUpdatedSgt} SGT${speedStatus === 'error' ? ', refresh failed' : ''}`
                : speedUnavailableText}
            </span>
            <span
              className="material-symbols-outlined text-base text-slate-400 cursor-help"
              title={`LTA DataMall speed bands, travel times and incidents for all 10 expressways, refreshed every minute.${
                rainForecast ? ` Rain: NEA 2-hour forecast, ${rainForecast.validPeriod.text}.` : ''
              }`}
            >
              info
            </span>
          </p>
        </div>

        <div className={`items-center gap-2 shrink-0 ${wall ? 'hidden' : 'flex'}`}>
          <button
            onClick={enterWallDisplay}
            aria-label="Wall display"
            title="Wall display: full screen, no menus, tabs change every 30 seconds (W)"
            className="hidden lg:flex w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 items-center justify-center cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-xl">tv</span>
          </button>
          <button
            onClick={locate}
            disabled={nearMe.status === 'locating'}
            aria-label="Near me"
            title="Show the expressway, rain and air quality nearest you. Your location stays on this device."
            className={`h-10 px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 ${
              nearMe.status === 'found' ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className={`material-symbols-outlined text-base ${nearMe.status === 'locating' ? 'animate-spin' : ''}`}>
              {nearMe.status === 'locating' ? 'progress_activity' : 'my_location'}
            </span>
            <span className="hidden sm:inline">Near me</span>
          </button>
          <ShareButton title="Live Traffic SG" />
          <button
            onClick={() => onCallHotline('18002255582', 'EMAS Operation Center')}
            aria-label="Report road hazard"
            title="Call the LTA EMAS Operation Centre"
            className="h-10 px-3 bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-700 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">report</span>
            <span className="hidden sm:inline">Report hazard</span>
          </button>
          <button
            onClick={refreshAll}
            disabled={refreshing}
            aria-label="Refresh live data"
            title="Reload LTA speeds, travel times and incidents now"
            className="w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer shadow-xs disabled:opacity-50"
          >
            <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      <StaleDataNotice feeds={staleFeeds} online={online} />

      {!wall && <MyCommute
        routes={travelTimes.routes}
        speeds={speedDetails}
        incidents={incidents}
        roadWorks={worksByCode}
        rain={rainByCode}
        lightning={lightningByCode}
        floods={floodsByCode}
        estimateMinutes={estimateMinutes}
        onShowOnMap={showOnMap}
      />}

      {(nearMe.status === 'denied' || nearMe.status === 'unavailable') && (
        <p className="text-sm text-slate-600 flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-slate-400">location_off</span>
          {nearMe.status === 'denied'
            ? 'Location is blocked for this site. Allow it in your browser settings to use Near me.'
            : "Couldn't find your location. Try again in a moment."}
        </p>
      )}

      {nearYou && (
        <div className="rounded-2xl border border-sky-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-sm shadow-xs">
          <div className="flex items-center gap-2 font-bold text-sky-700 shrink-0">
            <span className="material-symbols-outlined text-base">my_location</span>
            Near you{nearYou.area ? ` · ${nearYou.area.name}` : ''}
          </div>
          {!nearYou.road && !nearYou.area && !nearYou.region && (
            <span className="text-slate-500">Loading the nearest expressway, rain forecast and air quality…</span>
          )}
          {nearYou.road && (
            <button
              onClick={() => showOnMap(nearYou.road!.code)}
              className="text-left flex items-center gap-2 cursor-pointer hover:text-sky-700"
              title="Show this expressway on the map"
            >
              <span className="font-mono font-bold">{nearYou.road.code}</span>
              <span className="text-slate-500">
                {nearYou.road.approx ? `about ${formatKm(nearYou.road.km)}` : formatKm(nearYou.road.km)} away
              </span>
              {speedDetails?.[nearYou.road.code] && (
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${STATUS_BADGE[speedDetails[nearYou.road.code].status]}`}>
                  {speedDetails[nearYou.road.code].avgSpeedKmH} km/h · {speedDetails[nearYou.road.code].status}
                </span>
              )}
              {(incidentCounts[nearYou.road.code] || 0) > 0 && (
                <span className="text-red-700 font-semibold">
                  {incidentCounts[nearYou.road.code]} incident{incidentCounts[nearYou.road.code] === 1 ? '' : 's'}
                </span>
              )}
              <span className="material-symbols-outlined text-base text-slate-400">map</span>
            </button>
          )}
          {nearYou.area && (
            <span className={`flex items-center gap-1.5 ${RAIN_LEVEL_STYLE[rainLevel(nearYou.area.forecast)].className}`}>
              <span className="material-symbols-outlined text-base">{RAIN_LEVEL_STYLE[rainLevel(nearYou.area.forecast)].icon}</span>
              {nearYou.area.forecast}
            </span>
          )}
          {nearYou.erp && (nearYou.erp.charging.length > 0 || nearYou.erp.next) && (
            <span className="flex items-center gap-1.5 text-slate-700" title="LTA ERP for cars on this expressway">
              <span className="material-symbols-outlined text-base text-amber-700">toll</span>
              {nearYou.erp.charging.length
                ? `ERP ${formatSgd(nearYou.erp.charging[0].rate)} now (${nearYou.erp.charging[0].note})`
                : `ERP free now, ${formatSgd(nearYou.erp.next!.rate)} from ${nearYou.erp.next!.start}`}
            </span>
          )}
          {nearYou.region?.psi24h != null && (
            <span className={`flex items-center gap-1.5 ${psiBand(nearYou.region.psi24h).text}`}>
              <span className={`w-2 h-2 rounded-full ${psiBand(nearYou.region.psi24h).dot}`}></span>
              PSI {nearYou.region.psi24h} {psiBand(nearYou.region.psi24h).label}
              <span className="text-slate-500">({REGION_LABEL[nearYou.region.name]})</span>
            </span>
          )}
        </div>
      )}

      {!wall && nearMe.status === 'found' && nearMe.lat != null && nearMe.lon != null && (
        <details className="group/parks">
          <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-800">
            <span className="material-symbols-outlined text-base">local_parking</span>
            Car parks near you
            <span className="material-symbols-outlined text-base group-open/parks:rotate-180 transition-transform">expand_more</span>
          </summary>
          <div className="mt-3">
            <CarParkAvailability lat={nearMe.lat} lon={nearMe.lon} placeLabel="you" />
          </div>
        </details>
      )}

      {/* Tabs stay pinned under the fixed site header while scrolling */}
      <nav className="sticky top-16 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-slate-50/95 backdrop-blur-sm">
        <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl shadow-xs w-full sm:w-fit">
          <button onClick={() => selectTab('expressways')} className={tabClass(activeTab === 'expressways')}>
            <span>Expressways</span>
            <span className={`hidden sm:inline text-xs ${activeTab === 'expressways' ? 'text-sky-100' : 'text-slate-400'}`}>
              {corridors.length}
            </span>
          </button>
          <button onClick={() => selectTab('incidents')} className={tabClass(activeTab === 'incidents')}>
            <span>Incidents</span>
            {incidentStatus !== 'loading' && (
              <span
                className={`text-xs ${
                  activeTab === 'incidents' ? 'text-sky-100' : criticalCount > 0 ? 'text-red-600 font-bold' : 'text-slate-400'
                }`}
              >
                {incidents.length}
              </span>
            )}
          </button>
          <button onClick={() => selectTab('weather')} className={tabClass(activeTab === 'weather')}>
            Weather
          </button>
          <button onClick={() => selectTab('erp')} className={tabClass(activeTab === 'erp')}>
            ERP
          </button>
        </div>
      </nav>

      {/* Every tab stays mounted (hidden when inactive) so switching is instant */}
      {/* On wide screens the cards scroll beside a pinned map */}
      <section
        className={
          activeTab === 'expressways'
            ? 'flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start'
            : 'hidden'
        }
      >
        {(speedsFromSnapshot || (speedStatus === 'error' && !speedDetails)) && (
          <div className="xl:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <span className="material-symbols-outlined text-base text-amber-700 mt-0.5">speed</span>
            <span>
              {speedsFromSnapshot
                ? `LTA's speed feed isn't responding, so speeds and the map are from ${speedsUpdatedSgt ?? 'earlier'} SGT. `
                : "LTA's speed feed isn't responding, so live speeds and the coloured map are missing. "}
              Travel times, incidents and weather below are current. Speeds come back on their own once LTA's feed recovers.
            </span>
          </div>
        )}

        {/* Main Grid: Expressway Corridors Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-4">
          {corridors.map((corridor) => {
            const isSelected = selectedCorridor.code === corridor.code;
            const liveSpeed = speedDetails?.[corridor.code];
            const rain = rainByCode[corridor.code];

            return (
              <div
                key={corridor.code}
                onClick={() => setSelectedCorridorCode(corridor.code)}
                className={`p-4 rounded-xl border bg-white cursor-pointer transition-all shadow-xs flex flex-col justify-between gap-3 relative overflow-hidden ${
                  isSelected
                    ? 'border-sky-500 ring-2 ring-sky-500/20 shadow-md'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Active selection accent line */}
                {isSelected && <div className="absolute top-0 left-0 right-0 h-1 bg-sky-500"></div>}

                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-slate-900 font-mono">
                        {corridor.code}
                      </span>
                      <span className="text-xs text-slate-500 line-clamp-1">{corridor.name}</span>
                    </div>
                    {liveSpeed ? (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${STATUS_BADGE[liveSpeed.status]}`}>
                        {liveSpeed.status}
                      </span>
                    ) : travelTimes.byCode[corridor.code]?.length ? (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-bold border bg-slate-50 text-slate-600 border-slate-200 font-mono"
                        title="LTA end-to-end travel time each way (speeds unavailable)"
                      >
                        {travelTimes.byCode[corridor.code].map((t) => t.minutes).join(' / ')} min
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold border bg-slate-50 text-slate-400 border-slate-200">
                        —
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-400 mt-1">{corridor.fromTo}</div>
                </div>

                {/* LTA speed */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${liveSpeed ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></span>
                      <span>Avg Speed (LTA)</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {liveSpeed ? `${liveSpeed.avgSpeedKmH} km/h` : <span className="text-slate-400 font-normal">{speedUnavailableText}</span>}
                    </span>
                  </div>

                  <div className={`w-full h-2 bg-slate-100 rounded-full overflow-hidden ${liveSpeed ? '' : 'hidden'}`}>
                    {liveSpeed && (
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${STATUS_BAR[liveSpeed.status]}`}
                        style={{ width: `${Math.min(100, (liveSpeed.avgSpeedKmH / SPEED_BAR_MAX_KMH) * 100)}%` }}
                      ></div>
                    )}
                  </div>

                  {liveSpeed && (
                    <div className="text-[11px] text-slate-500">
                      {liveSpeed.slowLinkPct}% of {liveSpeed.linkCount} segments below 40 km/h
                    </div>
                  )}

                  {rain && (
                    <div
                      className={`text-[11px] flex items-center gap-1 ${RAIN_LEVEL_STYLE[rain.level].className}`}
                      title={rain.wetAreas.map((a) => `${a.name}: ${a.forecast}`).join('\n') || undefined}
                    >
                      <span className="material-symbols-outlined text-sm">{RAIN_LEVEL_STYLE[rain.level].icon}</span>
                      <span className="line-clamp-1">Next 2h: {describeCorridorRain(rain)}</span>
                    </div>
                  )}

                  {floodsByCode[corridor.code]?.length > 0 && (
                    <div
                      className="text-[11px] flex items-center gap-1 text-sky-800 font-semibold"
                      title={floodsByCode[corridor.code].map((f) => `${floodLabel(f)}: ${f.description}`).join('\n')}
                    >
                      <span className="material-symbols-outlined text-sm">flood</span>
                      <span className="line-clamp-1">PUB flood alert: {floodsByCode[corridor.code][0].area || floodsByCode[corridor.code][0].headline}</span>
                    </div>
                  )}

                  {lightningByCode[corridor.code] > 0 && (
                    <div
                      className="text-[11px] flex items-center gap-1 text-violet-800 font-semibold"
                      title={`NEA lightning observation: ${lightningByCode[corridor.code]} strikes within ${LIGHTNING_NEAR_KM} km of areas along the ${corridor.code}`}
                    >
                      <span className="material-symbols-outlined text-sm">bolt</span>
                      Lightning nearby ({lightningByCode[corridor.code]})
                    </div>
                  )}

                  <div className="text-[11px] text-slate-500 pt-1 flex items-start gap-1" title={travelTimeText(corridor.code)}>
                    <span className="material-symbols-outlined text-sm text-slate-400">schedule</span>
                    <span className="line-clamp-2">Travel time: {travelTimeText(corridor.code)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {incidentStatus === 'loading'
                      ? 'Loading incidents…'
                      : `${incidentCounts[corridor.code] || 0} active LTA ${incidentCounts[corridor.code] === 1 ? 'incident' : 'incidents'}`}
                    {worksByCode[corridor.code]?.length ? ` · ${worksByCode[corridor.code].length} road works` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected expressway map and live readings */}
        <div id="speed-map" className="scroll-mt-32 xl:sticky xl:top-32 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">
                Selected Expressway • LTA Live Data
              </span>
              <h3 className="text-lg font-bold text-slate-900">
                {selectedCorridor.name} ({selectedCorridor.code})
              </h3>
            </div>
            {selectedSpeed && (
              <span className="text-xs text-emerald-700 font-bold font-mono bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                {selectedSpeed.avgSpeedKmH} km/h avg
              </span>
            )}
          </div>

          {/* Speed band map */}
          <div className={`w-full h-[26rem] fixed-palette bg-slate-950 rounded-xl relative overflow-hidden flex flex-col justify-between p-4 border border-slate-800 shadow-inner`}>
            <div
              className="absolute inset-0 opacity-25 pointer-events-none"
              style={{
                backgroundImage:
                  'radial-gradient(circle at center, rgba(94, 147, 171, 0.4) 1px, transparent 1px), linear-gradient(to right, rgba(94, 147, 171, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(94, 147, 171, 0.1) 1px, transparent 1px)',
                backgroundSize: '30px 30px, 30px 30px, 30px 30px',
              }}
            ></div>

            {/* Live LTA speed band map and markers, inset so the overlays don't cover the roads */}
            <div className="absolute left-3 right-3 top-3 bottom-36">
              <SpeedBandMap
                segments={speedSegments}
                selectedCode={selectedCorridor.code}
                onSelect={setSelectedCorridorCode}
                markers={mapMarkers}
              />
            </div>

            {speedSegments.length > 0 ? (
              /* Selected expressway readout, below the map */
              <div className="relative z-10 mt-auto mb-2 flex items-end pointer-events-none">
                <div className="bg-black/80 backdrop-blur-md px-3 py-1.5 rounded border border-white/10 text-white font-mono">
                  <div className="text-xs font-bold">
                    {selectedCorridor.code}
                    {selectedSpeed ? ` • ${selectedSpeed.avgSpeedKmH} km/h avg • ${selectedSpeed.status}` : ''}
                  </div>
                  {selectedSpeed && (
                    <div className="text-[10px] text-sky-300">
                      {selectedSpeed.slowLinkPct}% of {selectedSpeed.linkCount} segments below 40 km/h
                    </div>
                  )}
                  {rainByCode[selectedCorridor.code] && (
                    <div className="text-[10px] text-sky-200">
                      Next 2h: {describeCorridorRain(rainByCode[selectedCorridor.code])}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="relative z-10 mx-auto mb-auto px-3 py-1.5 rounded bg-black/70 text-center text-slate-200 text-[11px] font-mono">
                {speedStatus === 'loading'
                  ? 'Loading LTA speed band map…'
                  : 'LTA speeds unavailable: roads are shown without speeds. Markers show incidents, flood alerts and lightning.'}
              </div>
            )}

            {/* Tow request for the selected expressway */}
            <div className="relative z-10 bg-white/95 backdrop-blur-md p-3 rounded-lg border border-slate-200 shadow-lg flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-lg">local_shipping</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900">Need a tow on the {selectedCorridor.code}?</div>
                  <div className="text-slate-600 text-[11px]">{selectedCorridor.fromTo}</div>
                </div>
              </div>
              <button
                onClick={() => onSwitchToSos(selectedCorridor.code)}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-xs transition-colors shrink-0 cursor-pointer"
              >
                Request Tow Here
              </button>
            </div>
          </div>

          <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
            {speedSegments.length > 0 ? (
              <span className={speedsFromSnapshot ? 'text-amber-700 font-semibold' : ''}>
                LTA speed bands{speedsUpdatedSgt ? ` • ${speedsUpdatedSgt} SGT` : ''}
                {speedsFromSnapshot ? ' (saved copy, feed down)' : ''} • click a road to select
              </span>
            ) : (
              <span>Click a road to select</span>
            )}
            {speedSegments.length > 0 && <SpeedBandLegend />}
          </div>
          <p className="-mt-3 text-[10px] text-slate-400">
            Base map ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
              OpenStreetMap contributors
            </a>
          </p>
          <MapLayerToggles
            layers={layers}
            onToggle={toggleLayer}
            counts={{ incidents: mappedIncidents.length, floods: floodAlerts.length, lightning: strikes.length }}
          />

          {/* Live readings for the selected expressway */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Avg Speed (LTA)</span>
              <span className="text-base font-bold text-slate-900 font-mono">
                {selectedSpeed ? `${selectedSpeed.avgSpeedKmH} km/h` : '—'}
              </span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Below 40 km/h</span>
              <span className="text-base font-bold text-slate-900 font-mono">
                {selectedSpeed ? `${selectedSpeed.slowLinkPct}%` : '—'}
              </span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Active Incidents</span>
              <span className="text-base font-bold text-slate-900 font-mono">
                {incidentStatus === 'loading' ? '—' : incidentCounts[selectedCorridor.code] || 0}
              </span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Travel Time</span>
              <span className="text-[11px] font-semibold text-slate-900 block leading-snug">
                {travelTimeText(selectedCorridor.code)}
              </span>
            </div>
          </div>
        </div>

      </section>

      <section className={activeTab === 'weather' ? 'flex flex-col gap-6' : 'hidden'}>
        {/* Air quality first, then floods, lightning and heat, rain, and the 24-hour outlook */}
        {/* NEA air quality: 24-hour PSI and 1-hour PM2.5 per region */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA Air Quality</span>
              <h3 className="text-lg font-bold text-slate-900">PSI &amp; PM2.5 by Region</h3>
            </div>
            {airQuality && (
              <span className="text-xs text-slate-500 font-mono">
                {sgtHour(airQuality.psiTimestamp ?? airQuality.pm25Timestamp)} SGT reading
              </span>
            )}
          </div>
          {!airQuality ? (
            <div className="text-xs text-slate-400">Loading NEA air quality…</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              {airQuality.regions.map((r) => {
                const psi = r.psi24h != null ? psiBand(r.psi24h) : null;
                const pm = r.pm25OneHour != null ? pm25Band(r.pm25OneHour) : null;
                return (
                  <div key={r.name} className="p-3 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-2">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">{REGION_LABEL[r.name]}</div>
                    <div title="24-hour Pollutant Standards Index">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-bold font-mono text-slate-900">{r.psi24h ?? '—'}</span>
                        <span className="text-[10px] text-slate-500">PSI</span>
                      </div>
                      {psi && (
                        <div className={`flex items-center gap-1 font-semibold ${psi.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${psi.dot}`}></span>
                          {psi.label}
                        </div>
                      )}
                    </div>
                    <div className="pt-2 border-t border-slate-200/70" title="Latest 1-hour PM2.5 concentration">
                      <span className="font-mono font-bold text-slate-900">{r.pm25OneHour ?? '—'}</span>
                      <span className="text-[10px] text-slate-500"> µg/m³ PM2.5</span>
                      {pm && <div className={`font-semibold ${pm.text}`}>{pm.label}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            PSI is the 24-hour index (Good up to 50, Moderate 51–100, Unhealthy 101–200). PM2.5 is the latest 1-hour reading.
          </p>
        </div>

        {/* PUB flood alerts, only while there are any */}
        {floodAlerts.length > 0 && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">PUB Flood Alerts</span>
              <h3 className="text-lg font-bold text-slate-900">Flash Floods</h3>
            </div>
            {floodFeed.data?.checkedAt && (
              <span className="text-xs text-slate-500 font-mono">checked {sgtHour(floodFeed.data.checkedAt)} SGT</span>
            )}
          </div>
            <ul className="flex flex-col gap-2">
              {floodAlerts.map((f) => {
                const codes = Object.keys(floodsByCode).filter((c) => floodsByCode[c].some((x) => x.id === f.id));
                return (
                  <li key={f.id} className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sm flex items-start gap-3">
                    <span className="material-symbols-outlined text-xl text-sky-700">flood</span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-slate-900">
                        {floodLabel(f)}
                        {f.severity ? <span className="ml-2 text-[11px] font-bold uppercase text-sky-800">{f.severity}</span> : null}
                      </span>
                      {f.description && <span className="text-xs text-slate-600">{f.description}</span>}
                      <span className="text-[11px] text-slate-500 font-mono">
                        from {sgtClock(Date.parse(f.startsAt))} SGT{codes.length ? ` • near ${codes.join(', ')}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          <p className="text-[11px] text-slate-500">
            PUB alerts when water rises at a sensor. Avoid the area and never drive through flood water.
          </p>
        </div>
        )}

        {/* NEA lightning and heat stress */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA Observations</span>
              <h3 className="text-lg font-bold text-slate-900">Lightning &amp; Heat Stress</h3>
            </div>
            {weatherAlerts.data?.heatAt && (
              <span className="text-xs text-slate-500 font-mono">
                {sgtHour(weatherAlerts.data.lightningAt)} / {sgtHour(weatherAlerts.data.heatAt)} SGT
              </span>
            )}
          </div>
          {!weatherAlerts.data ? (
            <div className="text-xs text-slate-400">Loading NEA lightning and heat stress…</div>
          ) : (
            <>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                <span className={`material-symbols-outlined text-xl ${Object.keys(lightningByCode).length ? 'text-violet-800' : 'text-slate-400'}`}>
                  bolt
                </span>
                {weatherAlerts.data.strikes == null ? (
                  <span className="text-slate-500">Lightning data unavailable.</span>
                ) : Object.keys(lightningByCode).length ? (
                  <span className="text-violet-800">
                    <span className="font-semibold">Lightning near </span>
                    {Object.entries(lightningByCode)
                      .map(([code, n]) => `${code} (${n})`)
                      .join(', ')}
                    . Take extra care if you have to stop on the shoulder.
                  </span>
                ) : (
                  <span className="text-slate-600">
                    No lightning near the expressways in NEA's latest observation
                    {weatherAlerts.data.strikes.length ? ` (${weatherAlerts.data.strikes.length} strikes elsewhere)` : ''}.
                  </span>
                )}
              </div>

              {weatherAlerts.data.heatStations?.length ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
                    {[...weatherAlerts.data.heatStations]
                      .sort((a, b) => b.wbgt - a.wbgt)
                      .map((st) => {
                        const style = HEAT_STYLE[st.heatStress] || HEAT_STYLE.Low;
                        return (
                          <div key={st.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-0.5">
                            <span className="text-slate-500 truncate" title={st.name}>{st.name}</span>
                            <span className="font-mono font-bold text-slate-900">{st.wbgt.toFixed(1)}°C</span>
                            <span className={`flex items-center gap-1 font-semibold ${style.text}`}>
                              <span className={`w-2 h-2 rounded-full ${style.dot}`}></span>
                              {st.heatStress || '—'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Heat stress is NEA's Wet Bulb Globe Temperature (WBGT): Low below 31°C, Moderate 31–33°C, High 33°C and above.
                    Worth knowing for roadside work, breakdowns and deliveries.
                  </p>
                </div>
              ) : (
                <div className="text-xs text-slate-500">Heat stress data unavailable.</div>
              )}
            </>
          )}
        </div>

        {/* NEA 2-hour rain forecast along each expressway */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">NEA 2-Hour Forecast</span>
              <h3 className="text-lg font-bold text-slate-900">Rain Along Each Expressway</h3>
            </div>
            {rainForecast && (
              <span className="text-xs text-slate-500 font-mono">{rainForecast.validPeriod.text}</span>
            )}
          </div>
          {Object.keys(rainByCode).length === 0 ? (
            <div className="text-xs text-slate-400">
              Loading NEA rain forecast…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {corridors.map((corridor) => {
                const rain = rainByCode[corridor.code];
                if (!rain) return null;
                return (
                  <div
                    key={corridor.code}
                    className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                    title={rain.wetAreas.map((a) => `${a.name}: ${a.forecast}`).join('\n') || undefined}
                  >
                    <span className={`material-symbols-outlined text-xl ${RAIN_LEVEL_STYLE[rain.level].className}`}>
                      {RAIN_LEVEL_STYLE[rain.level].icon}
                    </span>
                    <span className="font-extrabold font-mono text-slate-900 w-10 shrink-0">{corridor.code}</span>
                    <span className={`line-clamp-2 ${RAIN_LEVEL_STYLE[rain.level].className}`}>{describeCorridorRain(rain)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* NEA 24-hour weather outlook */}
        <WeatherOutlook24h />
      </section>

      <section className={activeTab === 'incidents' ? 'flex flex-col gap-6' : 'hidden'}>
        {/* Active expressway incidents, live from LTA */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <h3 className="font-bold text-slate-900 text-base">Happening Now</h3>
              </div>
              <span className={`text-[11px] font-mono ${incidentStatus === 'error' ? 'text-amber-700' : 'text-slate-400'}`}>
                {incidentStatus === 'loading'
                  ? 'LTA DataMall • loading…'
                  : `LTA DataMall • ${incidents.length} active (${expresswayIncidentCount} on expressways)${
                      incidentsFetchedAt ? ` • ${incidentStatus === 'error' ? 'refresh failed, last' : 'updated'} ${incidentsFetchedAt} SGT` : ''
                    }`}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterSeverity('all')}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                  filterSeverity === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterSeverity('critical')}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                  filterSeverity === 'critical'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                Critical
              </button>
              <button
                onClick={() => setFilterSeverity('warning')}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                  filterSeverity === 'warning'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                Warning
              </button>
            </div>
          </div>

          {/* Dynamic Incidents List */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {filteredIncidents.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                {incidentStatus === 'loading'
                  ? 'Loading LTA incidents…'
                  : incidentStatus === 'error' && incidents.length === 0
                  ? 'LTA incident feed unavailable. Retrying every minute.'
                  : incidents.length === 0
                  ? 'No active incidents reported by LTA.'
                  : 'No incidents match the selected filter.'}
              </div>
            ) : (
              filteredIncidents.map((inc) => {
                const isCritical = inc.severity === 'Critical';
                const isWarning = inc.severity === 'Warning';

                return (
                  <div
                    key={inc.id}
                    className={`p-3 rounded-lg border flex flex-col gap-1.5 text-xs transition-all ${
                      isCritical
                        ? 'bg-red-50/60 border-red-200'
                        : isWarning
                        ? 'bg-amber-50/50 border-amber-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isCritical
                              ? 'bg-red-500 animate-ping'
                              : isWarning
                              ? 'bg-amber-500'
                              : 'bg-sky-500'
                          }`}
                        ></span>
                        <span className="font-bold text-slate-900">
                          {inc.corridor}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                            isCritical
                              ? 'bg-red-200 text-red-800'
                              : isWarning
                              ? 'bg-amber-200 text-amber-900'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {inc.type}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{inc.timeAgo}</span>
                    </div>

                    <div className="text-slate-700 font-medium">
                      {inc.location} • <span className="font-mono text-slate-500">{inc.lane}</span>
                    </div>

                    <div className="text-slate-800 bg-white/80 p-2 rounded border border-slate-200/60 text-[11px] flex items-center justify-between gap-2">
                      <div className="line-clamp-2">{inc.advice}</div>
                      <button
                        onClick={() => onSwitchToSos(inc.corridorCode || '')}
                        className="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-[10px] shrink-0 cursor-pointer"
                      >
                        Dispatch
                      </button>
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>
        {/* LTA road works on the expressways, and faulty traffic lights: ongoing, so folded away by default */}
        <details className="group/works flex flex-col gap-4">
          <summary className="list-none cursor-pointer flex items-center justify-between gap-3 bg-white px-5 py-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="flex flex-col">
              <span className="font-bold text-slate-900 text-base">Road Works &amp; Traffic Lights</span>
              <span className="text-xs text-slate-500">
                {roadConditions.data
                  ? `${Object.values(worksByCode).reduce((n, w) => n + w.length, 0)} expressway road works today · ${
                      roadConditions.data.faultyLights?.length ?? 0
                    } faulty traffic lights`
                  : 'Ongoing LTA road works and traffic light faults'}
              </span>
            </span>
            <span className="material-symbols-outlined text-slate-500 group-open/works:rotate-180 transition-transform">expand_more</span>
          </summary>
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-lg text-amber-600">construction</span>
                Road Works on the Expressways
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                LTA road works in progress today • LTA gives the road, not the exact spot
              </span>
            </div>
            {!roadConditions.data ? (
              <div className="text-xs text-slate-400">{roadConditions.status === 'error' ? 'LTA road works unavailable.' : 'Loading LTA road works…'}</div>
            ) : (
              <div className="flex flex-col divide-y divide-slate-100">
                {corridors
                  .filter((c) => worksByCode[c.code]?.length)
                  .map((c) => (
                    <details key={c.code} className="py-2 group">
                      <summary className="flex items-center justify-between gap-2 cursor-pointer text-sm list-none">
                        <span>
                          <span className="font-mono font-bold text-slate-900">{c.code}</span>{' '}
                          <span className="text-slate-600">{worksByCode[c.code].length} road works</span>
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          next ends {shortDate(worksByCode[c.code][0].end)}
                          <span className="material-symbols-outlined text-base group-open:rotate-180 transition-transform">expand_more</span>
                        </span>
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                        {worksByCode[c.code].map((w) => (
                          <li key={w.id} className="flex justify-between gap-3">
                            <span className="truncate">{worksBy(w.by)}{/TUNNEL/i.test(w.road) ? ' · tunnel' : ''}</span>
                            <span className="font-mono shrink-0">
                              {shortDate(w.start)} – {shortDate(w.end)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                {Object.keys(worksByCode).length === 0 && <div className="text-xs text-slate-500 py-2">No expressway road works listed for today.</div>}
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-lg text-red-600">traffic</span>
                Faulty Traffic Lights
              </h3>
              <span className="text-[11px] font-mono text-slate-400">LTA, on roads across Singapore</span>
            </div>
            {!roadConditions.data ? (
              <div className="text-xs text-slate-400">{roadConditions.status === 'error' ? 'LTA traffic light faults unavailable.' : 'Loading…'}</div>
            ) : roadConditions.data.faultyLights == null ? (
              <div className="text-xs text-slate-500">LTA traffic light faults unavailable.</div>
            ) : roadConditions.data.faultyLights.length === 0 ? (
              <div className="text-xs text-slate-500">No faulty traffic lights reported.</div>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {roadConditions.data.faultyLights.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3">
                    <span className="text-slate-800">
                      <span className="mr-1.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase">{l.kind}</span>
                      {l.message.replace(/^(Black Out|Flashing Yellow) at /i, '')}
                    </span>
                    {l.since && <span className="text-xs font-mono text-slate-500 shrink-0">since {l.since.slice(11)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        </details>
      </section>

      <section className={activeTab === 'erp' ? 'flex flex-col gap-6' : 'hidden'}>
        <ErpRatesTable />
      </section>
    </div>
  );
};
