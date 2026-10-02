import React, { useState, useEffect, useMemo, useRef } from 'react';
import { EXPRESSWAY_CORRIDORS, INCIDENT_ALERTS, TOW_FLEET_UNITS } from '../data/mockData';
import { ExpresswayCorridor, IncidentAlert } from '../types/traffic';

interface LiveRadarViewProps {
  onSwitchToSos: (corridorCode: string) => void;
  onCallHotline: (phone: string, title: string) => void;
}

// Corridor specific telemetry metadata
const CORRIDOR_TELEMETRY_SPECS: Record<
  string,
  {
    nearestBay: string;
    markerDesc: string;
    loopId: string;
    mileageKm: number;
    sensorFrequencyHz: number;
    surveillanceCamId: string;
  }
> = {
  KPE: {
    nearestBay: 'KPE Exit 2 Bay C',
    markerDesc: 'MK 6.4 Southbound before MCE Tunnel Connector',
    loopId: 'EMAS-KPE-06B',
    mileageKm: 12.0,
    sensorFrequencyHz: 433.92,
    surveillanceCamId: 'CAM-8701',
  },
  CTE: {
    nearestBay: 'CTE Exit 10 Bay A (Braddell Flyover)',
    markerDesc: 'MK 3.2 Southbound towards Moulmein Viaduct',
    loopId: 'EMAS-CTE-03A',
    mileageKm: 15.8,
    sensorFrequencyHz: 433.88,
    surveillanceCamId: 'CAM-1701',
  },
  PIE: {
    nearestBay: 'PIE Exit 13 Bay 2 (Kallang Bahru)',
    markerDesc: 'MK 12.8 Eastbound to Changi Airport',
    loopId: 'EMAS-PIE-12F',
    mileageKm: 42.8,
    sensorFrequencyHz: 433.95,
    surveillanceCamId: 'CAM-2701',
  },
  AYE: {
    nearestBay: 'AYE Exit 11 Bay B (Clementi Ave 6)',
    markerDesc: 'MK 11.5 Westbound to Tuas Mega Port',
    loopId: 'EMAS-AYE-11C',
    mileageKm: 26.5,
    sensorFrequencyHz: 433.91,
    surveillanceCamId: 'CAM-3702',
  },
  BKE: {
    nearestBay: 'BKE Exit 7 Bay 1 (Mandai Flyover)',
    markerDesc: 'MK 4.2 Northbound to Woodlands Checkpoint',
    loopId: 'EMAS-BKE-04D',
    mileageKm: 10.6,
    sensorFrequencyHz: 433.85,
    surveillanceCamId: 'CAM-4703',
  },
  SLE: {
    nearestBay: 'SLE Exit 5 Bay 3 (Lentor Ave)',
    markerDesc: 'MK 5.8 Eastbound to TPE Connector',
    loopId: 'EMAS-SLE-05E',
    mileageKm: 10.8,
    sensorFrequencyHz: 433.89,
    surveillanceCamId: 'CAM-5701',
  },
};

