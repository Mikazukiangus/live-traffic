import React from 'react';
import { Workshop, TriageSituation, ActiveDispatch } from '../types/traffic';
import { SosHeaderBanner } from '../components/SosHeaderBanner';
import { TriageSection } from '../components/TriageSection';
import { WorkshopDirectory } from '../components/WorkshopDirectory';
import { RadarWidget } from '../components/RadarWidget';
import { EmergencySpeedDial } from '../components/EmergencySpeedDial';
import { ActiveDispatchTracker } from '../components/ActiveDispatchTracker';

interface SosWorkshopsViewProps {
  currentMarker: string;
  workshops: Workshop[];
  isBroadcasting: boolean;
  onToggleBroadcast: () => void;
  activeDispatch: ActiveDispatch | null;
  onCancelDispatch: () => void;
  onCallHotline: (phone: string, title: string) => void;
  onSelectSituation: (situation: TriageSituation) => void;
  onBookBay: (workshop: Workshop) => void;
  onOpenSlaModal: () => void;
  nearestBay: string;
  trafficSpeed: string;
}

export const SosWorkshopsView: React.FC<SosWorkshopsViewProps> = ({
  currentMarker,
  workshops,
  isBroadcasting,
  onToggleBroadcast,
  activeDispatch,
  onCancelDispatch,
  onCallHotline,
  onSelectSituation,
  onBookBay,
  onOpenSlaModal,
  nearestBay,
  trafficSpeed,
}) => {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-6">
      {/* Active Dispatch Live Status Banner if user triggered a dispatch */}
      {activeDispatch && (
        <ActiveDispatchTracker
          dispatch={activeDispatch}
          onCancel={onCancelDispatch}
          onCallDriver={onCallHotline}
        />
      )}

      {/* Emergency SOS Action Header: High-Urgency Dispatch Alert Card */}
      <SosHeaderBanner
        locationMarker={currentMarker}
        isBroadcasting={isBroadcasting}
        onToggleBroadcast={onToggleBroadcast}
        onCallHotline={onCallHotline}
      />

      {/* Section 2: Emergency Incident Triage Grid (4 Triage Situations) */}
      <TriageSection onSelectSituation={onSelectSituation} />

      {/* Section 3: Split Layout / Main Directory & Emergency Right Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Main Directory Area (8 Cols on LG) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <WorkshopDirectory
            workshops={workshops}
            onBookBay={onBookBay}
            onCallPhone={onCallHotline}
            currentMarker={currentMarker}
          />
        </div>

        {/* Right Area: Direct Toll-Free Hotlines & Live Tow Tracking Mini Map (4 Cols on LG) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <RadarWidget nearestBay={nearestBay} trafficSpeed={trafficSpeed} />
          <EmergencySpeedDial onCall={onCallHotline} onOpenSlaModal={onOpenSlaModal} />
        </div>
      </div>
    </div>
  );
};
