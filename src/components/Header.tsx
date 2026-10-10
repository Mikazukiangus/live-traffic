import React, { useState } from 'react';
import { RoadSearch } from './RoadSearch';
import { RoadSearchResult } from '../utils/roadSearch';
import { TabType } from '../types/traffic';
import { useInstallPrompt } from '../utils/installPrompt';
import { THEME_LABEL, THEME_ORDER, setTheme, useTheme } from '../utils/theme';
import { setLargeText, useLargeText } from '../utils/textSize';

interface HeaderProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onGoHome: () => void;
  onSearchSelect: (result: RoadSearchResult) => void;
  onOpenNotifications: () => void;
  notificationCount: number;
  // Incidents on the visitor's saved commutes
  commuteIncidentCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onGoHome,
  onSearchSelect,
  onOpenNotifications,
  notificationCount,
  commuteIncidentCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const installer = useInstallPrompt();
  const theme = useTheme();
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const largeText = useLargeText();

  // Short labels until the screen is wide enough for the full ones
  const navItems: { id: TabType; label: string; short: string }[] = [
    { id: 'live-traffic-radar', label: 'Live Traffic', short: 'Traffic' },
    { id: 'highway-cameras-emas', label: 'Cameras & Road Signs', short: 'Cameras' },
    { id: 'roadside-sos-workshops', label: 'Breakdown Help', short: 'Help' },
    { id: 'route-alerts-courier-hub', label: 'Drivers & Car Parks', short: 'Drivers' },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
      <div className="h-16 w-full px-3 sm:px-6 flex items-center justify-between gap-2 max-w-7xl mx-auto">
        {/* Left: Brand logo & live badge */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onGoHome}
            aria-label="TrafficPulse home"
            className="min-h-11 min-w-11 flex items-center gap-2 text-left group"
          >
            <img
              alt="TrafficPulse"
              className="h-8 w-8 rounded-lg object-contain transition-transform group-hover:scale-105"
              src="/icons/icon.svg"
            />
            <span className="text-lg font-bold tracking-tight text-sky-600 hidden sm:inline font-sans">
              TrafficPulse
            </span>
          </button>


        </div>

        <RoadSearch onSelect={(result) => { setMobileMenuOpen(false); onSearchSelect(result); }} />

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
                <span className="xl:hidden">{item.short}</span>
                <span className="hidden xl:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: Notification & Profile */}
        <div className="flex items-center gap-2 shrink-0">
          {installer.mode === 'prompt' && (
            <button
              onClick={installer.install}
              title="Install TrafficPulse as an app"
              className="h-9 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-lg">install_mobile</span>
              <span className="hidden sm:inline">Install app</span>
            </button>
          )}
          <button
            onClick={() => setLargeText(!largeText)}
            aria-pressed={largeText}
            aria-label={largeText ? 'Normal text size' : 'Larger text'}
            title={largeText ? 'Normal text size' : 'Larger text and buttons'}
            className={`hidden sm:block w-11 h-11 rounded-lg transition-colors ${
              largeText ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-xl">format_size</span>
          </button>
          <button
            onClick={() => setTheme(nextTheme)}
            aria-label={`${THEME_LABEL[theme].label}. Switch to ${nextTheme === 'auto' ? 'device setting' : nextTheme}`}
            title={`${THEME_LABEL[theme].label} (click for ${nextTheme === 'auto' ? 'device setting' : nextTheme})`}
            className="w-11 h-11 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">{THEME_LABEL[theme].icon}</span>
          </button>
          <button
            onClick={onOpenNotifications}
            aria-label={`Alerts: ${notificationCount} LTA incidents${commuteIncidentCount ? `, ${commuteIncidentCount} on your commutes` : ''}`}
            title={commuteIncidentCount ? `${commuteIncidentCount} incident${commuteIncidentCount === 1 ? '' : 's'} on your commutes` : 'Live incidents and commute alerts'}
            className="relative w-11 h-11 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
            {commuteIncidentCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center ring-2 ring-white">
                {commuteIncidentCount}
              </span>
            ) : (
              notificationCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white"></span>
            )}
          </button>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Open Menu"
            className="lg:hidden w-11 h-11 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
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
          <button
            onClick={() => setLargeText(!largeText)}
            aria-pressed={largeText}
            className="sm:hidden text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">format_size</span>Larger text
            </span>
            <span className={`text-xs font-bold ${largeText ? 'text-sky-700' : 'text-slate-400'}`}>{largeText ? 'On' : 'Off'}</span>
          </button>
          {installer.mode === 'ios' && (
            <div className="px-3 py-2.5 rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-900 flex items-start gap-2">
              <span className="material-symbols-outlined text-base text-sky-600">ios_share</span>
              <span>
                <span className="font-semibold">Install on iPhone:</span> tap Share in Safari, then Add to Home Screen.
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>LTA DataMall Singapore Connected</span>
            <span className="text-emerald-600 font-semibold">● Real-time</span>
          </div>
        </div>
      )}
    </header>
  );
};
