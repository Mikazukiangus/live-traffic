import { useState, useEffect } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { useUrlParam } from '../../utils/urlState';
import { useShortcuts } from '../../utils/appEvents';
import { useWallCycle } from '../../utils/wallDisplay';
type RadarTab = 'expressways' | 'incidents' | 'weather' | 'erp';
const RADAR_TABS: RadarTab[] = ['expressways', 'incidents', 'weather', 'erp'];
const isRadarTab = (t: string | null): t is RadarTab => RADAR_TABS.includes(t as RadarTab);

const TAB_STORAGE_KEY = 'trafficpulse.radarTab';
const readSavedTab = (): RadarTab => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (isRadarTab(saved)) return saved;
  } catch {
    // Storage blocked; use the default tab
  }
  return 'expressways';
};

export function useRadarNavigation(wall: boolean) {
  const corridors = EXPRESSWAY_CORRIDORS;
  const [roadParam, setRoadParam] = useUrlParam('road');
  const selectedCorridorCode = corridors.some((c) => c.code === roadParam) ? roadParam! : 'KPE';
  const setSelectedCorridorCode = (code: string) => setRoadParam(code, false);
  const [incidentParam] = useUrlParam('incident');
  // The tab is in the address (?tab=weather) so it can be shared; otherwise the last one used.
  const [tabParam, setTabParam] = useUrlParam('tab');
  const [savedTab] = useState<RadarTab>(readSavedTab);
  const activeTab: RadarTab = isRadarTab(tabParam) ? tabParam : savedTab;
  useEffect(() => {
    if (tabParam !== activeTab) setTabParam(activeTab, false);
  }, [tabParam, activeTab]);

  const selectTab = (tab: RadarTab) => {
    if (tab !== activeTab) setTabParam(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage blocked; the tab just isn't remembered
    }
  };

  // Keyboard: 1–4 switch tabs, ← → step through the expressways
  const stepCorridor = (by: number) => {
    const i = corridors.findIndex((c) => c.code === selectedCorridorCode);
    setSelectedCorridorCode(corridors[(i + by + corridors.length) % corridors.length].code);
    if (activeTab !== 'expressways') selectTab('expressways');
  };
  useShortcuts({
    '1': () => selectTab('expressways'),
    '2': () => selectTab('incidents'),
    '3': () => selectTab('weather'),
    '4': () => selectTab('erp'),
    ArrowLeft: () => stepCorridor(-1),
    ArrowRight: () => stepCorridor(1),
  });

  // Wall display moves to the next tab every 30 seconds, without adding to Back history
  useWallCycle(wall, () => setTabParam(RADAR_TABS[(RADAR_TABS.indexOf(activeTab) + 1) % RADAR_TABS.length], false));

  const showOnMap = (code: string) => {
    setSelectedCorridorCode(code);
    selectTab('expressways');
    setTimeout(() => document.getElementById('speed-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  return { corridors, selectedCorridorCode, setSelectedCorridorCode, incidentParam, activeTab, selectTab, showOnMap };
}
