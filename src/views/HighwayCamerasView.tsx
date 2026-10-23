import { airNotices, airStatusText } from '../features/weather/airFreshness';
import { CameraDialog } from '../features/cameras/CameraDialog';
import { CameraTile } from '../features/cameras/CameraTile';
import { CheckpointSummary } from '../features/cameras/CheckpointSummary';
import { useSpeedFeed } from '../features/traffic/useSpeedFeed';
import { useNow } from '../utils/freshness';
const NO_SEGMENTS: SpeedSegment[] = [];

import { config } from '../../config/client';
import React, { useMemo } from 'react';

import { LiveVmsBoards } from '../components/LiveVmsBoards';

import { useRainFeed } from '../features/weather/useRainFeed';
import { rainNotice } from '../features/weather/rainFreshness';
import { rainIsValid } from '../../shared/weather/rain';
import { useAirQuality } from '../utils/airQuality';
import { NearbyTraffic, trafficNear } from '../utils/expresswaySpeeds';
import { SpeedSegment } from '../components/SpeedBandMap';
import { currentVehicleCount, useVehicleCounts } from '../utils/vehicleDetection';

import { useLtaTravelTimes } from '../utils/ltaTravelTimes';
import { StaleFeed, parseSgt, sgtClock, useOnline } from '../utils/freshness';
import { formatKm, locate } from '../utils/nearMe';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { ShareButton } from '../components/ShareButton';
import { requestRefresh } from '../utils/appEvents';

import { CameraCard } from '../features/cameras/types';
import { useCameraFeed } from '../features/cameras/useCameraFeed';
import { useCameraNavigation } from '../features/cameras/useCameraNavigation';
import {
  cameraAir as airReading,
  cameraRain as rainReading,
  cameraLevel as cameraLevelReading,
  checkpointReadings,
} from '../features/cameras/cameraReadings';
import { getResolvedCameraUrl, formatSgt, captureAge } from '../features/cameras/images';
interface HighwayCamerasViewProps {
  onCallHotline: (phone: string, title: string) => void;
  // Wall display: place tabs cycle and the page's own controls are hidden
  wall?: boolean;
}

