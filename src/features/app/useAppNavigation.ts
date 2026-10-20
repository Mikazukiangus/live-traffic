/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { TabType } from '../../types/traffic';
import { RoadSearchResult, searchDestination } from '../../utils/roadSearch';
import { useUrlParam, writeParams } from '../../utils/urlState';
import { requestRefresh, useShortcuts } from '../../utils/appEvents';
import { locate } from '../../utils/nearMe';
import { enterWallDisplay, exitWallDisplay, useWakeLock, useWallDisplay } from '../../utils/wallDisplay';

// Scroll to a section once its page has loaded (a page may still be downloading on first use).
const scrollToWhenShown = (id: string, behavior: ScrollBehavior) => {
  const started = Date.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior, block: 'start' });
    else if (Date.now() - started < 5000) setTimeout(tick, 100);
  };
  setTimeout(tick, 150);
};

// Short page names for the address bar, e.g. ?page=radar
const PAGE_SLUGS: Record<TabType, string> = {
  'live-traffic-radar': 'radar',
  'highway-cameras-emas': 'cameras',
  'roadside-sos-workshops': 'sos',
  'route-alerts-courier-hub': 'courier',
};
const DEFAULT_PAGE: TabType = 'highway-cameras-emas';
const pageFromSlug = (slug: string | null): TabType =>
  (Object.keys(PAGE_SLUGS) as TabType[]).find((t) => PAGE_SLUGS[t] === slug) || DEFAULT_PAGE;

export function useAppNavigation() {
  const [pageSlug] = useUrlParam('page');
  const activeTab = pageFromSlug(pageSlug);
  // A new page starts on its own default tab, and Back returns to the previous page.
  const setActiveTab = (tab: TabType) => {
    if (tab !== activeTab) writeParams({ page: PAGE_SLUGS[tab], tab: null, cam: null, incident: null }, true);
    window.scrollTo({ top: 0 });
  };
  // Wall display: no menus, tabs cycle (?display=wall)
  const wall = useWallDisplay();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcuts({
    t: () => setActiveTab('live-traffic-radar'),
    c: () => setActiveTab('highway-cameras-emas'),
    h: () => setActiveTab('roadside-sos-workshops'),
    s: () => setActiveTab('roadside-sos-workshops'),
    d: () => setActiveTab('route-alerts-courier-hub'),
    r: requestRefresh,
    n: locate,
    w: () => (wall ? exitWallDisplay() : enterWallDisplay()),
    '?': () => setShortcutsOpen((o) => !o),
    Escape: () => {
      if (shortcutsOpen) setShortcutsOpen(false);
      else if (wall && !document.querySelector('[role="dialog"]')) exitWallDisplay();
    },
  });

  // The wall display keeps the screen on unless switched off
  const [keepAwake, setKeepAwake] = useState(true);
  const awake = useWakeLock(wall && keepAwake);

  // Home-screen shortcuts: ?near=1 finds the visitor straight away; #commute scrolls to My commute.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('near') === '1') {
      writeParams({ near: null });
      locate();
    }
    if (window.location.hash === '#commute') {
      scrollToWhenShown('commute', 'auto');
    }
  }, []);
  const goToCommutes = () => {
    writeParams({ page: PAGE_SLUGS['live-traffic-radar'], tab: 'expressways', cam: null }, true);
    scrollToWhenShown('commute', 'smooth');
  };

  // Show the page in the address from the first load, so it can be copied straight away.
  useEffect(() => {
    if (pageSlug !== PAGE_SLUGS[activeTab]) writeParams({ page: PAGE_SLUGS[activeTab] });
  }, [pageSlug, activeTab]);
  const handleSearchSelect = (result: RoadSearchResult) => {
    writeParams(searchDestination(result), true);
    window.scrollTo({ top: 0 });
    // Selecting the same road again doesn't change the URL, but should still reveal it.
    if (result.kind === 'road')
      requestAnimationFrame(() => {
        const card = document.getElementById(`road-${result.code}`);
        card?.scrollIntoView({ block: 'center' });
        card?.focus({ preventScroll: true });
      });
  };

  return {
    activeTab,
    setActiveTab,
    wall,
    shortcutsOpen,
    setShortcutsOpen,
    keepAwake,
    setKeepAwake,
    awake,
    goToCommutes,
    handleSearchSelect,
  };
}