export const LiveRadarView: React.FC<LiveRadarViewProps> = ({
  onSwitchToSos,
  onCallHotline,
}) => {
  // Live dynamic corridors state
  const [corridors, setCorridors] = useState<ExpresswayCorridor[]>(EXPRESSWAY_CORRIDORS);
  const [selectedCorridorCode, setSelectedCorridorCode] = useState<string>('KPE');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning'>('all');

  // Live incidents list with real-time timestamps
  const [incidents, setIncidents] = useState<IncidentAlert[]>(INCIDENT_ALERTS);

  // Live telemetry pulse data
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [secondsSinceLastPing, setSecondsSinceLastPing] = useState<number>(1);
  const [packetCount, setPacketCount] = useState<number>(19420);
  const [vehicleFlowRate, setVehicleFlowRate] = useState<number>(54); // vehicles/min
  const [signalDbm, setSignalDbm] = useState<number>(-62);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [liveDataSource, setLiveDataSource] = useState<'lta_api' | 'emas_live_stream'>('emas_live_stream');

  const selectedCorridor = useMemo(() => {
    return corridors.find((c) => c.code === selectedCorridorCode) || corridors[0];
  }, [corridors, selectedCorridorCode]);

  const telemetrySpecs = useMemo(() => {
    return (
      CORRIDOR_TELEMETRY_SPECS[selectedCorridor.code] || {
        nearestBay: `${selectedCorridor.code} Exit 2 Bay A`,
        markerDesc: `${selectedCorridor.code} Mile Marker 4.5`,
        loopId: `EMAS-${selectedCorridor.code}-02A`,
        mileageKm: 15.0,
        sensorFrequencyHz: 433.9,
        surveillanceCamId: 'CAM-AUTO',
      }
    );
  }, [selectedCorridor]);

  // 1. Second-by-second heartbeat counter
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsSinceLastPing((prev) => (prev >= 6 ? 1 : prev + 1));
      setPacketCount((prev) => prev + Math.floor(Math.random() * 3) + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fetch live data from /api/traffic and /api/trafficflow if available, or run dynamic EMAS simulation loop
  const syncLiveData = async () => {
    setIsSyncing(true);

    try {
      // Check serverless endpoint for real LTA incidents
      const res = await fetch('/api/traffic');
      if (res.ok) {
        const json = await res.json();
        const ltaIncidents = json?.value || json?.items || [];
        if (Array.isArray(ltaIncidents) && ltaIncidents.length > 0) {
          const mapped: IncidentAlert[] = ltaIncidents.slice(0, 8).map((item: any, idx: number) => {
            const msg = item.Message || item.message || 'Expressway incident reported';
            const isAccident = msg.toLowerCase().includes('accident');
            const isBreakdown = msg.toLowerCase().includes('breakdown');
            const isObstacle = msg.toLowerCase().includes('obstacle');
            const type = isAccident ? 'Accident' : isBreakdown ? 'Breakdown' : isObstacle ? 'Obstacle' : 'Heavy Congestion';
            const severity = isAccident ? 'Critical' : isBreakdown ? 'Warning' : 'Info';

            return {
              id: `lta-inc-${idx}-${Date.now()}`,
              corridor: item.corridor || selectedCorridor.name,
              location: item.location || 'Expressway segment',
              type,
              lane: 'Lane 1-2 Affected',
              severity,
              timeAgo: 'Live (LTA Feed)',
              advice: msg,
              emasUnitAssigned: `EMAS Unit T-${(idx % 9) + 1}`,
            };
          });
          setIncidents(mapped);
          setLiveDataSource('lta_api');
        }
      }
    } catch {
      // Fallback to active live stream simulation
    }

    // 3. Dynamic fluctuation in corridor traffic speeds & loop sensors
    setCorridors((prevCorridors) =>
      prevCorridors.map((c) => {
        // Natural speed variation of +/- 1 to 4 km/h
        const delta = Math.floor(Math.random() * 7) - 3;
        const newSpeed = Math.max(15, Math.min(c.speedLimit, c.speedKmH + delta));

        let newStatus: ExpresswayCorridor['status'] = 'Smooth';
        if (newSpeed < 35) newStatus = 'Congested';
        else if (newSpeed < 55) newStatus = 'Heavy';
        else if (newSpeed < 75) newStatus = 'Moderate';

        // Adjust travel time inversely to speed
        const baseKm = CORRIDOR_TELEMETRY_SPECS[c.code]?.mileageKm || 15;
        const newTravelTime = Math.max(5, Math.round((baseKm / (newSpeed || 1)) * 60));

        return {
          ...c,
          speedKmH: newSpeed,
          status: newStatus,
          travelTimeMins: newTravelTime,
        };
      })
    );

    // Update telemetry sensor readings
    setVehicleFlowRate((prev) => Math.max(28, Math.min(85, prev + Math.floor(Math.random() * 7) - 3)));
    setSignalDbm((prev) => Math.max(-75, Math.min(-55, prev + (Math.random() > 0.5 ? 1 : -1))));
    setLastSyncTime(new Date());
    setSecondsSinceLastPing(0);

    setTimeout(() => {
      setIsSyncing(false);
    }, 400);
  };

  // Run live sync every 6 seconds
  useEffect(() => {
    syncLiveData();
    const interval = setInterval(syncLiveData, 6000);
    return () => clearInterval(interval);
  }, []);

  // Filtered incidents
  const filteredIncidents = incidents.filter((inc) => {
    if (filterSeverity === 'all') return true;
    if (filterSeverity === 'critical') return inc.severity === 'Critical';
    if (filterSeverity === 'warning') return inc.severity === 'Warning';
    return true;
  });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Header with Live Ticker Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
              LTA EMAS Telemetry Grid • Active Stream
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider font-mono">
              ● Live 6s Loop Sync ({secondsSinceLastPing}s ago)
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            Singapore Expressway Radar &amp; Traffic Health
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time average expressway speed sensors, congestion heatmaps, and active dispatch units.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={syncLiveData}
            disabled={isSyncing}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Force immediate radar telemetry polling"
          >
            <span className={`material-symbols-outlined text-sm ${isSyncing ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>{isSyncing ? 'Polling Sensors...' : 'Sync Telemetry'}</span>
          </button>

          <button
            onClick={() => onCallHotline('18002255582', 'EMAS Operation Center')}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">emergency</span>
            <span>Report Road Hazard</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Expressway Corridors Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {corridors.map((corridor) => {
          const isCongested = corridor.status === 'Congested';
          const isHeavy = corridor.status === 'Heavy';
          const isModerate = corridor.status === 'Moderate';

          const getStatusBadge = () => {
            if (isCongested) return 'bg-red-100 text-red-700 border-red-200';
            if (isHeavy) return 'bg-amber-100 text-amber-800 border-amber-200';
            if (isModerate) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            return 'bg-emerald-100 text-emerald-800 border-emerald-200';
          };

          const isSelected = selectedCorridor.code === corridor.code;

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
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getStatusBadge()}`}
                  >
                    {corridor.status}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 mt-1">{corridor.fromTo}</div>
              </div>

              {/* Speed Meter Bar with Live Dynamic Values */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Live Sensor Speed</span>
                  </span>
                  <span className="font-mono font-bold text-slate-900 transition-all duration-300">
                    {corridor.speedKmH} km/h{' '}
                    <span className="text-slate-400 font-normal">/ {corridor.speedLimit} max</span>
                  </span>
                </div>

                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isCongested
                        ? 'bg-red-500'
                        : isHeavy
                        ? 'bg-amber-500'
                        : isModerate
                        ? 'bg-yellow-400'
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(100, (corridor.speedKmH / corridor.speedLimit) * 100)}%`,
                    }}
                  ></div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>Travel Time: ~{corridor.travelTimeMins} mins</span>
                  <span className="font-semibold text-sky-600">
                    {corridor.towsOnline} tows patrolling
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
                <span className="text-[11px] text-slate-400 font-mono">
                  {corridor.incidentsCount} active events
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

      {/* Selected Corridor Live Radar Deep-Dive & Incidents Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Telemetry Focus Live Deep-Dive */}
        <div className="lg:col-span-7 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">
                  Telemetry Focus • Live Sensor Stream
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {selectedCorridor.name} ({selectedCorridor.code}) Sector Telemetry
              </h3>
            </div>
            <div className="text-right font-mono">
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 inline-block">
                Flow: {selectedCorridor.speedKmH} km/h
              </span>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Ping: {secondsSinceLastPing}s ago
              </div>
            </div>
          </div>

          {/* Interactive Radar Graphic Display */}
          <div className="w-full h-72 bg-slate-950 rounded-xl relative overflow-hidden flex flex-col justify-between p-4 border border-slate-800 shadow-inner">
            {/* Radar Grid Animation Backdrop */}
            <div
              className="absolute inset-0 opacity-25 pointer-events-none"
              style={{
                backgroundImage:
                  'radial-gradient(circle at center, rgba(14, 165, 233, 0.4) 1px, transparent 1px), linear-gradient(to right, rgba(14, 165, 233, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(14, 165, 233, 0.1) 1px, transparent 1px)',
                backgroundSize: '30px 30px, 30px 30px, 30px 30px',
              }}
            ></div>

            {/* Sweep radar ring */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full border border-sky-500/30 pointer-events-none animate-ping duration-1000"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-sky-400/40 pointer-events-none"></div>

            {/* Top Bar on Radar Graphic */}
            <div className="relative z-10 flex items-center justify-between">
              <div className="bg-black/80 backdrop-blur-md px-3 py-1 rounded text-white text-[11px] font-mono flex items-center gap-2 border border-white/10">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{telemetrySpecs.loopId}</span>
                <span className="text-slate-400">• {telemetrySpecs.sensorFrequencyHz} MHz</span>
              </div>

              <div className="bg-black/80 backdrop-blur-md px-2.5 py-1 rounded text-slate-300 text-[10px] font-mono border border-white/10 flex items-center gap-2">
                <span>Signal: {signalDbm} dBm</span>
                <span className="text-sky-400 font-bold">Packets: {packetCount}</span>
              </div>
            </div>

            {/* Center Blip: Speed Loop & Vehicle Passage Visualization */}
            <div className="relative z-10 my-auto flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-sky-500/20 border-2 border-sky-400 flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.5)]">
                <span className="text-white text-base font-extrabold font-mono">
                  {selectedCorridor.speedKmH}
                </span>
              </div>
              <div className="text-white text-xs font-mono font-bold mt-2 tracking-wider">
                CURRENT SECTOR SPEED: {selectedCorridor.speedKmH} KM/H
              </div>
              <div className="text-sky-300 text-[11px] font-mono mt-0.5">
                Throughput: ~{vehicleFlowRate} vehicles/min • {selectedCorridor.status} Condition
              </div>
            </div>

            {/* Bottom Card: Nearest Recovery Bay for the Selected Corridor */}
            <div className="relative z-10 bg-white/95 backdrop-blur-md p-3 rounded-lg border border-slate-200 shadow-lg flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-lg">local_shipping</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900">
                    Nearest LTA Designated Recovery Bay
                  </div>
                  <div className="text-slate-600 font-mono text-[11px]">
                    {telemetrySpecs.nearestBay} ({telemetrySpecs.markerDesc})
                  </div>
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

          {/* Detailed Sensor Telemetry Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Tows Patrolling</span>
              <span className="text-base font-bold text-slate-900 font-mono">{selectedCorridor.towsOnline} Flatbeds</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Corridor Span</span>
              <span className="text-base font-bold text-slate-900 font-mono">{telemetrySpecs.mileageKm} km</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Throughput Rate</span>
              <span className="text-base font-bold text-sky-600 font-mono">{vehicleFlowRate} veh/min</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <span className="text-slate-400 text-[10px] uppercase block font-semibold">Telemetry Latency</span>
              <span className="text-base font-bold text-emerald-600 font-mono">42 ms</span>
            </div>
          </div>
        </div>

        {/* Right: Active Expressway Incidents Feed with Real-time Updates */}
        <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <h3 className="font-bold text-slate-900 text-base">Active Expressway Incidents</h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                {liveDataSource === 'lta_api' ? 'Official LTA DataMall Feed' : 'EMAS Automated Feed'} • {filteredIncidents.length} events
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
          <div className="flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1">
            {filteredIncidents.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                No incidents match the selected filter.
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
                        onClick={() => onSwitchToSos(inc.corridor)}
                        className="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-[10px] shrink-0 cursor-pointer"
                      >
                        Dispatch
                      </button>
                    </div>

                    {inc.emasUnitAssigned && (
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                        <span className="flex items-center gap-1 font-mono text-sky-700">
                          <span className="material-symbols-outlined text-xs">local_shipping</span>
                          <span>Assigned: {inc.emasUnitAssigned}</span>
                        </span>
                        <span className="text-emerald-600 font-semibold">Extrication Active</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
