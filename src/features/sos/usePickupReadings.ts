import { describeExpresswaySpeed, useExpresswaySpeeds } from '../../utils/expresswaySpeeds';
import { nearestArea, useRainForecast } from '../../utils/rainForecast';
import { countByCorridor, type IncidentFeed } from '../../utils/ltaIncidents';
import type { GnssMarker } from '../../types/traffic';
export function usePickupReadings(currentMarker: GnssMarker, incidentFeed: IncidentFeed) {
  const expresswaySpeeds = useExpresswaySpeeds();
  const rainForecast = useRainForecast();
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
  const pickupRainText = pickupRainArea ? `${pickupRainArea.name}: ${pickupRainArea.forecast}` : null;

  return { pickupCode, pickupSpeedText, pickupIncidentsText, pickupRainText };
}
