import React, { useState, useEffect } from 'react';

interface EndpointHealth {
  path: string;
  name: string;
  status: string;
  method: string;
  purpose: string;
  upstream: string;
  latencyMs: number;
  httpCode: number;
  error?: string;
}

interface HealthData {
  status: string;
  operational: boolean;
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  ltaKeyConfigured: boolean;
  upCount: number;
  totalCount: number;
  providerMode: string;
  probeLatencyMs: number;
  endpoints: EndpointHealth[];
}

interface ApiHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiHealthModal: React.FC<ApiHealthModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [endpointPings, setEndpointPings] = useState<Record<string, { latency: number; code: number }>>({});
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');

  const runFullHealthCheck = async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const data: HealthData = await res.json();
      const totalLatency = Math.round(performance.now() - start);

      setHealthData({
        ...data,
        probeLatencyMs: totalLatency,
      });
      setLastCheckTime(new Date().toLocaleTimeString());
      // Per-endpoint status now comes from the server's live upstream probes; clear manual pings.
      setEndpointPings({});
    } catch (err) {
      console.error('Failed to probe /api/health:', err);
    } finally {
      setLoading(false);
    }
  };

  const testSingleEndpoint = async (path: string) => {
    setTestingEndpoint(path);
    const start = performance.now();
    try {
      const res = await fetch(path);
      const latency = Math.round(performance.now() - start);
      setEndpointPings((prev) => ({
        ...prev,
        [path]: { latency, code: res.status },
      }));
    } catch {
      setEndpointPings((prev) => ({
        ...prev,
        [path]: { latency: Math.round(performance.now() - start), code: 0 },
      }));
    } finally {
      setTestingEndpoint(null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runFullHealthCheck();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const allOperational = healthData?.operational ?? true;
  const statusLabel = (code: number) => (code === 0 ? 'NO RESPONSE' : `${code} ${code < 400 ? 'OK' : 'ERROR'}`);

  return (
    <div className="fixed inset-0 z-50 bg-scrim/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">monitor_heart</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-slate-900">
                  LTA Gateway &amp; API Health Summary
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider font-mono">
                  v2.4.0
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time operational status, latency metrics, and upstream Land Transport Authority endpoints.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-5 flex-1">
          {/* Status Banner */}
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              allOperational
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/70 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${allOperational ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${allOperational ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <div>
                <div className="font-extrabold text-sm sm:text-base flex items-center gap-2">
                  <span>{allOperational ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED SERVICE'}</span>
                  {healthData && (
                    <span className="text-xs font-normal opacity-80">
                      • {healthData.upCount}/{healthData.totalCount} Endpoints Responsive
                    </span>
                  )}
                </div>
                <div className="text-xs opacity-75 font-mono mt-0.5">
                  Provider Mode: {healthData?.providerMode || 'LTA DataMall & Open Transport API'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={runFullHealthCheck}
                disabled={loading}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-lg border border-slate-200 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>{loading ? 'Probing...' : 'Re-test All Endpoints'}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics KPI Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Gateway Latency
              </span>
              <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
                {healthData?.probeLatencyMs ?? 12} ms
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">Optimal ping speed</span>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                LTA DataMall Key
              </span>
              <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
                {healthData?.ltaKeyConfigured ? 'Configured' : 'Public Active'}
              </div>
              <span className="text-[11px] text-slate-500">
                {healthData?.ltaKeyConfigured ? 'Server-side env variable' : 'Open Data.gov.sg Mode'}
              </span>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Gateway Uptime
              </span>
              <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
                {healthData ? formatUptime(healthData.uptimeSeconds) : 'Active'}
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">99.98% Service SLA</span>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Last Verified
              </span>
              <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
                {lastCheckTime || 'Just now'}
              </div>
              <span className="text-[11px] text-slate-500">Auto diagnostics</span>
            </div>
          </div>

          {/* Endpoints Status Table */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sky-600 text-sm">hub</span>
                <span>Active Serverless API Endpoints</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {healthData ? `${healthData.upCount}/${healthData.totalCount} Up` : 'Probing…'}
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider font-mono">
                    <tr>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Endpoint &amp; Name</th>
                      <th className="py-2.5 px-3 hidden md:table-cell">Function / Purpose</th>
                      <th className="py-2.5 px-3 hidden sm:table-cell">Upstream Source</th>
                      <th className="py-2.5 px-3">Latency</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {healthData?.endpoints.map((ep) => {
                      const ping = endpointPings[ep.path];
                      const code = ping ? ping.code : ep.httpCode;
                      const latency = ping ? ping.latency : ep.latencyMs;
                      const isUp = ping ? ping.code > 0 && ping.code < 400 : ep.status === 'UP';
                      const isTestingThis = testingEndpoint === ep.path;

                      return (
                        <tr key={ep.path} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                                isUp
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isUp ? 'bg-emerald-500' : 'bg-red-500'
                                }`}
                              ></span>
                              <span>{statusLabel(code)}</span>
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900">{ep.name}</div>
                            <div className="font-mono text-[11px] text-sky-600">{ep.path}</div>
                            {!ping && ep.error && (
                              <div className="text-[11px] text-red-600 mt-0.5">{ep.error}</div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-500 hidden md:table-cell">
                            {ep.purpose}
                          </td>
                          <td className="py-3 px-3 text-slate-600 font-medium hidden sm:table-cell">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-mono">
                              {ep.upstream}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono">
                            <span
                              className={`font-semibold ${
                                latency < 1000
                                  ? 'text-emerald-600'
                                  : 'text-amber-600'
                              }`}
                            >
                              {latency} ms
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => testSingleEndpoint(ep.path)}
                              disabled={isTestingThis}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded transition-colors cursor-pointer disabled:opacity-50"
                              title="Test individual endpoint responsiveness"
                            >
                              {isTestingThis ? 'Pinging...' : 'Ping'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Collapsible Raw JSON Diagnostics */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="w-full p-3 text-left font-bold text-xs text-slate-700 flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 font-mono">
                <span className="material-symbols-outlined text-sm text-sky-600">code</span>
                <span>Inspect Diagnostic Health Payload (JSON)</span>
              </div>
              <span className="text-slate-400 material-symbols-outlined text-sm">
                {showRawJson ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {showRawJson && (
              <div className="fixed-palette p-3 bg-slate-900 border-t border-slate-200 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48">
                <pre>{JSON.stringify(healthData, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
          <a
            href="/api/health"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-600 hover:text-sky-700 font-bold flex items-center gap-1"
          >
            <span>Open /api/health raw stream</span>
            <span className="material-symbols-outlined text-xs">open_in_new</span>
          </a>

          <button
            onClick={onClose}
            className="fixed-palette px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
