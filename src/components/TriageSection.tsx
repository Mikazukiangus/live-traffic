import React from 'react';
import { TRIAGE_SITUATIONS } from '../data/mockData';
import { TriageSituation } from '../types/traffic';

interface TriageSectionProps {
  onSelectSituation: (situation: TriageSituation) => void;
}

export const TriageSection: React.FC<TriageSectionProps> = ({ onSelectSituation }) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] uppercase tracking-widest text-sky-600 font-bold">
            Step 1 • Instant Incident Triage
          </span>
          <h2 className="text-lg sm:text-xl text-slate-900 font-bold tracking-tight">
            Select Vehicle Distress Situation
          </h2>
        </div>
        <span className="hidden sm:inline-block text-xs text-slate-500 font-medium">
          Immediate single-tap dispatch routing
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TRIAGE_SITUATIONS.map((sit) => {
          // Color specific stylings for icon container & borders
          const getIconTheme = () => {
            switch (sit.id) {
              case 'engine-stall':
                return {
                  bg: 'bg-amber-50',
                  border: 'border-amber-200',
                  text: 'text-amber-700',
                  hoverBorder: 'hover:border-amber-300',
                };
              case 'flat-tire':
                return {
                  bg: 'bg-emerald-50',
                  border: 'border-emerald-200',
                  text: 'text-emerald-700',
                  hoverBorder: 'hover:border-emerald-300',
                };
              case 'expressway-collision':
                return {
                  bg: 'bg-red-50',
                  border: 'border-red-200',
                  text: 'text-red-600',
                  hoverBorder: 'hover:border-red-300',
                };
              case 'dead-battery':
              default:
                return {
                  bg: 'bg-sky-50',
                  border: 'border-sky-200',
                  text: 'text-sky-600',
                  hoverBorder: 'hover:border-sky-300',
                };
            }
          };

          const theme = getIconTheme();

          return (
            <div
              key={sit.id}
              className={`group relative rounded-xl bg-white border border-slate-200 ${theme.hoverBorder} p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all duration-150`}
            >
              {/* Header: Icon + Badge */}
              <div className="flex items-start justify-between">
                <div
                  className={`w-12 h-12 rounded-lg ${theme.bg} ${theme.border} border flex items-center justify-center ${theme.text}`}
                >
                  <span className="material-symbols-outlined text-2xl">{sit.icon}</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                  {sit.badge}
                </span>
              </div>

              {/* Title & Description */}
              <div className="my-3 sm:my-4">
                <h3 className="text-sm sm:text-base text-slate-900 font-bold group-hover:text-sky-600 transition-colors">
                  {sit.title}
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {sit.description}
                </p>
              </div>

              {/* Pricing & Dispatch Action */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className={`text-xs font-bold ${theme.text}`}>{sit.priceTag}</span>
                <button
                  type="button"
                  onClick={() => onSelectSituation(sit)}
                  className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-sky-600 hover:text-white text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  <span>{sit.buttonLabel}</span>
                  <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
