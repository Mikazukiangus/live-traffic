import React from 'react';
import { Sample } from '../../utils/commuteHistory';

/** Travel time over the last few hours, as a small line. */
export const Sparkline: React.FC<{ samples: Sample[] }> = ({ samples }) => {
  const W = 72,
    H = 20;
  const t0 = samples[0][0],
    t1 = samples[samples.length - 1][0] || t0 + 1;
  const vals = samples.map(([, m]) => m);
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (m: number) => (hi === lo ? H / 2 : H - 2 - ((m - lo) / (hi - lo)) * (H - 4));
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 text-sky-600"
      role="img"
      aria-label={`Travel time from ${lo} to ${hi} minutes`}
    >
      <polyline
        points={samples.map(([t, m]) => `${x(t).toFixed(1)},${y(m).toFixed(1)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
};
