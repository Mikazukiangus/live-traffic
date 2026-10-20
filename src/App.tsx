import { useAppNavigation } from './features/app/useAppNavigation';
import { WallDisplayControls } from './features/app/WallDisplayControls';
import { useDemoDispatch } from './features/sos/useDemoDispatch';
import { usePickupReadings } from './features/sos/usePickupReadings';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Workshop, TriageSituation } from './types/traffic';
import { INITIAL_GNSS, WORKSHOPS_DATA, ALTERNATE_MARKERS } from './data/demoData';
import { useLtaIncidents } from './utils/ltaIncidents';

import { Header } from './components/Header';
import { TelemetryBar } from './components/TelemetryBar';
import { Footer } from './components/Footer';
import { BookingModal } from './components/BookingModal';
import { CallModal } from './components/CallModal';
import { SlaModal } from './components/SlaModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ApiHealthModal } from './components/ApiHealthModal';
import { writeParams } from './utils/urlState';
import { commuteCodes, useCommuteAlerts, useCommutes } from './utils/commutes';

import { BottomNav } from './components/BottomNav';
import { PullToRefresh } from './components/PullToRefresh';
import { ShortcutsHelp } from './components/ShortcutsHelp';

// Each page is its own chunk, so the first visit only downloads the page it opens on
// (the Live Traffic map and its base map stay out of the Cameras page, for example).
const loadSos = () => import('./views/SosWorkshopsView');
const loadRadar = () => import('./views/LiveRadarView');
const loadCameras = () => import('./views/HighwayCamerasView');
const loadCourier = () => import('./views/CourierHubView');
const SosWorkshopsView = lazy(() => loadSos().then((m) => ({ default: m.SosWorkshopsView })));
const LiveRadarView = lazy(() => loadRadar().then((m) => ({ default: m.LiveRadarView })));
const HighwayCamerasView = lazy(() => loadCameras().then((m) => ({ default: m.HighwayCamerasView })));
const CourierHubView = lazy(() => loadCourier().then((m) => ({ default: m.CourierHubView })));

