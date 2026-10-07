import React from 'react';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Pages',
    keys: [
      ['T', 'Live Traffic'],
      ['C', 'Highway Cameras'],
      ['S', 'Roadside SOS'],
      ['H', 'Courier Hub'],
    ],
  },
  {
    title: 'On a page',
    keys: [
      ['1 – 4', 'Switch tab'],
      ['R', 'Refresh live data'],
      ['N', 'Near me'],
      ['← →', 'Previous / next expressway or camera'],
      ['Esc', 'Close the open camera or dialog'],
    ],
  },
  {
    title: 'Display',
    keys: [
      ['W', 'Wall display on / off'],
      ['?', 'Show these shortcuts'],
    ],
  },
];

export const ShortcutsHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div onClick={onClose} className="fixed inset-0 z-[60] bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts" className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Keyboard shortcuts</h2>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-sky-600">{g.title}</h3>
          {g.keys.map(([k, what]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{what}</span>
              <kbd className="px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 font-mono text-xs text-slate-800">{k}</kbd>
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);
