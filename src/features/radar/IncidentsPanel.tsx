import { useState, useEffect, useRef } from 'react';
import { shortDate, worksBy } from '../../utils/roadConditions';
import { RadarReadings } from './useRadarReadings';
import { useRadarNavigation } from './useRadarNavigation';
type Props = {
  readings: Pick<
    RadarReadings,
    'incidents' | 'incidentStatus' | 'incidentsFetchedAt' | 'expresswayIncidentCount' | 'roadConditions' | 'worksByCode'
  >;
  navigation: Pick<ReturnType<typeof useRadarNavigation>, 'corridors' | 'incidentParam' | 'activeTab'>;
  onSwitchToSos: (code: string) => void;
};
export function IncidentsPanel({ readings, navigation, onSwitchToSos }: Props) {
  const { incidents, incidentStatus, incidentsFetchedAt, expresswayIncidentCount, roadConditions, worksByCode } =
    readings;
  const { corridors, incidentParam, activeTab } = navigation;

  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning'>('all');
  const focusedIncident = useRef<string | null>(null);
  useEffect(() => {
    if (!incidentParam || activeTab !== 'incidents') {
      focusedIncident.current = null;
      return;
    }
    if (focusedIncident.current === incidentParam || !incidents.some((i) => i.id === incidentParam)) return;
    focusedIncident.current = incidentParam;
    setFilterSeverity('all');
    const timer = setTimeout(
      () =>
        document.getElementById(`incident-${incidentParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    );
    return () => clearTimeout(timer);
  }, [incidentParam, activeTab, incidents]);

  // Filtered incidents
  const filteredIncidents = incidents.filter((inc) => {
    if (filterSeverity === 'all') return true;
    if (filterSeverity === 'critical') return inc.severity === 'Critical';
    if (filterSeverity === 'warning') return inc.severity === 'Warning';
    return true;
  });

  return (
    <section className={activeTab === 'incidents' ? 'flex flex-col gap-6' : 'hidden'}>
      {/* Active expressway incidents, live from LTA */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <h3 className="font-bold text-slate-900 text-base">Happening Now</h3>
            </div>
            <span
              className={`text-[11px] font-mono ${incidentStatus === 'error' ? 'text-amber-700' : 'text-slate-400'}`}
            >
              {incidentStatus === 'loading'
                ? 'LTA DataMall • loading…'
                : `LTA DataMall • ${incidents.length} active (${expresswayIncidentCount} on expressways)${
                    incidentsFetchedAt
                      ? ` • ${incidentStatus === 'error' ? 'refresh failed, last' : 'updated'} ${incidentsFetchedAt} SGT`
                      : ''
                  }`}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterSeverity('all')}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                filterSeverity === 'all' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterSeverity('critical')}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                filterSeverity === 'critical' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => setFilterSeverity('warning')}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer ${
                filterSeverity === 'warning' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:bg-slate-100'
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
                  ? 'LTA incident feed unavailable. Retrying automatically.'
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
                  id={`incident-${inc.id}`}
                  className={`${inc.id === incidentParam ? 'ring-2 ring-sky-500 scroll-mt-24' : ''} p-3 rounded-lg border flex flex-col gap-1.5 text-xs transition-all ${
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
                          isCritical ? 'bg-red-500 animate-ping' : isWarning ? 'bg-amber-500' : 'bg-sky-500'
                        }`}
                      ></span>
                      <span className="font-bold text-slate-900">{inc.corridor}</span>
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
          <span className="material-symbols-outlined text-slate-500 group-open/works:rotate-180 transition-transform">
            expand_more
          </span>
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
              <div className="text-xs text-slate-400">
                {roadConditions.status === 'error' ? 'LTA road works unavailable.' : 'Loading LTA road works…'}
              </div>
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
                          <span className="material-symbols-outlined text-base group-open:rotate-180 transition-transform">
                            expand_more
                          </span>
                        </span>
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                        {worksByCode[c.code].map((w) => (
                          <li key={w.id} className="flex justify-between gap-3">
                            <span className="truncate">
                              {worksBy(w.by)}
                              {/TUNNEL/i.test(w.road) ? ' · tunnel' : ''}
                            </span>
                            <span className="font-mono shrink-0">
                              {shortDate(w.start)} – {shortDate(w.end)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                {Object.keys(worksByCode).length === 0 && (
                  <div className="text-xs text-slate-500 py-2">No expressway road works listed for today.</div>
                )}
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
              <div className="text-xs text-slate-400">
                {roadConditions.status === 'error' ? 'LTA traffic light faults unavailable.' : 'Loading…'}
              </div>
            ) : roadConditions.data.faultyLights == null ? (
              <div className="text-xs text-slate-500">LTA traffic light faults unavailable.</div>
            ) : roadConditions.data.faultyLights.length === 0 ? (
              <div className="text-xs text-slate-500">No faulty traffic lights reported.</div>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {roadConditions.data.faultyLights.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3">
                    <span className="text-slate-800">
                      <span className="mr-1.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase">
                        {l.kind}
                      </span>
                      {l.message.replace(/^(Black Out|Flashing Yellow) at /i, '')}
                    </span>
                    {l.since && (
                      <span className="text-xs font-mono text-slate-500 shrink-0">since {l.since.slice(11)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