// Once the first page is up, fetch the other pages in the background: switching pages stays
// instant, and the service worker caches them so every page also works offline.
const preloadPages = () => {
  const run = () => [loadSos, loadRadar, loadCameras, loadCourier].forEach((load) => load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
};

const PageLoading: React.FC = () => (
  <div className="flex-1 flex items-center justify-center py-24 text-slate-500 text-sm" role="status">
    <span className="material-symbols-outlined animate-spin mr-2 text-base">progress_activity</span>Loading…
  </div>
);

export default function App() {
  const navigation = useAppNavigation();
  const {
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
  } = navigation;
  useEffect(preloadPages, []);
  const [currentMarker, setCurrentMarker] = useState(INITIAL_GNSS);
  const { isBroadcasting, activeDispatch, handleToggleBroadcast, handleConfirmDispatch, cancelDispatch } =
    useDemoDispatch(currentMarker.marker);
  // Live LTA incidents, shared by the radar panel and the notifications drawer
  const incidentFeed = useLtaIncidents();
  // Notifications for new incidents on saved commutes, on every page
  useCommuteAlerts(incidentFeed.incidents, incidentFeed.status);
  const commutes = useCommutes();
  const commuteIncidentCount = incidentFeed.incidents.filter(
    (i) => i.corridorCode && commutes.some((c) => commuteCodes(c).includes(i.corridorCode!)),
  ).length;

  const { pickupCode, pickupSpeedText, pickupIncidentsText, pickupRainText } = usePickupReadings(
    currentMarker,
    incidentFeed,
  );

  // Modals state
  const [bookingModal, setBookingModal] = useState<{
    isOpen: boolean;
    workshopName: string;
    pricingText: string;
  }>({
    isOpen: false,
    workshopName: 'Kaki Bukit Autowerks Hub',
    pricingText: 'S$65 Flat Tow Included',
  });

  const [callModal, setCallModal] = useState<{
    isOpen: boolean;
    phone: string;
    recipientName: string;
  }>({
    isOpen: false,
    phone: '',
    recipientName: '',
  });

  const [slaModalOpen, setSlaModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [apiHealthModalOpen, setApiHealthModalOpen] = useState(false);

  // Handlers
  const handleOpenCallModal = (phone: string, recipientName: string) => {
    setCallModal({
      isOpen: true,
      phone,
      recipientName,
    });
  };

  const handleSelectSituation = (situation: TriageSituation) => {
    setBookingModal({
      isOpen: true,
      workshopName: `Nearest Priority Responder for ${situation.title}`,
      pricingText: `${situation.priceTag} • LTA Corridor Direct`,
    });
  };

  const handleBookBay = (workshop: Workshop) => {
    setBookingModal({
      isOpen: true,
      workshopName: workshop.name,
      pricingText: `S$${workshop.basePrice} ${workshop.priceNote}`,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Fixed Header */}
      {!wall && (
        <Header
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onGoHome={() => {
            writeParams({ page: 'cameras', tab: 'woodlands', cam: null, cams: null, road: null, incident: null }, true);
            window.scrollTo({ top: 0 });
          }}
          onSearchSelect={handleSearchSelect}
          onOpenNotifications={() => setNotificationsOpen(true)}
          notificationCount={incidentFeed.incidents.length}
          commuteIncidentCount={commuteIncidentCount}
        />
      )}
      {!wall && <PullToRefresh />}
      {wall && <WallDisplayControls awake={awake} keepAwake={keepAwake} setKeepAwake={setKeepAwake} />}

      {/* Main Container with 64px top padding for fixed navbar */}
      <main className={`w-full flex-1 flex flex-col ${wall ? 'pt-2' : 'pt-16'}`}>
        {/* Pickup location bar, only on the pages that use the pickup */}
        {!wall && (activeTab === 'roadside-sos-workshops' || activeTab === 'route-alerts-courier-hub') && (
          <TelemetryBar
            currentMarker={currentMarker}
            onSelectMarker={setCurrentMarker}
            incidentFeed={incidentFeed}
            pickupSpeedText={pickupSpeedText}
          />
        )}

        {/* Tab Views */}
        <Suspense fallback={<PageLoading />}>
          {activeTab === 'roadside-sos-workshops' && (
            <SosWorkshopsView
              currentMarker={currentMarker.marker}
              workshops={WORKSHOPS_DATA}
              isBroadcasting={isBroadcasting}
              onToggleBroadcast={handleToggleBroadcast}
              activeDispatch={activeDispatch}
              onCancelDispatch={cancelDispatch}
              onCallHotline={handleOpenCallModal}
              onSelectSituation={handleSelectSituation}
              onBookBay={handleBookBay}
              onOpenSlaModal={() => setSlaModalOpen(true)}
              corridorCode={pickupCode}
              trafficSpeed={pickupSpeedText}
              incidentsText={pickupIncidentsText}
              rainText={pickupRainText}
            />
          )}

          {activeTab === 'live-traffic-radar' && (
            <LiveRadarView
              onSwitchToSos={(corridorCode) => {
                const marker = ALTERNATE_MARKERS.find((m) => m.corridor === corridorCode);
                if (marker) setCurrentMarker(marker);
                setActiveTab('roadside-sos-workshops');
              }}
              onCallHotline={handleOpenCallModal}
              incidentFeed={incidentFeed}
              wall={wall}
            />
          )}

          {activeTab === 'highway-cameras-emas' && (
            <HighwayCamerasView onCallHotline={handleOpenCallModal} wall={wall} />
          )}

          {activeTab === 'route-alerts-courier-hub' && (
            <CourierHubView
              pickup={currentMarker}
              onOpenSlaModal={() => setSlaModalOpen(true)}
              onCallHotline={handleOpenCallModal}
            />
          )}
        </Suspense>
      </main>

      {/* Footer */}
      {!wall && (
        <div className="pb-16 lg:pb-0">
          <Footer onOpenApiHealth={() => setApiHealthModalOpen(true)} />
        </div>
      )}
      {!wall && (
        <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} incidentCount={incidentFeed.incidents.length} />
      )}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}

      {/* Modals & Drawers */}
      <BookingModal
        isOpen={bookingModal.isOpen}
        onClose={() => setBookingModal((prev) => ({ ...prev, isOpen: false }))}
        workshopName={bookingModal.workshopName}
        pricingText={bookingModal.pricingText}
        currentMarker={currentMarker.marker}
        onConfirmDispatch={handleConfirmDispatch}
      />

      <CallModal
        isOpen={callModal.isOpen}
        onClose={() => setCallModal((prev) => ({ ...prev, isOpen: false }))}
        phone={callModal.phone}
        recipientName={callModal.recipientName}
      />

      <SlaModal isOpen={slaModalOpen} onClose={() => setSlaModalOpen(false)} locationMarker={currentMarker.marker} />

      <NotificationsDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onSelectIncident={(incident) => {
          writeParams(
            { page: 'radar', tab: 'incidents', road: incident.corridorCode || null, incident: incident.id, cam: null },
            true,
          );
        }}
        incidentFeed={incidentFeed}
        commutes={commutes}
        onAddCommute={goToCommutes}
      />

      <ApiHealthModal isOpen={apiHealthModalOpen} onClose={() => setApiHealthModalOpen(false)} />
    </div>
  );
}
