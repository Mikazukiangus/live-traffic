// Names for the eight cameras still published by LTA. Shared by the camera view and search.
export type CameraPlace = 'woodlands' | 'tuas' | 'sentosa';

export const CAMERA_DIRECTORY: Record<
  string,
  { name: string; short: string; place: CameraPlace; corridor: string; locationDesc: string }
> = {
  '2701': {
    name: 'BKE • Woodlands Causeway (Towards Johor)',
    short: 'Causeway towards Johor',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'Causeway Bridge Inspection Entry • Camera #2701',
  },
  '2702': {
    name: 'BKE • Woodlands Checkpoint Viaduct',
    short: 'Checkpoint viaduct',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'Woodlands Crossing Approach to BKE • Camera #2702',
  },
  '2704': {
    name: 'BKE • Woodlands South Flyover (Exit 10)',
    short: 'Woodlands South flyover',
    place: 'woodlands',
    corridor: 'BKE',
    locationDesc: 'BKE before Turf Club Avenue • Camera #2704',
  },
  '4703': {
    name: 'AYE • Tuas Second Link Bridge (Towards Malaysia)',
    short: 'Second Link towards Malaysia',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Second Link International Bridge KM 1.2 • Camera #4703',
  },
  '4712': {
    name: 'AYE • Tuas Checkpoint Arrival Viaduct',
    short: 'Checkpoint arrival viaduct',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Jalan Ahmad Ibrahim Approach • Camera #4712',
  },
  '4713': {
    name: 'AYE • Tuas West Checkpoint Departure',
    short: 'Tuas West departure',
    place: 'tuas',
    corridor: 'AYE',
    locationDesc: 'Tuas West Extension Viaduct • Camera #4713',
  },
  '4798': {
    name: 'MCE • Sentosa Gateway / HarbourFront Viaduct',
    short: 'Sentosa Gateway',
    place: 'sentosa',
    corridor: 'MCE',
    locationDesc: 'Sentosa Gateway after Telok Blangah Rd • Camera #4798',
  },
  '4799': {
    name: 'MCE • Telok Blangah Rd / Keppel Bay Approach',
    short: 'Telok Blangah / Keppel Bay',
    place: 'sentosa',
    corridor: 'MCE',
    locationDesc: 'HarbourFront towards Marina Coastal Expressway • Camera #4799',
  },
};

