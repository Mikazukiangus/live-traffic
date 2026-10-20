import { FORECAST_AREAS } from '../../../shared/geography/forecastAreas';
import { matchLightningToExpressways, matchFloodsToExpressways } from '../../../shared/geography/hazardMatching';
import { useRainFeed } from '../weather/useRainFeed';
import { rainIsValid } from '../../../shared/weather/rain';
import { useNow } from '../../utils/freshness';
import { useSpeedFeed } from '../traffic/useSpeedFeed';
const NO_SEGMENTS: SpeedSegment[] = [];

import { useMemo } from 'react';
import type { SpeedSegment } from '../../../shared/traffic/types';
import { rainByExpressway } from '../../utils/rainForecast';
import { useLtaTravelTimes } from '../../utils/ltaTravelTimes';
import { useAirQuality } from '../../utils/airQuality';
import { roadWorksByCode, useRoadConditions } from '../../utils/roadConditions';
import { useWeatherAlerts } from '../../utils/weatherAlerts';
import { useFloodAlerts } from '../../utils/floodAlerts';

export function useRadarSources() {
  // Real expressway speeds from LTA speed bands (no values until the first successful fetch)
  const speedFeed = useSpeedFeed('full');
  const speedDetails = useMemo(
    () => (speedFeed.data ? Object.fromEntries(speedFeed.data.expressways.map((e) => [e.code, e])) : null),
    [speedFeed.data],
  );
  const speedStatus = speedFeed.status;
  const speedBandsUpdated = speedFeed.data?.lastUpdatedTime ?? null;
  const speedSegments = speedFeed.data?.segments ?? NO_SEGMENTS;
  const speedsFromSnapshot = speedFeed.fromSnapshot;
  const refreshing = speedFeed.refreshing;
  // LTA estimated travel times per expressway and direction
  const travelTimes = useLtaTravelTimes();

  // NEA 2-hour rain forecast for the areas along each expressway (needs no LTA speed data)
  const rainFeed = useRainFeed();
  const now = useNow();
  const rainForecast = rainFeed.data && rainIsValid(rainFeed.data, now) ? rainFeed.data : null;

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
  const lightningMatch = useMemo(
    () => matchLightningToExpressways(weatherAlerts.data?.strikes, FORECAST_AREAS),
    [weatherAlerts.data],
  );
  const floodMatch = useMemo(() => matchFloodsToExpressways(floodFeed.data?.alerts, FORECAST_AREAS), [floodFeed.data]);
  const lightningByCode = lightningMatch.byCode;
  const floodsByCode = floodMatch.byCode;
  const rainByCode = useMemo(() => (rainForecast ? rainByExpressway(rainForecast.areas) : {}), [rainForecast]);

  return {
    refreshing,
    speedDetails,
    speedStatus,
    speedBandsUpdated,
    speedSegments,
    speedsFromSnapshot,
    travelTimes,
    rainForecast,
    rainFeed,
    airQuality,
    roadConditions,
    worksByCode,
    weatherAlerts,
    floodFeed,
    floodAlerts,
    lightningMatch,
    floodMatch,
    lightningByCode,
    floodsByCode,
    rainByCode,
  };
}
export type RadarSources = ReturnType<typeof useRadarSources>;
