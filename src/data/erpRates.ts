/**
 * LTA ERP base rates for expressway gantries (passenger cars, taxis, light goods vehicles).
 *
 * LTA DataMall no longer offers an ERP Rates API, so this is transcribed from LTA's published
 * rate table. Update it whenever LTA revises rates (typically quarterly):
 * https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/ERP/ERP.html
 *
 * Source: "BASE ERP RATE TABLE ... (With Effect From 29 Jun 2026)",
 * 20260626-1PCU_ERP_Rates_Report.20260623170433.pdf
 *
 * Expressway gantries only operate on weekdays. Each slot is [start, end, S$] in SGT, where the
 * rate applies from `start` (inclusive) until `end` (exclusive); times not listed are free.
 */

export const ERP_RATES_EFFECTIVE_DATE = '2026-06-29';
export const ERP_RATES_SOURCE_URL =
  'https://onemotoring.lta.gov.sg/content/dam/onemotoring/Driving/ERP/ERP_rates_tables/20260626-1PCU_ERP_Rates_Report.20260623170433.pdf';

// Rates for other vehicle types are the base rate multiplied by these LTA factors.
export const ERP_VEHICLE_FACTORS = {
  motorcycle: 0.5,
  car: 1,
  heavyGoods: 1.5, // Heavy goods vehicles / small buses
  veryHeavyGoods: 2, // Very heavy goods vehicles / big buses
} as const;

export type ErpSlot = [start: string, end: string, amount: number];

export interface ErpExpresswayGantry {
  code: string;
  location: string;
  gantryNos: string;
  weekdaySchedule: ErpSlot[];
}

