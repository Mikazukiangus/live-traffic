/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { TabType, Workshop, TriageSituation, ActiveDispatch } from './types/traffic';
import {
  INITIAL_GNSS,
  WORKSHOPS_DATA,
  ALTERNATE_MARKERS,
} from './data/mockData';
import { countByCorridor, useLtaIncidents } from './utils/ltaIncidents';
import { describeExpresswaySpeed, useExpresswaySpeeds } from './utils/expresswaySpeeds';
import { nearestArea, useRainForecast } from './utils/rainForecast';
import { Header } from './components/Header';
import { TelemetryBar } from './components/TelemetryBar';
import { Footer } from './components/Footer';
import { BookingModal } from './components/BookingModal';
import { CallModal } from './components/CallModal';
import { SlaModal } from './components/SlaModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ApiHealthModal } from './components/ApiHealthModal';
import { SosWorkshopsView } from './views/SosWorkshopsView';
import { LiveRadarView } from './views/LiveRadarView';
import { HighwayCamerasView } from './views/HighwayCamerasView';
import { CourierHubView } from './views/CourierHubView';
import { useUrlParam, writeParams } from './utils/urlState';

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

export default function App() {
  const [pageSlug] = useUrlParam('page');
  const activeTab = pageFromSlug(pageSlug);
  // A new page starts on its own default tab, and Back returns to the previous page.
  const setActiveTab = (tab: TabType) => {
    if (tab !== activeTab) writeParams({ page: PAGE_SLUGS[tab], tab: null, cam: null }, true);
    window.scrollTo({ top: 0 });
  };
  // Show the page in the address from the first load, so it can be copied straight away.
  useEffect(() => {
    if (pageSlug !== PAGE_SLUGS[activeTab]) writeParams({ page: PAGE_SLUGS[activeTab] });
  }, [pageSlug, activeTab]);
  const [currentMarker, setCurrentMarker] = useState(INITIAL_GNSS);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [activeDispatch, setActiveDispatch] = useState<ActiveDispatch | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Live LTA incidents, shared by the radar panel and the notifications drawer
  const incidentFeed = useLtaIncidents();
  const expresswaySpeeds = useExpresswaySpeeds();
  const rainForecast = useRainForecast();

  // Live readings for the pickup expressway (the pickup location itself is a demo pin)
  const pickupCode = currentMarker.corridor;
  const pickupSpeedText = describeExpresswaySpeed(expresswaySpeeds, pickupCode);
  const pickupIncidents = countByCorridor(incidentFeed.incidents)[pickupCode] || 0;
  const pickupIncidentsText =
    incidentFeed.status === 'loading'
      ? 'Loading…'
      : incidentFeed.status === 'error' && incidentFeed.incidents.length === 0
      ? 'Unavailable'
      : `${pickupIncidents} active`;
  const pickupRainArea = rainForecast ? nearestArea(currentMarker.lat, currentMarker.lng, rainForecast.areas) : null;
  const pickupRainText = pickupRainArea ? `${pickupRainArea.name}: ${pickupRainArea.forecast}` : null;

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
  const handleToggleBroadcast = () => {
    setIsBroadcasting((prev) => !prev);
    if (!isBroadcasting && !activeDispatch) {
      // Auto-assign a rapid emergency responder
      setActiveDispatch({
        id: `EMAS-${Date.now().toString().slice(-5)}`,
        triageTitle: 'LTA Rapid Roadside Telemetry Beacon',
        workshopName: 'Kaki Bukit Autowerks Hub • FleetCare 24',
        vehiclePlate: 'XD 4921 B (Assigned Tow)',
        vehicleClass: 'Expressway Incident Unit',
        contactPhone: '+65 9182 3421',
        locationMarker: currentMarker.marker,
        unitCode: 'Unit T-09',
        truckPlate: 'XD 4921 B',
        driverName: 'Tan Ah Huat (LTA EMAS Contractor)',
        driverPhone: '+65 9182 3421',
        etaMins: 6,
        step: 'en_route',
        costText: 'LTA Subsidized Recovery Corridor Rate',
        createdAt: new Date().toLocaleTimeString(),
      });
    }
  };

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

  const handleConfirmDispatch = (dispatch: ActiveDispatch) => {
    setActiveDispatch(dispatch);
    setIsBroadcasting(true);
  };

  const handleSearchCorridor = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      // If matches any alternate corridor, auto update marker
      const matched = ALTERNATE_MARKERS.find((m) =>
        m.corridor.toLowerCase().includes(query.toLowerCase())
      );
      if (matched) {
        setCurrentMarker(matched);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Fixed Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onSearchCorridor={handleSearchCorridor}
        searchQuery={searchQuery}
        onOpenNotifications={() => setNotificationsOpen(true)}
        notificationCount={incidentFeed.incidents.length}
      />

      {/* Main Container with 64px top padding for fixed navbar */}
      <main className="w-full pt-16 flex-1 flex flex-col">
        {/* Telemetry & GNSS fix status bar */}
        <TelemetryBar
          currentMarker={currentMarker}
          onSelectMarker={setCurrentMarker}
          incidentFeed={incidentFeed}
          pickupSpeedText={pickupSpeedText}
        />

        {/* Tab Views */}
        {activeTab === 'roadside-sos-workshops' && (
          <SosWorkshopsView
            currentMarker={currentMarker.marker}
            workshops={WORKSHOPS_DATA}
            isBroadcasting={isBroadcasting}
            onToggleBroadcast={handleToggleBroadcast}
            activeDispatch={activeDispatch}
            onCancelDispatch={() => {
              setActiveDispatch(null);
              setIsBroadcasting(false);
            }}
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
          />
        )}

        {activeTab === 'highway-cameras-emas' && (
          <HighwayCamerasView onCallHotline={handleOpenCallModal} />
        )}

        {activeTab === 'route-alerts-courier-hub' && (
          <CourierHubView
            onOpenSlaModal={() => setSlaModalOpen(true)}
            onCallHotline={handleOpenCallModal}
          />
        )}
      </main>

      {/* Footer */}
      <Footer onOpenApiHealth={() => setApiHealthModalOpen(true)} />

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

      <SlaModal
        isOpen={slaModalOpen}
        onClose={() => setSlaModalOpen(false)}
        locationMarker={currentMarker.marker}
      />

      <NotificationsDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onSelectIncident={() => setActiveTab('live-traffic-radar')}
        incidentFeed={incidentFeed}
      />

      <ApiHealthModal
        isOpen={apiHealthModalOpen}
        onClose={() => setApiHealthModalOpen(false)}
      />
    </div>
  );
}
