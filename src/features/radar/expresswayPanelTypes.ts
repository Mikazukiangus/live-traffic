import type { RadarReadings } from './useRadarReadings';
import type { useRadarNavigation } from './useRadarNavigation';
export type ExpresswaysPanelProps = {
  readings: Pick<
    RadarReadings,
    | 'incidents'
    | 'incidentStatus'
    | 'incidentCounts'
    | 'speedDetails'
    | 'speedStatus'
    | 'speedSegments'
    | 'speedsFromSnapshot'
    | 'travelTimes'
    | 'worksByCode'
    | 'floodAlerts'
    | 'lightningByCode'
    | 'floodsByCode'
    | 'rainByCode'
    | 'selectedCorridor'
    | 'selectedSpeed'
    | 'travelTimeText'
    | 'speedUnavailableText'
    | 'speedsUpdatedSgt'
    | 'layers'
    | 'toggleLayer'
    | 'strikes'
    | 'mappedIncidents'
    | 'mapMarkers'
  >;
  navigation: Pick<ReturnType<typeof useRadarNavigation>, 'corridors' | 'setSelectedCorridorCode' | 'activeTab'>;
  onSwitchToSos: (code: string) => void;
};
