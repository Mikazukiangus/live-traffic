import React, { useMemo } from 'react';

// [code, band, startLon, startLat, endLon, endLat] as returned by /api/expresswayspeeds?include=segments
export type SpeedSegment = [string, number, number, number, number, number];

// LTA speed bands: 1-7 are 10 km/h ranges, 8 is 70 km/h and above.
// Carmine through Vermilion, Orange Rufous, Yellow Ochre to Cossack Green, brightened for the dark map.
export const SPEED_BAND_COLOURS: Record<number, { colour: string; label: string }> = {
  1: { colour: '#c0303f', label: '0–9' },
  2: { colour: '#d4502f', label: '10–19' },
  3: { colour: '#d9703a', label: '20–29' },
  4: { colour: '#de8d4a', label: '30–39' },
  5: { colour: '#d8a53c', label: '40–49' },
  6: { colour: '#dcc35e', label: '50–59' },
  7: { colour: '#a3ae4e', label: '60–69' },
  8: { colour: '#6aab6c', label: '70+' },
};

// Projected units per degree; Singapore sits ~1.35°N, so lon/lat distortion is negligible.
const SCALE = 1000;
const PAD = 8;
// A fixed frame around the expressways (Tuas to Changi, Sentosa to Woodlands), so markers can be
// placed the same way whether or not LTA's speed bands have loaded.
export const MAP_BOUNDS = { minLon: 103.615, maxLon: 104.0, minLat: 1.25, maxLat: 1.465 };

export type MapMarkerKind = 'incident' | 'critical' | 'flood' | 'lightning';

export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  lat: number;
  lon: number;
  label: string;
  // Flood alerts: the area PUB says the alert covers
  radiusKm?: number;
  code?: string;
}

const MARKER_STYLE: Record<MapMarkerKind, { fill: string; r: number }> = {
  critical: { fill: '#e2414f', r: 5 },
  incident: { fill: '#f0a73a', r: 4 },
  flood: { fill: '#4fa3d9', r: 4.5 },
  lightning: { fill: '#c9a7ff', r: 2 },
};

interface SpeedBandMapProps {
  segments: SpeedSegment[];
  selectedCode: string;
  onSelect?: (code: string) => void;
  markers?: MapMarker[];
}

const x = (lon: number) => (lon - MAP_BOUNDS.minLon) * SCALE;
const y = (lat: number) => (MAP_BOUNDS.maxLat - lat) * SCALE;
const KM_PER_UNIT = 111.32 / SCALE;

export const SpeedBandMap: React.FC<SpeedBandMapProps> = ({ segments, selectedCode, onSelect, markers = [] }) => {
  const { viewBox, paths } = useMemo(() => {
    // One <path> per expressway + band keeps the DOM small (~80 paths for ~4k links).
    const grouped = new Map<string, { code: string; band: number; d: string[] }>();
    for (const [code, band, sLon, sLat, eLon, eLat] of segments) {
      const key = `${code}-${band}`;
      if (!grouped.has(key)) grouped.set(key, { code, band, d: [] });
      grouped.get(key)!.d.push(`M${x(sLon).toFixed(1)} ${y(sLat).toFixed(1)}L${x(eLon).toFixed(1)} ${y(eLat).toFixed(1)}`);
    }

    const width = (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon) * SCALE;
    const height = (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat) * SCALE;
    return {
      viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
      paths: [...grouped.values()].map((g) => ({ ...g, d: g.d.join('') })),
    };
  }, [segments]);

  // Other expressways are drawn first and dimmed; the selected one sits on top.
  const ordered = [...paths].sort(
    (a, b) => Number(a.code === selectedCode) - Number(b.code === selectedCode) || a.band - b.band
  );
  // Lightning underneath, then floods, then incidents (most severe on top).
  const RANK: Record<MapMarkerKind, number> = { lightning: 0, flood: 1, incident: 2, critical: 3 };
  const shown = markers
    .filter((m) => m.lon >= MAP_BOUNDS.minLon && m.lon <= MAP_BOUNDS.maxLon && m.lat >= MAP_BOUNDS.minLat && m.lat <= MAP_BOUNDS.maxLat)
    .sort((a, b) => RANK[a.kind] - RANK[b.kind]);

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full"
      role="img"
      aria-label={`Singapore expressways coloured by LTA speed band, ${selectedCode} highlighted${shown.length ? `, with ${shown.length} markers` : ''}`}
    >
      {ordered.map((p) => {
        const isSelected = p.code === selectedCode;
        return (
          <path
            key={`${p.code}-${p.band}`}
            d={p.d}
            fill="none"
            stroke={SPEED_BAND_COLOURS[p.band]?.colour || '#8c877c'}
            strokeWidth={isSelected ? 3.5 : 1.6}
            strokeOpacity={isSelected ? 1 : 0.35}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={onSelect ? 'cursor-pointer' : undefined}
            onClick={onSelect ? () => onSelect(p.code) : undefined}
          >
            <title>{`${p.code} • ${SPEED_BAND_COLOURS[p.band]?.label} km/h`}</title>
          </path>
        );
      })}
      {shown.map((m) => {
        const style = MARKER_STYLE[m.kind];
        const cx = x(m.lon), cy = y(m.lat);
        return (
          <g key={m.id} className={onSelect && m.code ? 'cursor-pointer' : undefined} onClick={onSelect && m.code ? () => onSelect(m.code!) : undefined}>
            <title>{m.label}</title>
            {m.kind === 'flood' && m.radiusKm ? (
              <circle cx={cx} cy={cy} r={m.radiusKm / KM_PER_UNIT} fill={style.fill} fillOpacity={0.18} stroke={style.fill} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={style.r}
              fill={style.fill}
              stroke={m.kind === 'lightning' ? 'none' : '#0f172a'}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
};

/** Toggles for the map's marker layers. */
export const MapLayerToggles: React.FC<{
  layers: Record<'incidents' | 'floods' | 'lightning', boolean>;
  counts: Record<'incidents' | 'floods' | 'lightning', number>;
  onToggle: (layer: 'incidents' | 'floods' | 'lightning') => void;
}> = ({ layers, counts, onToggle }) => {
  const items = [
    { id: 'incidents' as const, label: 'Incidents', colour: MARKER_STYLE.incident.fill },
    { id: 'floods' as const, label: 'Flood alerts', colour: MARKER_STYLE.flood.fill },
    { id: 'lightning' as const, label: 'Lightning', colour: MARKER_STYLE.lightning.fill },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Map layers">
      {items.filter((it) => it.id !== 'floods' || counts.floods > 0).map((it) => (
        <button
          key={it.id}
          onClick={() => onToggle(it.id)}
          aria-pressed={layers[it.id]}
          className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer ${
            layers[it.id] ? 'bg-white border-slate-300 text-slate-800' : 'bg-transparent border-slate-200 text-slate-400'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full border border-slate-900/40" style={{ backgroundColor: layers[it.id] ? it.colour : 'transparent' }}></span>
          {it.label} ({counts[it.id]})
        </button>
      ))}
    </div>
  );
};

export const SpeedBandLegend: React.FC = () => (
  <div className="flex items-center gap-1.5 flex-wrap">
    {Object.entries(SPEED_BAND_COLOURS).map(([band, { colour, label }]) => (
      <span key={band} className="flex items-center gap-1">
        <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: colour }}></span>
        <span>{label}</span>
      </span>
    ))}
    <span className="text-slate-400">km/h</span>
  </div>
);
