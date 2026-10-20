import { useRainFeed } from '../weather/useRainFeed';
import { rainIsValid } from '../../../shared/weather/rain';
import { useNow } from '../../utils/freshness';
import { describeExpresswaySpeed, useExpresswaySpeeds } from '../../utils/expresswaySpeeds';
import { nearestArea } from '../../utils/rainForecast';
import { countByCorridor, type IncidentFeed } from '../../utils/ltaIncidents';
import type { GnssMarker } from '../../types/traffic';
export function usePickupReadings(currentMarker: GnssMarker, incidentFeed: IncidentFeed) {
  const expresswaySpeeds = useExpresswaySpeeds();
  const rainFeed = useRainFeed();
  const now = useNow();
  const rainForecast = rainFeed.data && rainIsValid(rainFeed.data, now) ? rainFeed.data : null;
  // Live readings for the pickup expressway (the pickup location itself is a demo pin)
  const pickupCode = currentMarker.corridor;
  const pickupSpeedText = describeExpresswaySpeed(expresswaySpeeds, pickupCode);
  const pickupIncidents = countByCorridor(incidentFeed.incidents)[pickupCode] || 0;
  const pickupIncidentsText =
    incidentFeed.status === 'loading'
      ? 'Loading…'
      : incidentFeed.status === 'error' && incidentFeed.incidents.length === 0
        ? 'Unavailable'
        : `${pickupIncidents} active`;
  const pickupRainArea = rainForecast ? nearestArea(currentMarker.lat, currentMarker.lng, rainForecast.areas) : null;
  const pickupRainText = pickupRainArea
    ? `${pickupRainArea.name}: ${pickupRainArea.forecast}${rainFeed.status === 'error' ? ' (retained forecast)' : ''}`
    : rainFeed.status === 'loading'
      ? null
      : 'Forecast unavailable; retrying';

  return { pickupCode, pickupSpeedText, pickupIncidentsText, pickupRainText };
}
