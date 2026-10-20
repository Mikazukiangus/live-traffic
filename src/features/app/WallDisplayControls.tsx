import React from 'react';
import { exitWallDisplay } from '../../utils/wallDisplay';
interface Props {
  awake: boolean | null;
  keepAwake: boolean;
  setKeepAwake: React.Dispatch<React.SetStateAction<boolean>>;
}
export function WallDisplayControls({ awake, keepAwake, setKeepAwake }: Props) {
  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
      {awake !== null && (
        <button
          onClick={() => setKeepAwake((k) => !k)}
          aria-pressed={keepAwake}
          title={
            keepAwake
              ? awake
                ? 'Screen kept on (click to allow sleep)'
                : 'Keeping the screen on was refused by the browser'
              : 'Keep the screen on'
          }
          className={`h-9 px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer ${
            keepAwake && awake
              ? 'bg-sky-50/95 border-sky-200 text-sky-700'
              : 'bg-white/90 border-slate-200 text-slate-600'
          }`}
        >
          <span className="material-symbols-outlined text-base">{keepAwake ? 'light_mode' : 'bedtime'}</span>
          {keepAwake ? (awake ? 'Screen on' : 'Screen may sleep') : 'Keep screen on'}
        </button>
      )}
      <button
        onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
        aria-label="Full screen"
        title="Full screen"
        className="w-9 h-9 rounded-full bg-white/90 border border-slate-200 text-slate-600 hover:bg-white flex items-center justify-center shadow-sm cursor-pointer"
      >
        <span className="material-symbols-outlined text-lg">fullscreen</span>
      </button>
      <button
        onClick={exitWallDisplay}
        className="h-9 px-3 rounded-full bg-white/90 border border-slate-200 text-slate-700 hover:bg-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
      >
        <span className="material-symbols-outlined text-base">close_fullscreen</span>Exit wall display
      </button>
    </div>
  );
}
