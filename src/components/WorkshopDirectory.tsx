import React, { useState, useMemo } from 'react';
import { Workshop, WorkshopCategory } from '../types/traffic';

interface WorkshopDirectoryProps {
  workshops: Workshop[];
  onBookBay: (workshop: Workshop) => void;
  onCallPhone: (phone: string, name: string) => void;
  currentMarker: string;
}

export const WorkshopDirectory: React.FC<WorkshopDirectoryProps> = ({
  workshops,
  onBookBay,
  onCallPhone,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<WorkshopCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'distance' | 'rating' | 'price'>('distance');

  const filterTabs: { id: WorkshopCategory; label: string; icon: string }[] = [
    { id: 'all', label: 'All Hubs', icon: 'tune' },
    { id: 'towing', label: '24/7 Towing', icon: 'local_shipping' },
    { id: 'insurance', label: 'Insurance (AIG/GE/NTUC)', icon: 'verified_user' },
    { id: 'fleet', label: 'Heavy Commercial Fleet', icon: 'rv_hookup' },
    { id: 'ev', label: 'EV HV-Certified', icon: 'electric_bolt' },
  ];

  const filteredWorkshops = useMemo(() => {
    return workshops
      .filter((w) => {
        const matchesCategory =
          selectedCategory === 'all' ? true : w.categories.includes(selectedCategory);
        const matchesQuery =
          searchQuery.trim() === '' ||
          w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === 'rating') return b.rating - a.rating;
        if (sortBy === 'price') return a.basePrice - b.basePrice;
        return a.distanceKm - b.distanceKm;
      });
  }, [workshops, selectedCategory, searchQuery, sortBy]);

  return (
    <div className="flex flex-col gap-4">
      {/* Directory Header & Filter Pill Bar */}
      <div className="bg-white border border-slate-200 p-4 sm:p-5 rounded-xl flex flex-col gap-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-sky-600 font-bold uppercase tracking-wider">
              Verified Network
            </span>
            <h2 className="text-lg sm:text-xl text-slate-900 font-bold">
              LTA Accredited Workshops &amp; Recovery Hubs
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span>
              Showing <strong className="text-slate-900 font-bold">{filteredWorkshops.length}</strong> hubs near corridor
            </span>
          </div>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterTabs.map((tab) => {
              const isActive = selectedCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedCategory(tab.id)}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium hidden sm:inline">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="distance">Nearest Distance</option>
              <option value="rating">Highest Rating</option>
              <option value="price">Lowest Price</option>
            </select>
          </div>
        </div>
      </div>

      {/* Directory Item Cards */}
      <div className="flex flex-col gap-3 sm:gap-4">
        {filteredWorkshops.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-4xl text-slate-400">search_off</span>
            <h3 className="text-base font-bold text-slate-800">No accredited workshops match this filter</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Try switching back to &apos;All Hubs&apos; or clear search keywords to view available LTA recovery corridors.
            </p>
            <button
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
              }}
              className="mt-2 px-3 py-1.5 bg-sky-50 text-sky-600 text-xs font-bold rounded-lg border border-sky-200"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredWorkshops.map((workshop) => (
            <div
              key={workshop.id}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-4 sm:p-5 transition-all shadow-xs hover:shadow-md flex flex-col md:flex-row gap-4"
            >
              {/* Thumbnail Visual with status badge */}
              <div className="w-full md:w-48 h-36 rounded-lg overflow-hidden shrink-0 relative bg-slate-100">
                <img
                  className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                  src={workshop.image}
                  alt={workshop.imageAlt}
                  loading="lazy"
                />
                <span
                  className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[11px] font-bold backdrop-blur-md shadow-xs border ${
                    workshop.isOpen247
                      ? 'bg-white/95 text-emerald-700 border-emerald-200'
                      : 'bg-white/95 text-slate-700 border-slate-200'
                  }`}
                >
                  {workshop.statusBadge}
                </span>
              </div>

              {/* Details & Metadata */}
              <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base sm:text-lg text-slate-900 font-bold">
                        {workshop.name}
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-sm text-sky-600 shrink-0">
                          location_on
                        </span>
                        <span>
                          {workshop.location} • {workshop.distanceKm} km from {workshop.fromMarker}
                        </span>
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="flex items-center justify-end gap-1 text-amber-500 font-bold text-xs sm:text-sm">
                        <span className="material-symbols-outlined text-sm">star</span>
                        <span>{workshop.rating.toFixed(1)}</span>
                        <span className="text-slate-400 font-normal text-xs">
                          ({workshop.reviewCount}+ reviews)
                        </span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        {workshop.baysAvailableText}
                      </span>
                    </div>
                  </div>

                  {/* Feature Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {workshop.tags.map((tag, idx) => {
                      const isHighlight =
                        tag.includes('Direct') || tag.includes('Authorized') || tag.includes('BYD');
                      return (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                            isHighlight
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Footer: Price + Book Instant Bay */}
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg sm:text-xl text-sky-600 font-bold">
                      S${workshop.basePrice}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">{workshop.priceNote}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onCallPhone(workshop.phone, workshop.name)}
                      aria-label="Call Workshop"
                      type="button"
                      className="p-2 sm:px-2.5 sm:py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer"
                      title="Call Workshop Dispatch Desk"
                    >
                      <span className="material-symbols-outlined text-base">call</span>
                    </button>
                    <button
                      onClick={() => onBookBay(workshop)}
                      type="button"
                      className="px-3 sm:px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer active:scale-95 whitespace-nowrap"
                    >
                      Book Instant Bay
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
