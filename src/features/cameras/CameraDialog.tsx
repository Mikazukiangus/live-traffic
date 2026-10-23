import React, { useEffect, useRef } from 'react';
import { CameraCard } from './types';
import { CameraImage } from './CameraImage';
import { captureAge, formatSgt, getResolvedCameraUrl } from './images';
import { cameraLevel, cameraAir, cameraRain, COUNT_NOTE } from './cameraReadings';
import { JAM_STYLE } from '../../utils/expresswaySpeeds';
import { currentVehicleCount, type VehicleCount } from '../../utils/vehicleDetection';
import { ShareButton } from '../../components/ShareButton';

interface Props {
  selectedCam: CameraCard;
  camerasByPlace: Record<string, CameraCard[]>;
  closeCam: () => void;
  stepCam: (by: number) => void;
  onSwipeStart: React.TouchEventHandler;
  onSwipeEnd: React.TouchEventHandler;
  now: number;
  vehicleCounts: Record<string, VehicleCount>;
  cameraLevel: (cam: CameraCard) => ReturnType<typeof cameraLevel>;
  airNotice: string | null;
  cameraAir: (cam: CameraCard) => ReturnType<typeof cameraAir>;
  cameraRain: (cam: CameraCard) => ReturnType<typeof cameraRain>;
  speedText: (code: string) => string | null;
  onCallHotline: (phone: string, title: string) => void;
}
export function CameraDialog({
  selectedCam,
  camerasByPlace,
  closeCam,
  stepCam,
  onSwipeStart,
  onSwipeEnd,
  now,
  vehicleCounts,
  cameraLevel,
  cameraAir,
  airNotice,
  cameraRain,
  speedText,
  onCallHotline,
}: Props) {
  const cameraDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = cameraDialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={cameraDialog}
      aria-label={selectedCam.short}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeCam();
      }}
      onCancel={(event) => {
        event.preventDefault();
        closeCam();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          stepCam(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-4xl max-h-[calc(100dvh_-_2rem)] overflow-y-auto bg-white rounded-2xl border border-slate-200 p-0 text-slate-900 shadow-2xl backdrop:bg-scrim/80"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
        className="w-full p-4 sm:p-5 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">{selectedCam.short}</h3>
            <p className="text-xs text-slate-500">{selectedCam.name}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ShareButton
              title={`${selectedCam.short} camera`}
              className="!h-11 !w-11 !shadow-none !border-transparent"
            />
            <button
              onClick={closeCam}
              aria-label="Close"
              className="w-11 h-11 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="fixed-palette relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900">
          {(camerasByPlace[selectedCam.place]?.length || 0) > 1 && (
            <>
              <button
                onClick={() => stepCam(-1)}
                aria-label="Previous camera"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-scrim/60 text-white flex items-center justify-center cursor-pointer hover:bg-scrim/80"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                onClick={() => stepCam(1)}
                aria-label="Next camera"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-scrim/60 text-white flex items-center justify-center cursor-pointer hover:bg-scrim/80"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </>
          )}
          <CameraImage
            imageUrl={selectedCam.imageUrl}
            alt={selectedCam.short}
            className="w-full h-full object-contain"
          />
        </div>

        {airNotice && <p role="status" className="text-xs text-amber-800">{airNotice}</p>}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base text-slate-400">schedule</span>
            {formatSgt(selectedCam.capturedAt)} SGT ({captureAge(selectedCam.capturedAt, now)})
          </span>
          {currentVehicleCount(vehicleCounts, selectedCam.id, getResolvedCameraUrl(selectedCam.imageUrl)) && (
            <span className="flex items-center gap-1.5" title={COUNT_NOTE}>
              <span className="material-symbols-outlined text-base text-slate-400">directions_car</span>~
              {currentVehicleCount(vehicleCounts, selectedCam.id, getResolvedCameraUrl(selectedCam.imageUrl))?.count}{' '}
              vehicles in view
            </span>
          )}
          {cameraLevel(selectedCam) ? (
            <span className="flex items-center gap-1.5" title={cameraLevel(selectedCam)!.source}>
              <span className={`w-2 h-2 rounded-full ${JAM_STYLE[cameraLevel(selectedCam)!.level].dot}`}></span>
              {cameraLevel(selectedCam)!.level} here • {cameraLevel(selectedCam)!.detail}
            </span>
          ) : (
            speedText(selectedCam.corridor) && (
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-sky-600">speed</span>
                {speedText(selectedCam.corridor)}
              </span>
            )
          )}
          {(() => {
            const rain = cameraRain(selectedCam);
            return (
              rain && (
                <span className={`flex items-center gap-1.5 ${rain.style.className}`}>
                  <span className="material-symbols-outlined text-base">{rain.style.icon}</span>
                  Next 2h: {rain.area.forecast}
                </span>
              )
            );
          })()}
          {(() => {
            const air = cameraAir(selectedCam);
            return (
              air && (
                <span className={`flex items-center gap-1.5 cursor-help ${air.band.text}`} title={air.detail}>
                  <span className={`w-2 h-2 rounded-full ${air.band.dot}`}></span>
                  PSI {air.psi} {air.band.label}
                </span>
              )
            );
          })()}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-400">{selectedCam.location}</span>
          <button
            onClick={() => {
              closeCam();
              onCallHotline('18002255582', `EMAS Emergency on ${selectedCam.name}`);
            }}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-bold cursor-pointer shrink-0"
          >
            Report incident
          </button>
        </div>
      </div>
    </dialog>
  );
}