export const ERP_EXPRESSWAY_GANTRIES: ErpExpresswayGantry[] = [
  {
    code: 'AYE',
    location: 'AYE between Portsdown Rd and Alexandra Rd',
    gantryNos: '36',
    weekdaySchedule: [['08:00', '08:05', 0.50], ['08:05', '08:30', 1.00], ['08:30', '08:35', 1.50], ['08:35', '08:55', 2.00], ['08:55', '09:00', 1.50], ['09:00', '09:25', 1.00], ['09:25', '09:30', 0.50]],
  },
  {
    code: 'AYE',
    location: 'Citybound AYE after Jurong Town Hall, Clementi Ave 6 and Clementi Ave 2 entries',
    gantryNos: '52, 53, 74',
    weekdaySchedule: [['07:00', '07:05', 0.50], ['07:05', '07:30', 1.00], ['07:30', '07:35', 3.00], ['07:35', '07:55', 5.00], ['07:55', '08:00', 3.50], ['08:00', '08:30', 2.00], ['08:30', '08:35', 3.00], ['08:35', '08:55', 4.00], ['08:55', '09:00', 3.50], ['09:00', '09:25', 3.00], ['09:25', '09:30', 2.50], ['09:30', '09:55', 2.00], ['09:55', '10:00', 1.00], ['17:30', '17:35', 1.50], ['17:35', '17:55', 3.00], ['17:55', '18:00', 2.00], ['18:00', '18:25', 1.00], ['18:25', '18:30', 0.50]],
  },
  {
    code: 'AYE',
    location: 'Tuasbound AYE after North Buona Vista',
    gantryNos: '41',
    weekdaySchedule: [['17:00', '17:05', 0.50], ['17:05', '17:30', 1.00], ['17:30', '17:35', 2.00], ['17:35', '17:55', 3.00], ['17:55', '18:00', 2.50], ['18:00', '18:30', 2.00], ['18:30', '18:35', 2.50], ['18:35', '18:55', 3.00], ['18:55', '19:00', 2.00], ['19:00', '19:25', 1.00], ['19:25', '19:30', 0.50]],
  },
  {
    code: 'BKE',
    location: 'BKE between Dairy Farm Rd and PIE',
    gantryNos: '54',
    weekdaySchedule: [],
  },
  {
    code: 'CTE',
    location: 'CTE after Braddell Rd, Serangoon Rd and Balestier slip road',
    gantryNos: '31, 33, 34',
    weekdaySchedule: [['07:30', '07:35', 1.00], ['07:35', '08:00', 2.00], ['08:00', '08:05', 3.00], ['08:05', '08:30', 4.00], ['08:30', '08:35', 4.50], ['08:35', '08:55', 5.00], ['08:55', '09:00', 4.50], ['09:00', '09:25', 4.00], ['09:25', '09:30', 3.50], ['09:30', '09:55', 3.00], ['09:55', '10:00', 1.50]],
  },
  {
    code: 'CTE',
    location: 'CTE slip road to PIE (Changi) / Serangoon Rd',
    gantryNos: '68',
    weekdaySchedule: [['07:30', '07:35', 1.00], ['07:35', '08:00', 2.00], ['08:00', '08:05', 2.50], ['08:05', '08:30', 3.00], ['08:30', '08:35', 4.00], ['08:35', '08:55', 5.00], ['08:55', '09:00', 4.50], ['09:00', '09:25', 4.00], ['09:25', '09:30', 3.50], ['09:30', '09:55', 3.00], ['09:55', '10:00', 1.50]],
  },
  {
    code: 'CTE',
    location: 'CTE between Ang Mo Kio Ave 1 and Braddell Rd',
    gantryNos: '35',
    weekdaySchedule: [['07:00', '07:05', 1.00], ['07:05', '08:00', 2.00], ['08:00', '08:05', 2.50], ['08:05', '09:25', 3.00], ['09:25', '09:30', 2.00], ['09:30', '09:55', 1.00], ['09:55', '10:00', 0.50]],
  },
  {
    code: 'CTE',
    location: 'CTE northbound between PIE and Braddell Rd; PIE to CTE northbound before Braddell Rd',
    gantryNos: '46, 67',
    weekdaySchedule: [['17:30', '17:35', 2.00], ['17:35', '18:55', 4.00], ['18:55', '19:00', 3.50], ['19:00', '19:25', 3.00], ['19:25', '19:30', 2.00], ['19:30', '19:55', 1.00], ['19:55', '20:00', 0.50]],
  },
  {
    code: 'CTE',
    location: 'CTE northbound between Jalan Bahagia and PIE',
    gantryNos: '51',
    weekdaySchedule: [['17:30', '17:35', 0.50], ['17:35', '18:55', 1.00], ['18:55', '19:00', 0.50]],
  },
  {
    code: 'ECP',
    location: 'ECP (City)',
    gantryNos: '30',
    weekdaySchedule: [],
  },
  {
    code: 'ECP',
    location: 'ECP eastbound before KPE',
    gantryNos: '73',
    weekdaySchedule: [],
  },
  {
    code: 'KPE',
    location: 'KPE slip road into citybound ECP',
    gantryNos: '80',
    weekdaySchedule: [],
  },
  {
    code: 'KPE',
    location: 'KPE southbound after Defu Flyover',
    gantryNos: '50',
    weekdaySchedule: [['07:00', '07:05', 0.50], ['07:05', '07:30', 1.00], ['07:30', '07:35', 2.50], ['07:35', '08:00', 4.00], ['08:00', '08:05', 4.50], ['08:05', '08:30', 5.00], ['08:30', '08:35', 5.50], ['08:35', '08:55', 6.00], ['08:55', '09:00', 4.00], ['09:00', '09:25', 2.00], ['09:25', '09:30', 1.50], ['09:30', '09:55', 1.00], ['09:55', '10:00', 0.50]],
  },
  {
    code: 'MCE',
    location: 'MCE westbound before exits to Central Boulevard and Maxwell Rd',
    gantryNos: '90, 91',
    weekdaySchedule: [],
  },
  {
    code: 'MCE',
    location: 'MCE eastbound after Maxwell Rd entry; slip road after Marina Boulevard',
    gantryNos: '92, 93',
    weekdaySchedule: [['18:30', '18:35', 0.50], ['18:35', '18:55', 1.00], ['18:55', '19:00', 0.50]],
  },
  {
    code: 'PIE',
    location: 'PIE after Kallang Bahru exit; PIE slip road into Bendemeer Rd',
    gantryNos: '32, 45',
    weekdaySchedule: [['07:00', '07:05', 0.50], ['07:05', '07:30', 1.00], ['07:30', '07:35', 1.50], ['07:35', '08:30', 2.00], ['08:30', '08:35', 3.00], ['08:35', '08:55', 4.00], ['08:55', '09:00', 3.00], ['09:00', '09:25', 2.00], ['09:25', '09:30', 1.50], ['09:30', '09:55', 1.00], ['09:55', '10:00', 0.50]],
  },
  {
    code: 'PIE',
    location: 'PIE eastbound after Adam Rd and Mount Pleasant slip road',
    gantryNos: '37, 38',
    weekdaySchedule: [['07:30', '07:35', 1.00], ['07:35', '08:25', 2.00], ['08:25', '08:30', 1.50], ['08:30', '09:25', 1.00], ['09:25', '09:30', 0.50]],
  },
  {
    code: 'PIE',
    location: 'PIE slip road into CTE',
    gantryNos: '42',
    weekdaySchedule: [['07:30', '07:35', 1.00], ['07:35', '08:00', 2.00], ['08:00', '08:05', 3.00], ['08:05', '08:30', 4.00], ['08:30', '08:35', 4.50], ['08:35', '08:55', 5.00], ['08:55', '09:00', 4.50], ['09:00', '09:25', 4.00], ['09:25', '09:30', 3.50], ['09:30', '09:55', 3.00], ['09:55', '10:00', 1.50]],
  },
  {
    code: 'PIE',
    location: 'PIE westbound before Eunos Link',
    gantryNos: '65',
    weekdaySchedule: [['07:30', '07:35', 0.50], ['07:35', '08:30', 1.00], ['08:30', '08:35', 1.50], ['08:35', '08:55', 2.00], ['08:55', '09:00', 1.50], ['09:00', '09:25', 1.00], ['09:25', '09:30', 0.50]],
  },
];
