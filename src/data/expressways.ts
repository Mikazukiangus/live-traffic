import type { ExpresswayCorridor } from '../types/traffic';

export const EXPRESSWAY_CORRIDORS: ExpresswayCorridor[] = [
  {
    code: 'PIE',
    name: 'Pan Island Expressway',
    fromTo: 'Changi Airport to Tuas (42.8 km)',
  },
  {
    code: 'AYE',
    name: 'Ayer Rajah Expressway',
    fromTo: 'MCE to Tuas Checkpoint (26.5 km)',
  },
  {
    code: 'ECP',
    name: 'East Coast Parkway',
    fromTo: 'Changi Airport to Sheares Bridge / MCE (20.0 km)',
  },
  {
    code: 'CTE',
    name: 'Central Expressway',
    fromTo: 'AYE to SLE (15.8 km)',
  },
  {
    code: 'TPE',
    name: 'Tampines Expressway',
    fromTo: 'PIE (Upper Changi) to SLE (14.0 km)',
  },
  {
    code: 'KPE',
    name: 'Kallang-Paya Lebar Expressway',
    fromTo: 'ECP to TPE (12.0 km)',
  },
  {
    code: 'SLE',
    name: 'Seletar Expressway',
    fromTo: 'BKE to CTE / TPE (10.8 km)',
  },
  {
    code: 'BKE',
    name: 'Bukit Timah Expressway',
    fromTo: 'PIE to Woodlands Checkpoint (10.6 km)',
  },
  {
    code: 'KJE',
    name: 'Kranji Expressway',
    fromTo: 'BKE to PIE (8.4 km)',
  },
  {
    code: 'MCE',
    name: 'Marina Coastal Expressway',
    fromTo: 'AYE to ECP / KPE (5.0 km)',
  },
];
