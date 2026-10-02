import React, { useState } from 'react';
import { TabType } from '../types/traffic';

interface HeaderProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onSearchCorridor: (query: string) => void;
  searchQuery: string;
  onOpenNotifications: () => void;
  notificationCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onSearchCorridor,
  searchQuery,
  onOpenNotifications,
  notificationCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { id: TabType; label: string }[] = [
    { id: 'live-traffic-radar', label: 'Live Traffic Radar' },
    { id: 'highway-cameras-emas', label: 'Highway Cameras & EMAS' },
    { id: 'roadside-sos-workshops', label: 'Roadside SOS & Workshops' },
    { id: 'route-alerts-courier-hub', label: 'Route Alerts & Courier Hub' },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
      <div className="h-16 w-full px-4 sm:px-6 flex items-center justify-between gap-3 max-w-7xl mx-auto">
        {/* Left: Brand logo & live badge */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onSelectTab('roadside-sos-workshops')}
            className="flex items-center gap-2 text-left group"
          >
            <img
              alt="TrafficPulse LTA"
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
              src="https://lh3.googleusercontent.com/aida/AEtjO1Xo74j4HdhU9fo3r9PDBNVSZPAUTvtU8zMNm27IkQFzPDkigw9wLD76nvPe4HjSH4zros0xkeurfNkplRPaeiEcPEMpLtHxQTanpsNZdSWWfYJ_WRUM-EJGCnLTRBdIrHOLF9vW8wklrCiVVhS10b-k5kp5FPU6UCsRS5Exixwahj7N9YxstOsNGNcu1szRNnkXgcuL-kZM0gFFRanEdX8lA1OY6I-QSdUcqAAeeYJ7hmolxZhjDsBmyCw"
            />
            <span className="text-lg font-bold tracking-tight text-sky-600 hidden sm:inline font-sans">
              TrafficPulse
            </span>
          </button>

          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[11px] text-emerald-700 uppercase tracking-wider font-bold">
              LTA DataMall Live
            </span>
          </div>
        </div>

        {/* Center-Left: Corridor search lookup */}
        <div className="hidden md:flex items-center flex-1 max-w-xs mx-3">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchCorridor(e.target.value)}
              placeholder="Corridor lookup (e.g. PIE, CTE)..."
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchCorridor('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Center: Navigation tabs */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-sky-600 font-bold bg-sky-50 border border-sky-100 shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Notification & Profile */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenNotifications}
            aria-label="Notifications"
            className="relative p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
            {notificationCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white"></span>
            )}
          </button>

          <div className="flex items-center gap-2 pl-1">
            <img
              alt="Profile"
              className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-200 shadow-xs"
              src="https://lh3.googleusercontent.com/aida/AEtjO1X5khh8J8ywUw1U3WpGJrcZq-CwYCB-y-4ODpBMkp0cRIL4ESPhIXK_3HM93YU6jo06-vLKDFto7tfwOc6x1dblML1g6Ptq0pC84QfA2XNO-4-c1WBI_uMIroDAAr3LjodoOcyGyvGjKq85zaS_0BSYlWsHvt0dhxSY8A6AN4JRz1aW6Jp4OwcJpm_-n3lRQv9pveg7fNFjq67_afFxkJhv-LhWIgUo0Xz0kou7nDKTtkgDv1sE2pkJRUI"
            />
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Open Menu"
            className="lg:hidden p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-3 shadow-lg flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchCorridor(e.target.value)}
              placeholder="Corridor lookup (PIE, CTE)..."
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm"
            />
          </div>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-between ${
                activeTab === item.id
                  ? 'bg-sky-50 text-sky-700 font-bold border border-sky-200'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>{item.label}</span>
              {activeTab === item.id && (
                <span className="w-2 h-2 rounded-full bg-sky-600"></span>
              )}
            </button>
          ))}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>LTA DataMall Singapore Connected</span>
            <span className="text-emerald-600 font-semibold">● Real-time</span>
          </div>
        </div>
      )}
    </header>
  );
};
