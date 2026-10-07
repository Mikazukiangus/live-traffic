import React, { useMemo, useState } from 'react';
import { nearestCarParks, useCarParks } from '../utils/carParks';
import { formatKm, locate, useNearMe } from '../utils/nearMe';
import { sgtClock } from '../utils/freshness';

type LotType = 'car' | 'motorcycle' | 'heavy';

const LOT_TABS: { id: LotType; label: string; icon: string }[] = [
  { id: 'car', label: 'Cars', icon: 'directions_car' },
  { id: 'heavy', label: 'Heavy vehicles', icon: 'local_shipping' },
  { id: 'motorcycle', label: 'Motorcycles', icon: 'two_wheeler' },
];

interface CarParkAvailabilityProps {
  // The pickup point, used until Near me finds the visitor
  lat: number;
  lon: number;
  placeLabel: string;
}

/** Nearest LTA, HDB and URA car parks with free lots, worked out in the browser. */
export const CarParkAvailability: React.FC<CarParkAvailabilityProps> = ({ lat, lon, placeLabel }) => {
  const { data, status, fetchedAt } = useCarParks();
  const nearMe = useNearMe();
  const [lotType, setLotType] = useState<LotType>('car');
  const here = nearMe.status === 'found' && nearMe.lat != null && nearMe.lon != null ? { lat: nearMe.lat, lon: nearMe.lon, label: 'you' } : { lat, lon, label: placeLabel };

  const nearest = useMemo(
    () => (data?.carParks ? nearestCarParks(here.lat, here.lon, data.carParks, 8, lotType) : []),
    [data, here.lat, here.lon, lotType]
  );

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">LTA Car Park Availability</span>
          <h3 className="text-lg font-bold text-slate-900">Free Lots Nearest {here.label === 'you' ? 'You' : 'the Pickup'}</h3>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
            {here.label === 'you' ? 'From your location' : `From ${placeLabel}`}
            {fetchedAt ? ` • updated ${sgtClock(fetchedAt)} SGT` : ''}
          </p>
        </div>
        <button
          onClick={locate}
          disabled={nearMe.status === 'locating'}
          className={`h-9 px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
            nearMe.status === 'found' ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="material-symbols-outlined text-base">my_location</span>Near me
        </button>
      </div>

      <div className="flex gap-1 p-1 bg-slate-50 border border-slate-200 rounded-xl w-full sm:w-fit">
        {LOT_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setLotType(t.id)}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
              lotType === t.id ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="text-xs text-slate-400">{status === 'error' ? 'LTA car park availability is unavailable.' : 'Loading car parks…'}</div>
      ) : nearest.length === 0 ? (
        <div className="text-xs text-slate-500">No car parks with this lot type nearby.</div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {nearest.map(({ park, km }) => {
            const lots = park[lotType] ?? 0;
            return (
              <li key={park.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate" title={park.name}>{park.name}</div>
                  <div className="text-xs text-slate-500">
                    {formatKm(km)} away • {park.agency}
                  </div>
                </div>
                <div className={`text-right shrink-0 font-mono font-bold ${lots === 0 ? 'text-red-700' : lots < 10 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {lots === 0 ? (
                    'Full'
                  ) : (
                    <>
                      {lots}
                      <span className="block text-[10px] font-sans font-normal text-slate-500">{lots === 1 ? 'lot' : 'lots'} free</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">Straight-line distance. LTA, HDB and URA car parks only; private car parks aren't in LTA's feed.</p>
    </div>
  );
};
