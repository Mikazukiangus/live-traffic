import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useUrlParam, readParam, writeParams } from '../../utils/urlState';
import { useShortcuts } from '../../utils/appEvents';
import { useWallCycle } from '../../utils/wallDisplay';
import { kmBetween, useNearMe } from '../../utils/nearMe';
import type { CameraPlace } from '../../data/cameras';
import type { CameraCard, TabId } from './types';
export const PLACE_TABS: { id: CameraPlace | 'other'; label: string; icon: string }[] = [
  { id: 'woodlands', label: 'Woodlands', icon: 'directions_car' },
  { id: 'tuas', label: 'Tuas', icon: 'directions_car' },
  { id: 'sentosa', label: 'Sentosa', icon: 'beach_access' },
  { id: 'other', label: 'Other', icon: 'videocam' },
];

const TAB_STORAGE_KEY = 'trafficpulse.cameraTab';
const CAMERA_TABS: TabId[] = ['woodlands', 'tuas', 'sentosa', 'other', 'all', 'signs'];
const isCameraTab = (t: string | null): t is TabId => !!t && (CAMERA_TABS as string[]).includes(t);

const readSavedTab = (): TabId => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (isCameraTab(saved)) return saved;
  } catch {
    // Storage blocked; use the default tab
  }
  return 'woodlands';
};

export function useCameraNavigation(cameras: CameraCard[], wall: boolean) {
  const [camsParam, setCamsParam] = useUrlParam('cams');
  // Tab and enlarged camera are in the address (?tab=tuas&cam=4703) so they can be shared.
  const [tabParam, setTabParam] = useUrlParam('tab');
  const [savedTab] = useState<TabId>(readSavedTab);
  const activeTab: TabId = isCameraTab(tabParam) ? tabParam : savedTab;
  useEffect(() => {
    if (tabParam !== activeTab) setTabParam(activeTab, false);
  }, [tabParam, activeTab]);
  const [camParam] = useUrlParam('cam');
  // Whether this visit opened the camera (so closing can step Back instead of adding history).
  const openedHere = useRef(false);
  const nearMe = useNearMe();
  // A shared link's tab wins over Near me, unless Near me is tapped.
  const linkedTab = useRef(isCameraTab(readParam('tab')));
  const nearMeTapped = useRef(false);
  const selectTab = (tab: TabId, push = true) => {
    if (tab !== activeTab) setTabParam(tab, push);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage blocked; the tab just isn't remembered
    }
  };

  const camerasByPlace = useMemo(() => {
    const groups: Record<string, CameraCard[]> = {};
    for (const cam of cameras) (groups[cam.place] ||= []).push(cam);
    return groups;
  }, [cameras]);

  // The two checkpoints get their own tabs; Sentosa and any other camera are under All cameras.
  const placeTabs = PLACE_TABS.filter((t) => t.id === 'woodlands' || t.id === 'tuas');
  const shownTab: TabId = activeTab === 'sentosa' || activeTab === 'other' ? 'all' : activeTab;

  const selectedCam = camParam ? cameras.find((c) => c.id === `lta-live-${camParam}`) || null : null;
  const openCam = (cam: CameraCard) => {
    openedHere.current = true;
    writeParams(
      {
        tab: cam.place === 'woodlands' || cam.place === 'tuas' ? cam.place : 'all',
        cam: cam.id.replace('lta-live-', ''),
      },
      true,
    );
  };
  const closeCam = () => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      writeParams({ cam: null });
    }
  };
  // Previous / next camera in the open camera's place (keys and swipes)
  const stepCam = (by: number) => {
    if (!selectedCam) return;
    const list = camerasByPlace[selectedCam.place] || [];
    const i = list.findIndex((c) => c.id === selectedCam.id);
    const next = list[(i + by + list.length) % list.length];
    if (next && next.id !== selectedCam.id) writeParams({ cam: next.id.replace('lta-live-', '') });
  };
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart = (e: React.TouchEvent) =>
    (swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onSwipeEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepCam(dx < 0 ? 1 : -1);
  };

  // Keyboard: 1–4 switch tabs; with a camera open, ← → step through and Esc closes
  useShortcuts({
    '1': () => selectTab('woodlands'),
    '2': () => selectTab('tuas'),
    '3': () => selectTab('signs'),
    '4': () => selectTab('all'),
    ArrowLeft: () => stepCam(-1),
    ArrowRight: () => stepCam(1),
    ...(selectedCam ? { Escape: closeCam } : {}),
  });
  // Wall display shows each checkpoint in turn (the all-cameras grid stays put)
  const WALL_TABS: TabId[] = ['woodlands', 'tuas'];
  useWallCycle(wall && shownTab !== 'all', () =>
    selectTab(WALL_TABS[(WALL_TABS.indexOf(shownTab) + 1) % WALL_TABS.length], false),
  );

  // Near me: the closest camera, and its tab opened (unless a shared link chose the tab)
  const nearestCam = useMemo(() => {
    if (nearMe.status !== 'found' || nearMe.lat == null || nearMe.lon == null) return null;
    let best: { cam: CameraCard; km: number } | null = null;
    for (const cam of cameras) {
      if (cam.place === 'other' || cam.lat == null || cam.lon == null) continue;
      const km = kmBetween(nearMe.lat, nearMe.lon, cam.lat, cam.lon);
      if (!best || km < best.km) best = { cam, km };
    }
    return best;
  }, [nearMe, cameras]);
  useEffect(() => {
    if (!nearestCam || (linkedTab.current && !nearMeTapped.current)) return;
    nearMeTapped.current = false;
    linkedTab.current = false;
    selectTab(nearestCam.cam.place, false);
  }, [nearestCam?.cam.place, nearMe.at]);

  // All cameras grid
  const gridIds = camsParam ? camsParam.split(',').filter(Boolean) : cameras.map((c) => c.id.replace('lta-live-', ''));
  const gridCams = cameras.filter((c) => gridIds.includes(c.id.replace('lta-live-', '')));
  const toggleGridCam = (id: string) => {
    const next = gridIds.includes(id) ? gridIds.filter((x) => x !== id) : [...gridIds, id];
    const all = cameras.map((c) => c.id.replace('lta-live-', ''));
    setCamsParam(
      next.length === all.length && all.every((x) => next.includes(x)) ? null : next.join(',') || 'none',
      false,
    );
  };

  return {
    activeTab,
    camParam,
    selectedCam,
    openCam,
    closeCam,
    stepCam,
    onSwipeStart,
    onSwipeEnd,
    shownTab,
    placeTabs,
    selectTab,
    camerasByPlace,
    nearMe,
    nearestCam,
    nearMeTapped,
    gridIds,
    gridCams,
    toggleGridCam,
  };
}
