import { MapLayerToggles, SpeedBandMap, SpeedBandLegend } from '../../components/SpeedBandMap';
import { describeCorridorRain } from '../../utils/rainForecast';
import { ExpresswaysPanelProps } from './expresswayPanelTypes';

type Props = {
  readings: Pick<
    ExpresswaysPanelProps['readings'],
    | 'incidents'
    | 'incidentStatus'
    | 'incidentCounts'
    | 'speedStatus'
    | 'speedSegments'
    | 'speedsFromSnapshot'
    | 'floodAlerts'
    | 'rainByCode'
    | 'selectedCorridor'
    | 'selectedSpeed'
    | 'travelTimeText'
    | 'speedsUpdatedSgt'
    | 'layers'
    | 'toggleLayer'
    | 'strikes'
    | 'mappedIncidents'
    | 'mapMarkers'
  >;
  navigation: Pick<ExpresswaysPanelProps['navigation'], 'setSelectedCorridorCode'>;
  onSwitchToSos: (code: string) => void;
};
export function SelectedCorridorMap({ readings, navigation, onSwitchToSos }: Props) {
  const {
    incidentStatus,
    incidentCounts,
    speedStatus,
    speedSegments,
    speedsFromSnapshot,
    floodAlerts,
    rainByCode,
    selectedCorridor,
    selectedSpeed,
    travelTimeText,
    speedsUpdatedSgt,
    layers,
    toggleLayer,
    strikes,
    mappedIncidents,
    mapMarkers,
  } = readings;
  const { setSelectedCorridorCode } = navigation;
  return (
    <div
      id="speed-map"
      className="scroll-mt-32 xl:sticky xl:top-32 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4"
    >
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
      <div
        className={`w-full h-[26rem] fixed-palette bg-slate-950 rounded-xl relative overflow-hidden flex flex-col justify-between p-4 border border-slate-800 shadow-inner`}
      >
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
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-slate-600"
        >
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
  );
}
