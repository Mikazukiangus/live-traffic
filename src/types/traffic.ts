export type TabType = 'live-traffic-radar' | 'highway-cameras-emas' | 'roadside-sos-workshops' | 'route-alerts-courier-hub';

export type WorkshopCategory = 'all' | 'towing' | 'insurance' | 'fleet' | 'ev';

export interface GnssMarker {
  lat: number;
  lng: number;
  hdop: number;
  satellites: number;
  marker: string;
  corridor: string;
  nearestBay: string;
}

export interface Workshop {
  id: string;
  name: string;
  location: string;
  address: string;
  distanceKm: number;
  fromMarker: string;
  rating: number;
  reviewCount: number;
  statusBadge: string; // e.g. "Open 24/7" or "Closes 11:00 PM"
  isOpen247: boolean;
  baysAvailableText: string;
  tags: string[];
  basePrice: number;
  priceNote: string;
  phone: string;
  categories: ('towing' | 'insurance' | 'fleet' | 'ev')[];
  image: string;
  imageAlt: string;
}

export interface TriageSituation {
  id: string;
  title: string;
  description: string;
  badge: string;
  badgeColor: 'slate' | 'emerald' | 'red' | 'sky';
  priceTag: string;
  priceTagColor: 'amber' | 'emerald' | 'red' | 'sky';
  buttonLabel: string;
  icon: string;
  equipmentType: string;
  baseCost: number;
}

export interface TowUnit {
  id: string;
  code: string;
  plate: string;
  driverName: string;
  vehicleType: string;
  distanceKm: number;
  etaMins: number;
  currentExpressway: string;
  status: 'Patrolling' | 'Assigned' | 'En Route' | 'On Scene';
  phone: string;
  bayLocation: string;
}

export interface ActiveDispatch {
  id: string;
  triageTitle: string;
  workshopName: string;
  vehiclePlate: string;
  vehicleClass: string;
  contactPhone: string;
  locationMarker: string;
  unitCode: string;
  truckPlate: string;
  driverName: string;
  driverPhone: string;
  etaMins: number;
  step: 'broadcasting' | 'assigned' | 'en_route' | 'arrived';
  costText: string;
  createdAt: string;
}

export interface ExpresswayCorridor {
  code: string;
  name: string;
  status: 'Smooth' | 'Moderate' | 'Heavy' | 'Congested';
  speedKmH: number;
  speedLimit: number;
  incidentsCount: number;
  towsOnline: number;
  travelTimeMins: number;
  fromTo: string;
}

export interface IncidentAlert {
  id: string;
  corridor: string;
  corridorCode?: string; // expressway code (e.g. 'KJE'); absent for non-expressway incidents
  location: string;
  type:
    | 'Accident'
    | 'Breakdown'
    | 'Obstacle'
    | 'Heavy Congestion'
    | 'Flash Flood'
    | 'Roadwork'
    | 'Road Block'
    | 'Diversion'
    | 'Other';
  lane: string;
  severity: 'Critical' | 'Warning' | 'Info';
  timeAgo: string;
  advice: string;
}

export interface HighwayCameraFeed {
  id: string;
  name: string;
  corridor: string;
  location: string;
  imageUrl: string;
  updatedTime: string;
  speedStatus: string;
  weather: 'Dry' | 'Wet' | 'Heavy Rain';
}

export interface EmasVariableMessageSign {
  id: string;
  corridor: string;
  marker: string;
  line1: string;
  line2: string;
  status: 'CRITICAL' | 'WARNING' | 'ADVISORY' | 'NORMAL';
  updatedAt: string;
}
