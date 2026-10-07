import React from 'react';
import { TabType } from '../types/traffic';

const ITEMS: { id: TabType; label: string; icon: string }[] = [
  { id: 'live-traffic-radar', label: 'Traffic', icon: 'speed' },
  { id: 'highway-cameras-emas', label: 'Cameras', icon: 'videocam' },
  { id: 'roadside-sos-workshops', label: 'SOS', icon: 'sos' },
  { id: 'route-alerts-courier-hub', label: 'Courier', icon: 'local_shipping' },
];

/** Thumb-reach page tabs on phones and tablets (the header's tabs show from lg up). */
export const BottomNav: React.FC<{ activeTab: TabType; onSelectTab: (t: TabType) => void; incidentCount: number }> = ({
  activeTab,
  onSelectTab,
  incidentCount,
}) => (
  <nav
    aria-label="Pages"
    className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
  >
    <div className="grid grid-cols-4 h-16">
      {ITEMS.map((item) => {
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer ${
              active ? 'text-sky-700' : 'text-slate-500'
            }`}
          >
            <span
              className={`material-symbols-outlined text-2xl px-4 rounded-full transition-colors ${active ? 'bg-sky-100' : ''}`}
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            {item.label}
            {item.id === 'live-traffic-radar' && incidentCount > 0 && (
              <span className="absolute top-2 left-1/2 ml-3 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">
                {incidentCount > 99 ? '99+' : incidentCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </nav>
);
