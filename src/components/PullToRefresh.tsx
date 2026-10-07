import React, { useEffect, useRef, useState } from 'react';
import { requestRefresh } from '../utils/appEvents';

// The indicator moves half as far as the finger; past 50 px (a 100 px pull) it refreshes.
const TRIGGER_PX = 50;
const MAX_PX = 110;

/** Pull down from the top of the page (touch screens) to reload the page's live data. */
export const PullToRefresh: React.FC = () => {
  const [pull, setPull] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      // Not inside dialogs, maps or anything scrolled, and only from the very top of the page.
      const target = e.target as HTMLElement;
      if (window.scrollY > 0 || target.closest('[role="dialog"], .fixed, svg')) return;
      start.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      pullRef.current = dy > 0 ? Math.min(MAX_PX, dy * 0.5) : 0;
      setPull(pullRef.current);
    };
    const onEnd = () => {
      if (start.current == null) return;
      start.current = null;
      if (pullRef.current >= TRIGGER_PX) {
        setSpinning(true);
        requestRefresh();
        setTimeout(() => setSpinning(false), 1200);
      }
      pullRef.current = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (!pull && !spinning) return null;
  const ready = pull >= TRIGGER_PX;
  return (
    <div
      aria-hidden
      className="fixed left-1/2 z-40 -translate-x-1/2 w-10 h-10 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-sky-600 pointer-events-none"
      style={{ top: 64 + (spinning ? 24 : pull * 0.6) }}
    >
      <span
        className={`material-symbols-outlined ${spinning ? 'animate-spin' : ''}`}
        style={spinning ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: ready ? 1 : 0.5 }}
      >
        refresh
      </span>
    </div>
  );
};
