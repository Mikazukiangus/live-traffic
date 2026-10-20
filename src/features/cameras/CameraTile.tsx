import { CameraCard } from './types';
import { CameraImage } from './CameraImage';
import { captureAge } from './images';
import { cameraLevel, COUNT_NOTE } from './cameraReadings';
import { JAM_STYLE } from '../../utils/expresswaySpeeds';
import { type VehicleCount } from '../../utils/vehicleDetection';
import { config } from '../../../config/client';
interface Props {
  cam: CameraCard;
  now: number;
  reading: ReturnType<typeof cameraLevel>;
  counted?: VehicleCount;
  openCam: (cam: CameraCard) => void;
  compact?: boolean;
}
export function CameraTile({ cam, now, reading, counted, openCam, compact = false }: Props) {
  const isStale = now - new Date(cam.capturedAt).getTime() > config.freshness.cameras;
  return compact ? (
    <button
      key={cam.id}
      onClick={() => openCam(cam)}
      className="fixed-palette relative aspect-video rounded-xl overflow-hidden bg-slate-900 cursor-pointer text-left"
    >
      <CameraImage imageUrl={cam.imageUrl} alt={cam.short} className="w-full h-full object-cover" />
      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-xs font-semibold">
        {cam.short}
      </span>
      <span
        className={`absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 text-xs ${isStale ? 'text-amber-300' : 'text-white'}`}
      >
        {isStale ? 'Delayed • ' : ''}
        {captureAge(cam.capturedAt, now)}
      </span>
      {reading && (
        <span
          className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-white/95 text-xs font-semibold flex items-center gap-1.5"
          title={reading.source}
        >
          <span className={`w-2 h-2 rounded-full ${JAM_STYLE[reading.level].dot}`}></span>
          <span className={JAM_STYLE[reading.level].text}>{reading.level}</span>
        </span>
      )}
    </button>
  ) : (
    <button
      key={cam.id}
      onClick={() => openCam(cam)}
      className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow cursor-pointer group"
    >
      <div className="fixed-palette aspect-video relative bg-slate-900 overflow-hidden">
        <CameraImage
          imageUrl={cam.imageUrl}
          alt={cam.short}
          loading="eager"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <span
          className={`absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/70 text-xs font-medium flex items-center gap-1.5 ${
            isStale ? 'text-amber-300' : 'text-white'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isStale ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`}></span>
          {isStale ? `Delayed • ${captureAge(cam.capturedAt, now)}` : captureAge(cam.capturedAt, now)}
        </span>
        {reading && (
          <span
            className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-white/95 text-xs font-semibold flex items-center gap-1.5 shadow-sm"
            title={reading.source}
          >
            <span className={`w-2 h-2 rounded-full ${JAM_STYLE[reading.level].dot}`}></span>
            <span className={JAM_STYLE[reading.level].text}>{reading.level}</span>
            <span className="text-slate-500 font-normal">{reading.detail}</span>
          </span>
        )}
      </div>
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-900 group-hover:text-sky-600 transition-colors">
          {cam.short}
        </span>
        {counted && (
          <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0" title={COUNT_NOTE}>
            <span className="material-symbols-outlined text-sm">directions_car</span>~{counted.count}
          </span>
        )}
      </div>
    </button>
  );
}
