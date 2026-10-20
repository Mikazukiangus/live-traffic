import { config } from '../../config/client';
import React from 'react';

import { CongestionStatus } from '../types/traffic';

import { IncidentFeed } from '../utils/ltaIncidents';

import { RAIN_LEVEL_STYLE, rainLevel } from '../utils/rainForecast';

import { REGION_LABEL, psiBand } from '../utils/airQuality';

import { formatKm, locate } from '../utils/nearMe';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { ShareButton } from '../components/ShareButton';
import { MyCommute } from '../components/MyCommute';
import { requestRefresh } from '../utils/appEvents';
import { enterWallDisplay } from '../utils/wallDisplay';

import { formatSgd } from '../utils/erp';
import { ErpRatesTable } from '../components/ErpRatesTable';
import { CarParkAvailability } from '../components/CarParkAvailability';

import { useRadarNavigation } from '../features/radar/useRadarNavigation';
import { useRadarReadings } from '../features/radar/useRadarReadings';
import { ExpresswaysPanel } from '../features/radar/ExpresswaysPanel';
import { WeatherPanel } from '../features/radar/WeatherPanel';
import { IncidentsPanel } from '../features/radar/IncidentsPanel';
interface LiveRadarViewProps {
  onSwitchToSos: (corridorCode: string) => void;
  onCallHotline: (phone: string, title: string) => void;
  incidentFeed: IncidentFeed;
  // Wall display: tabs cycle and the page's own controls are hidden
  wall?: boolean;
}

const STATUS_BADGE: Record<CongestionStatus, string> = {
  Congested: 'bg-red-100 text-red-700 border-red-200',
  Heavy: 'bg-amber-100 text-amber-800 border-amber-200',
  Moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Smooth: 'bg-emerald-100 text-emerald-800 border-emerald-200',
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
  const navigation = useRadarNavigation(wall);
  const { corridors, selectedCorridorCode, activeTab, selectTab, showOnMap } = navigation;
  const readings = useRadarReadings(incidentFeed, selectedCorridorCode);
  const {
    refreshing,
    incidents,
    incidentStatus,
    incidentCounts,
    criticalCount,
    speedDetails,
    speedStatus,
    travelTimes,
    rainForecast,
    worksByCode,
    lightningByCode,
    floodsByCode,
    rainByCode,
    estimateMinutes,
    speedUnavailableText,
    speedsUpdatedSgt,
    online,
    staleFeeds,
    nearMe,
    nearYou,
  } = readings;
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
              title={`LTA DataMall speed bands, travel times and incidents for all 10 expressways, speeds and incidents refreshed every ${Math.round(config.poll.live / 1000)} seconds; travel times every ${Math.round(config.poll.travelTimes / 1000)} seconds.${
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
            title={`Wall display: full screen, no menus, tabs change every ${Math.round(config.wallCycleMs / 1000)} seconds (W)`}
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
              nearMe.status === 'found'
                ? 'bg-sky-50 border-sky-200 text-sky-700'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span
              className={`material-symbols-outlined text-base ${nearMe.status === 'locating' ? 'animate-spin' : ''}`}
            >
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
            onClick={requestRefresh}
            disabled={refreshing}
            aria-label="Refresh live data"
            title="Refresh traffic, weather and alert feeds now"
            className="w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer shadow-xs disabled:opacity-50"
          >
            <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      <StaleDataNotice feeds={staleFeeds} online={online} />

      {!wall && (
        <MyCommute
          routes={travelTimes.routes}
          travelFetchedAt={travelTimes.fetchedAt}
          travelStatus={travelTimes.status}
          speeds={speedDetails}
          incidents={incidents}
          roadWorks={worksByCode}
          rain={rainByCode}
          lightning={lightningByCode}
          floods={floodsByCode}
          estimateMinutes={estimateMinutes}
          onShowOnMap={showOnMap}
        />
      )}

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
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border ${STATUS_BADGE[speedDetails[nearYou.road.code].status]}`}
                >
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
            <span
              className={`flex items-center gap-1.5 ${RAIN_LEVEL_STYLE[rainLevel(nearYou.area.forecast)].className}`}
            >
              <span className="material-symbols-outlined text-base">
                {RAIN_LEVEL_STYLE[rainLevel(nearYou.area.forecast)].icon}
              </span>
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
            <span className="material-symbols-outlined text-base group-open/parks:rotate-180 transition-transform">
              expand_more
            </span>
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
            <span
              className={`hidden sm:inline text-xs ${activeTab === 'expressways' ? 'text-sky-100' : 'text-slate-400'}`}
            >
              {corridors.length}
            </span>
          </button>
          <button onClick={() => selectTab('incidents')} className={tabClass(activeTab === 'incidents')}>
            <span>Incidents</span>
            {incidentStatus !== 'loading' && (
              <span
                className={`text-xs ${
                  activeTab === 'incidents'
                    ? 'text-sky-100'
                    : criticalCount > 0
                      ? 'text-red-600 font-bold'
                      : 'text-slate-400'
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
      <ExpresswaysPanel readings={readings} navigation={navigation} onSwitchToSos={onSwitchToSos} />

      <WeatherPanel readings={readings} navigation={navigation} />

      <IncidentsPanel readings={readings} navigation={navigation} onSwitchToSos={onSwitchToSos} />

      <section className={activeTab === 'erp' ? 'flex flex-col gap-6' : 'hidden'}>
        <ErpRatesTable />
      </section>
    </div>
  );
};
