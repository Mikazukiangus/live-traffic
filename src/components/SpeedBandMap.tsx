import React, { useMemo } from 'react';

// [code, band, startLon, startLat, endLon, endLat] as returned by /api/expresswayspeeds?include=segments
export type SpeedSegment = [string, number, number, number, number, number];

// LTA speed bands: 1-7 are 10 km/h ranges, 8 is 70 km/h and above.
export const SPEED_BAND_COLOURS: Record<number, { colour: string; label: string }> = {
  1: { colour: '#b91c1c', label: '0–9' },
  2: { colour: '#ef4444', label: '10–19' },
  3: { colour: '#f97316', label: '20–29' },
  4: { colour: '#fb923c', label: '30–39' },
  5: { colour: '#f59e0b', label: '40–49' },
  6: { colour: '#facc15', label: '50–59' },
  7: { colour: '#84cc16', label: '60–69' },
  8: { colour: '#22c55e', label: '70+' },
};

// Projected units per degree; Singapore sits ~1.35°N, so lon/lat distortion is negligible.
const SCALE = 1000;
const PAD = 8;

interface SpeedBandMapProps {
  segments: SpeedSegment[];
  selectedCode: string;
  onSelect?: (code: string) => void;
}

export const SpeedBandMap: React.FC<SpeedBandMapProps> = ({ segments, selectedCode, onSelect }) => {
  const { viewBox, paths } = useMemo(() => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [, , sLon, sLat, eLon, eLat] of segments) {
      minLon = Math.min(minLon, sLon, eLon);
      maxLon = Math.max(maxLon, sLon, eLon);
      minLat = Math.min(minLat, sLat, eLat);
      maxLat = Math.max(maxLat, sLat, eLat);
    }
    const x = (lon: number) => ((lon - minLon) * SCALE).toFixed(1);
    const y = (lat: number) => ((maxLat - lat) * SCALE).toFixed(1);

    // One <path> per expressway + band keeps the DOM small (~80 paths for ~4k links).
    const grouped = new Map<string, { code: string; band: number; d: string[] }>();
    for (const [code, band, sLon, sLat, eLon, eLat] of segments) {
      const key = `${code}-${band}`;
      if (!grouped.has(key)) grouped.set(key, { code, band, d: [] });
      grouped.get(key)!.d.push(`M${x(sLon)} ${y(sLat)}L${x(eLon)} ${y(eLat)}`);
    }

    const width = (maxLon - minLon) * SCALE;
    const height = (maxLat - minLat) * SCALE;
    return {
      viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
      paths: [...grouped.values()].map((g) => ({ ...g, d: g.d.join('') })),
    };
  }, [segments]);

  // Other expressways are drawn first and dimmed; the selected one sits on top.
  const ordered = [...paths].sort(
    (a, b) => Number(a.code === selectedCode) - Number(b.code === selectedCode) || a.band - b.band
  );

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full"
      role="img"
      aria-label={`Singapore expressways coloured by LTA speed band, ${selectedCode} highlighted`}
    >
      {ordered.map((p) => {
        const isSelected = p.code === selectedCode;
        return (
          <path
            key={`${p.code}-${p.band}`}
            d={p.d}
            fill="none"
            stroke={SPEED_BAND_COLOURS[p.band]?.colour || '#64748b'}
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
    </svg>
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
