import React, { useState } from 'react';
import { HIGHWAY_CAMERAS, EMAS_SIGNS } from '../data/mockData';
import { HighwayCameraFeed } from '../types/traffic';

interface HighwayCamerasViewProps {
  onCallHotline: (phone: string, title: string) => void;
}

export const HighwayCamerasView: React.FC<HighwayCamerasViewProps> = ({ onCallHotline }) => {
  const [cameras, setCameras] = useState<HighwayCameraFeed[]>(HIGHWAY_CAMERAS);
  const [selectedCam, setSelectedCam] = useState<HighwayCameraFeed | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setCameras((prev) =>
        prev.map((c) => ({
          ...c,
          updatedTime: 'Live (just now)',
        }))
      );
      setRefreshing(false);
    }, 700);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
              LTA EMAS Surveillance
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            Expressway Cameras &amp; Electronic Variable Message Signs (EMAS)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Direct feed from Singapore Expressway Monitoring and Advisory System (EMAS) camera network.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-sm ${refreshing ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>{refreshing ? 'Refreshing Feeds...' : 'Refresh Cameras'}</span>
          </button>
        </div>
      </div>

      {/* Realistic EMAS Electronic LED Signboards */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500">traffic</span>
            <span>Live Expressway Variable Message Signboards (VMS)</span>
          </h2>
          <span className="text-xs text-slate-400">LED Highway Displays</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {EMAS_SIGNS.map((sign) => {
            const isCritical = sign.status === 'CRITICAL';
            const isWarning = sign.status === 'WARNING';
            const ledTextColor = isCritical
              ? 'text-red-400'
              : isWarning
              ? 'text-amber-400'
              : 'text-emerald-400';

            return (
              <div
                key={sign.id}
                className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col gap-3 relative overflow-hidden"
              >
                {/* Header of signboard */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/80 pb-2">
                  <span className="font-bold uppercase tracking-wider text-slate-300">
                    {sign.corridor}
                  </span>
                  <span className="font-mono text-slate-500">{sign.marker}</span>
                </div>

                {/* Amber/Red LED Display Area */}
                <div className="bg-black/90 p-3 rounded-lg border border-slate-800 font-mono tracking-widest text-center flex flex-col gap-1 shadow-inner">
                  <div className={`text-xs sm:text-sm font-bold ${ledTextColor} drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]`}>
                    {sign.line1}
                  </div>
                  <div className={`text-xs sm:text-sm font-bold ${ledTextColor} drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]`}>
                    {sign.line2}
                  </div>
                </div>

                {/* Signboard footer status */}
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Transmitting to Overhead Gantries</span>
                  </span>
                  <span className="font-mono text-slate-500">{sign.updatedAt}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Camera Grid */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-600">videocam</span>
            <span>Expressway Surveillance Live View</span>
          </h2>
          <span className="text-xs text-slate-500">Updated every 20 seconds</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cameras.map((cam) => (
            <div
              key={cam.id}
              onClick={() => setSelectedCam(cam)}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all cursor-pointer group flex flex-col"
            >
              <div className="h-44 relative bg-slate-900 overflow-hidden">
                <img
                  src={cam.imageUrl}
                  alt={cam.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-white text-[10px] font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                  <span>REC • {cam.corridor}</span>
                </div>
                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-white text-[10px] font-mono">
                  {cam.updatedTime}
                </div>
              </div>

              <div className="p-3.5 flex flex-col gap-1.5 flex-1 justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-xs sm:text-sm group-hover:text-sky-600 transition-colors">
                    {cam.name}
                  </h3>
                  <p className="text-slate-500 text-[11px] mt-0.5">{cam.location}</p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-700 font-semibold">{cam.speedStatus}</span>
                  <span className="text-sky-600 font-bold flex items-center gap-0.5">
                    Inspect <span className="material-symbols-outlined text-xs">zoom_in</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Snapshot Preview Modal */}
      {selectedCam && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-2xl w-full p-4 sm:p-5 flex flex-col gap-3 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedCam.name}</h3>
                <p className="text-xs text-slate-500">{selectedCam.location}</p>
              </div>
              <button
                onClick={() => setSelectedCam(null)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="w-full h-80 rounded-lg overflow-hidden relative bg-slate-950">
              <img
                src={selectedCam.imageUrl}
                alt={selectedCam.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded text-white text-xs font-mono">
                {selectedCam.speedStatus} • Weather: {selectedCam.weather}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500">Source: Land Transport Authority Traffic Operations</span>
              <button
                onClick={() => {
                  setSelectedCam(null);
                  onCallHotline('18002255582', 'EMAS Operations');
                }}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold"
              >
                Report Emergency on this Feed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
