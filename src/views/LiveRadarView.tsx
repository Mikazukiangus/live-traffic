import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../data/mockData';
import { CongestionStatus } from '../types/traffic';
import { SpeedBandMap, SpeedBandLegend, SpeedSegment } from '../components/SpeedBandMap';
import { IncidentFeed, countByCorridor } from '../utils/ltaIncidents';
import { WeatherOutlook24h } from '../components/WeatherOutlook24h';
import { RAIN_LEVEL_STYLE, describeCorridorRain, rainByExpressway, useRainForecast } from '../utils/rainForecast';
import { DirectionTravelTime, useLtaTravelTimes } from '../utils/ltaTravelTimes';

interface LiveRadarViewProps {
  onSwitchToSos: (corridorCode: string) => void;
  onCallHotline: (phone: string, title: string) => void;
  incidentFeed: IncidentFeed;
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

type RadarTab = 'expressways' | 'weather' | 'incidents';

const TAB_STORAGE_KEY = 'trafficpulse.radarTab';

const readSavedTab = (): RadarTab => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'expressways' || saved === 'weather' || saved === 'incidents') return saved;
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
}) => {
  const corridors = EXPRESSWAY_CORRIDORS;
  const [selectedCorridorCode, setSelectedCorridorCode] = useState<string>('KPE');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning'>('all');
  const [activeTab, setActiveTab] = useState<RadarTab>(readSavedTab);

  const selectTab = (tab: RadarTab) => {
    setActiveTab(tab);
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
  const rainByCode = useMemo(
    () => (rainForecast ? rainByExpressway(rainForecast.areas) : {}),
    [rainForecast]
  );

  const selectedCorridor = corridors.find((c) => c.code === selectedCorridorCode) || corridors[0];
  const selectedSpeed = speedDetails?.[selectedCorridor.code];

  const loadSpeedBands = useCallback(async () => {
    try {
      const res = await fetch('/api/expresswayspeeds?include=segments');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const byCode: Record<string, ExpresswaySpeedSummary> = {};
      for (const e of json.expressways || []) byCode[e.code] = e;
      if (Object.keys(byCode).length === 0) throw new Error('No expressway speeds');

      setSpeedDetails(byCode);
      setSpeedBandsUpdated(json.lastUpdatedTime || null);
      if (Array.isArray(json.segments)) setSpeedSegments(json.segments);
      setSpeedStatus('live');
    } catch {
      // Keep the last live speeds, if any
      setSpeedStatus('error');
    }
  }, []);

  useEffect(() => {
    loadSpeedBands();
    const interval = setInterval(loadSpeedBands, SPEED_BANDS_POLL_MS);
    return () => clearInterval(interval);
  }, [loadSpeedBands]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([loadSpeedBands(), travelTimes.refresh(), incidentFeed.refresh()]);
    setRefreshing(false);
  };

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

  const speedUnavailableText = speedStatus === 'loading' ? 'Loading LTA speeds…' : 'LTA speeds unavailable';
  const speedsUpdatedSgt = speedBandsUpdated ? speedBandsUpdated.slice(11, 16) : null;

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

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onCallHotline('18002255582', 'EMAS Operation Center')}
            aria-label="Report road hazard"
            title="Call the LTA EMAS Operation Centre"
            className="h-10 px-3 sm:px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">emergency</span>
            <span className="hidden sm:inline">Report Road Hazard</span>
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

      {/* Tabs stay pinned under the fixed site header while scrolling */}
      <nav className="sticky top-16 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-slate-50/95 backdrop-blur-sm">
        <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl shadow-xs w-full sm:w-fit">
          <button onClick={() => selectTab('expressways')} className={tabClass(activeTab === 'expressways')}>
            <span>Expressways</span>
            <span className={`hidden sm:inline text-xs ${activeTab === 'expressways' ? 'text-sky-100' : 'text-slate-400'}`}>
              {corridors.length}
            </span>
          </button>
          <button onClick={() => selectTab('weather')} className={tabClass(activeTab === 'weather')}>
            Weather
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
        </div>
      </nav>

      {/* Every tab stays mounted (hidden when inactive) so switching is instant */}
      <section className={activeTab === 'expressways' ? 'flex flex-col gap-6' : 'hidden'}>
        {/* Main Grid: Expressway Corridors Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
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
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSwitchToSos(corridor.code);
                    }}
                    className="text-sky-600 hover:text-sky-700 font-bold flex items-center gap-0.5 text-xs"
                  >
                    <span>Dispatch Here</span>
                    <span className="material-symbols-outlined text-xs">arrow_forward</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected expressway map and live readings */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
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
          <div className={`w-full ${speedSegments.length ? 'h-[26rem]' : 'h-72'} bg-slate-950 rounded-xl relative overflow-hidden flex flex-col justify-between p-4 border border-slate-800 shadow-inner`}>
            <div
              className="absolute inset-0 opacity-25 pointer-events-none"
              style={{
                backgroundImage:
                  'radial-gradient(circle at center, rgba(94, 147, 171, 0.4) 1px, transparent 1px), linear-gradient(to right, rgba(94, 147, 171, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(94, 147, 171, 0.1) 1px, transparent 1px)',
                backgroundSize: '30px 30px, 30px 30px, 30px 30px',
              }}
            ></div>

            {speedSegments.length > 0 && (
              /* Live LTA speed band map, inset so the overlays don't cover the roads */
              <div className="absolute left-3 right-3 top-3 bottom-36">
                <SpeedBandMap
                  segments={speedSegments}
                  selectedCode={selectedCorridor.code}
                  onSelect={setSelectedCorridorCode}
                />
              </div>
            )}

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
              <div className="relative z-10 my-auto text-center text-slate-300 text-xs font-mono">
                {speedStatus === 'loading' ? 'Loading LTA speed band map…' : 'LTA speed band map unavailable. Retrying every minute.'}
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

          {speedSegments.length > 0 && (
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
              <span>LTA speed bands{speedsUpdatedSgt ? ` • ${speedsUpdatedSgt} SGT` : ''} • click a road to select</span>
              <SpeedBandLegend />
            </div>
          )}

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

      <section className={activeTab === 'incidents' ? '' : 'hidden'}>
        {/* Active expressway incidents, live from LTA */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <h3 className="font-bold text-slate-900 text-base">Active Traffic Incidents</h3>
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
      </section>
    </div>
  );
};
