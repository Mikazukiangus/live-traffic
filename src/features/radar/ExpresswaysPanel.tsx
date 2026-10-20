import { CorridorCard } from './CorridorCard';
import { SelectedCorridorMap } from './SelectedCorridorMap';
import { RadarReadings } from './useRadarReadings';
import { useRadarNavigation } from './useRadarNavigation';
type Props = {
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
export function ExpresswaysPanel({ readings, navigation, onSwitchToSos }: Props) {
  const { speedDetails, speedStatus, speedsFromSnapshot, speedsUpdatedSgt } = readings;
  const { corridors, activeTab } = navigation;

  return (
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
            Travel times, incidents and weather below are current. Speeds come back on their own once LTA's feed
            recovers.
          </span>
        </div>
      )}

      {/* Main Grid: Expressway Corridors Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-4">
        {corridors.map((corridor) => (
          <CorridorCard key={corridor.code} corridor={corridor} readings={readings} navigation={navigation} />
        ))}
      </div>

      {/* Selected expressway map and live readings */}
      <SelectedCorridorMap readings={readings} navigation={navigation} onSwitchToSos={onSwitchToSos} />
    </section>
  );
}
