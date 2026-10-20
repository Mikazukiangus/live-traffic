import React, { useState } from 'react';
import type { GantryLocation } from './vmsBoards';
const COLLAPSED_LOCATIONS = 3;
const mapLink = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`;
export const GantryLocations: React.FC<{ locations: GantryLocation[] }> = ({ locations }) => {
  const [expanded, setExpanded] = useState(false);
  if (locations.length === 0) return null;
  const shown = expanded ? locations : locations.slice(0, COLLAPSED_LOCATIONS);
  const hidden = locations.length - shown.length;

  return (
    <div className="flex flex-col gap-1 text-[10px] border-t border-slate-800/80 pt-2">
      {shown.map((loc) => (
        <a
          key={loc.id}
          href={mapLink(loc.lat, loc.lon)}
          target="_blank"
          rel="noopener noreferrer"
          title={`${loc.id} • open in Google Maps`}
          className="flex items-center gap-1 text-slate-400 hover:text-sky-300 transition-colors min-w-0"
        >
          <span className="material-symbols-outlined text-[13px] text-sky-400 shrink-0">location_on</span>
          <span className="truncate">
            {[loc.code, loc.area && `near ${loc.area}`].filter(Boolean).join(' • ') || loc.id}
          </span>
          <span className="font-mono text-slate-500 ml-auto shrink-0">
            {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
          </span>
        </a>
      ))}
      {locations.length > COLLAPSED_LOCATIONS && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
        >
          {expanded ? 'Show fewer locations' : `Show all ${locations.length} locations (+${hidden})`}
        </button>
      )}
    </div>
  );
};