const SPEEDS_STALE_MS = config.freshness.speeds;
const LTA_CAMERAS_RETIRED_ON = '30 Jun 2026';
export const HighwayCamerasView: React.FC<HighwayCamerasViewProps> = ({ onCallHotline, wall = false }) => {
  const cameraFeed = useCameraFeed();
  const cameras = cameraFeed.cameras;
  const speedFeed = useSpeedFeed('full');
  const speeds = useMemo(
    () => Object.fromEntries((speedFeed.data?.expressways ?? []).map((e) => [e.code, e])),
    [speedFeed.data],
  );
  const segments = speedFeed.data?.segments ?? NO_SEGMENTS;
  const checkpoints = useMemo(
    () => Object.fromEntries((speedFeed.data?.checkpoints ?? []).map((c) => [c.id, c])),
    [speedFeed.data],
  );
  const speedsUpdated = speedFeed.data?.lastUpdatedTime ?? null;
  const speedsFailed = speedFeed.status === 'error';
  const now = useNow();
  const travelTimes = useLtaTravelTimes();
  // All cameras grid: which cameras to show (?cams=2701,4703); all of them when not set
  const rainFeed = useRainFeed();
  const rainForecast = rainFeed.data && rainIsValid(rainFeed.data, now) ? rainFeed.data : null;
  const airFeed = useAirQuality();
  const airQuality = airFeed.data;
  const airNotice = airStatusText(airFeed, now);
  const online = useOnline();
  const { refreshing, feedFailed, latestCapture, liveSourceDesc } = cameraFeed;
  const navigation = useCameraNavigation(cameras, wall);
  const {
    camParam,
    selectedCam,
    openCam,
    closeCam,
    stepCam,
    onSwipeStart,
    onSwipeEnd,
    shownTab,
    placeTabs,
    selectTab,
    camerasByPlace,
    nearMe,
    nearestCam,
    nearMeTapped,
    gridIds,
    gridCams,
    toggleGridCam,
  } = navigation;
  // NEA 2-hour forecast for the area nearest each camera
  // NEA 24-hour PSI and 1-hour PM2.5 for the camera's region.
  const cameraAir = (cam: CameraCard) => airReading(cam, airQuality);
  const cameraRain = (cam: CameraCard) => rainReading(cam, rainForecast);
  const speedText = (corridor: string) => {
    const s = speeds[corridor];
    return s ? `${corridor} ${s.avgSpeedKmH} km/h • ${s.status}` : null;
  };

  // Slower direction of LTA expressway traffic within 400 m of each camera.
  const nearbyTraffic = useMemo(() => {
    const byCam: Record<string, NearbyTraffic | null> = {};
    for (const cam of cameras) {
      byCam[cam.id] =
        segments.length && cam.lat != null && cam.lon != null ? trafficNear(cam.lat, cam.lon, segments) : null;
    }
    return byCam;
  }, [cameras, segments]);

  // Count vehicles in each photo, cameras on the open tab first.
  const countQueue = useMemo(() => {
    const list = cameras.map((c) => ({ id: c.id, place: c.place, imageUrl: getResolvedCameraUrl(c.imageUrl) }));
    return [...list.filter((c) => c.place === shownTab), ...list.filter((c) => c.place !== shownTab)];
  }, [cameras, shownTab]);
  const { counts: vehicleCounts } = useVehicleCounts(countQueue);

  const cameraLevel = (cam: CameraCard) => cameraLevelReading(cam, nearbyTraffic[cam.id], vehicleCounts);
  const rainWarning = rainNotice(rainFeed, now);
  const staleFeeds: StaleFeed[] = [...(rainWarning ? [rainWarning] : []), ...airNotices(airFeed, now)];
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
    staleFeeds.push({
      label: 'LTA cameras',
      detail: `not responding; newest photo from ${formatSgt(latestCapture).slice(0, 5)} SGT`,
    });
  }

  const tabClass = (selected: boolean) =>
    `flex-1 sm:flex-none min-h-11 px-2 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
      selected ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const latestAge = latestCapture ? captureAge(latestCapture, now) : null;

  // Checkpoint summary: bridge camera reading, drive to the checkpoint, queue near it
  const checkpointSummary = checkpointReadings(cameras, vehicleCounts, checkpoints, travelTimes.routes, cameraLevel);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 flex flex-col gap-4 sm:gap-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {shownTab === 'signs' ? 'Road Signs' : 'Live Cameras'}
          </h1>
          {shownTab === 'signs' ? (
            <p className="text-sm text-slate-500 mt-1">LTA messages & locations</p>
          ) : (
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${feedFailed ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`}
              ></span>
              <span>{feedFailed ? 'Feed unavailable, retrying' : latestAge ? `Updated ${latestAge}` : 'Loading…'}</span>
              <span
                className="material-symbols-outlined text-base text-slate-400 cursor-help"
                title={`${liveSourceDesc}, refreshed every ${Math.round(config.poll.cameras / 1000)} seconds. LTA retired its other expressway cameras on ${LTA_CAMERAS_RETIRED_ON}; only the Woodlands, Tuas and Sentosa cameras remain.`}
              >
                info
              </span>
            </p>
          )}
        </div>
        <div className={`items-center gap-2 shrink-0 ${wall ? 'hidden' : 'flex'}`}>
          {shownTab !== 'signs' && (
            <button
              onClick={() => {
                nearMeTapped.current = true;
                locate();
              }}
              disabled={nearMe.status === 'locating'}
              aria-label="Near me"
              title="Open the cameras nearest you. Your location stays on this device."
              className={`h-11 min-w-11 px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 ${
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
          )}
          <ShareButton title={shownTab === 'signs' ? 'Road Signs SG' : 'Live Cameras SG'} className="!h-11 !w-11" />
          <button
            onClick={requestRefresh}
            disabled={refreshing}
            aria-label="Refresh cameras and road signs"
            title="Refresh cameras, signs and weather"
            className="w-11 h-11 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer shadow-xs disabled:opacity-50"
          >
            <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs stay pinned under the fixed site header while scrolling */}
      <nav
        aria-label="Camera views"
        className="sticky top-16 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-slate-50/95 backdrop-blur-sm"
      >
        <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl shadow-xs w-full sm:w-fit">
          {placeTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              aria-pressed={shownTab === t.id}
              className={tabClass(shownTab === t.id)}
            >
              <span>{t.label}</span>
              <span className={`hidden sm:inline text-xs ${shownTab === t.id ? 'text-sky-100' : 'text-slate-400'}`}>
                {camerasByPlace[t.id]?.length || 0}
              </span>
            </button>
          ))}
          <button
            onClick={() => selectTab('signs')}
            aria-pressed={shownTab === 'signs'}
            className={tabClass(shownTab === 'signs')}
          >
            <span className="sm:hidden">Signs</span>
            <span className="hidden sm:inline">Road Signs</span>
          </button>
          <button
            onClick={() => selectTab('all')}
            aria-pressed={shownTab === 'all'}
            className={tabClass(shownTab === 'all')}
          >
            <span className="sm:hidden">All</span>
            <span className="hidden sm:inline">All cameras</span>
          </button>
        </div>
      </nav>

      {shownTab !== 'signs' && <StaleDataNotice feeds={staleFeeds} online={online} compact />}

      {shownTab !== 'signs' && nearMe.status === 'found' && nearestCam && (
        <p className="text-sm text-slate-600 flex items-center gap-2 -mb-2">
          <span className="material-symbols-outlined text-base text-sky-600">my_location</span>
          Nearest camera: <span className="font-semibold text-slate-800">{nearestCam.cam.short}</span>,{' '}
          {formatKm(nearestCam.km)} away
        </p>
      )}
      {shownTab !== 'signs' && (nearMe.status === 'denied' || nearMe.status === 'unavailable') && (
        <p className="text-sm text-slate-600 flex items-center gap-2 -mb-2">
          <span className="material-symbols-outlined text-base text-slate-400">location_off</span>
          {nearMe.status === 'denied'
            ? 'Location is blocked for this site. Allow it in your browser settings to use Near me.'
            : "Couldn't find your location. Try again in a moment."}
        </p>
      )}

      {cameras.length === 0 && shownTab !== 'signs' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          {refreshing
            ? 'Loading cameras…'
            : `Camera feed unavailable. Retrying every ${Math.round(config.poll.cameras / 1000)} seconds.`}
        </div>
      )}

      {camParam && !selectedCam && !refreshing && (
        <p role="status" className="text-sm text-amber-800">
          Camera {camParam} is unavailable in the latest feed. Choose another camera below.
        </p>
      )}

      {/* Every tab stays mounted (hidden when inactive) so images and signs are ready on tap */}
      {placeTabs.map((t) => {
        const placeCams = camerasByPlace[t.id] || [];
        if (placeCams.length === 0) return null;
        const summary = checkpointSummary.find((c) => c.id === t.id)!;
        const rain = cameraRain(placeCams[0]);
        const air = cameraAir(placeCams[0]);

        return (
          <section key={t.id} className={shownTab === t.id ? 'flex flex-col gap-5' : 'hidden'}>
            {/* Only the selected checkpoint's summary is visible, with details available on tap. */}
            <CheckpointSummary summary={summary} label={t.label} rain={rain} air={air} rainForecast={rainForecast} airNotice={airNotice} />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {placeCams.map((cam) => (
                <CameraTile
                  key={cam.id}
                  cam={cam}
                  now={now}
                  reading={cameraLevel(cam)}
                  counted={currentVehicleCount(vehicleCounts, cam.id, getResolvedCameraUrl(cam.imageUrl))}
                  openCam={openCam}
                />
              ))}
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
                className={`min-h-11 px-3 rounded-full border text-xs font-semibold cursor-pointer flex items-center gap-1 ${
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
            {gridCams.map((cam) => (
              <CameraTile key={cam.id} cam={cam} now={now} reading={cameraLevel(cam)} openCam={openCam} compact />
            ))}
          </div>
        )}
      </section>

      <section className={shownTab === 'signs' ? '' : 'hidden'}>
        <LiveVmsBoards areas={rainForecast?.areas} />
      </section>

      {/* Enlarged camera */}
      {selectedCam && (
        <CameraDialog
          selectedCam={selectedCam}
          camerasByPlace={camerasByPlace}
          closeCam={closeCam}
          stepCam={stepCam}
          onSwipeStart={onSwipeStart}
          onSwipeEnd={onSwipeEnd}
          now={now}
          vehicleCounts={vehicleCounts}
          cameraLevel={cameraLevel}
          cameraAir={cameraAir}
          airNotice={airNotice}
          cameraRain={cameraRain}
          speedText={speedText}
          onCallHotline={onCallHotline}
        />
      )}
    </div>
  );
};
