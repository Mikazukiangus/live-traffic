import type { ActiveDispatch } from '../../types/traffic';
export function createDemoDispatch(locationMarker: string): ActiveDispatch {
  return {
    id: `EMAS-${Date.now().toString().slice(-5)}`,
    triageTitle: 'LTA Rapid Roadside Telemetry Beacon',
    workshopName: 'Kaki Bukit Autowerks Hub • FleetCare 24',
    vehiclePlate: 'XD 4921 B (Assigned Tow)',
    vehicleClass: 'Expressway Incident Unit',
    contactPhone: '+65 9182 3421',
    locationMarker: locationMarker,
    unitCode: 'Unit T-09',
    truckPlate: 'XD 4921 B',
    driverName: 'Tan Ah Huat (LTA EMAS Contractor)',
    driverPhone: '+65 9182 3421',
    etaMins: 6,
    step: 'en_route',
    costText: 'LTA Subsidized Recovery Corridor Rate',
    createdAt: new Date().toLocaleTimeString(),
  };
}
