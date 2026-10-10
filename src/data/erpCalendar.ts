/**
 * Gazetted holidays, including substitute Mondays. Verified 10 Oct 2026 against:
 * https://www.mom.gov.sg/employment-practices/public-holidays
 * https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027
 * Add the next year's calendar when MOM publishes it.
 */
export const ERP_CALENDAR_YEARS = [2026, 2027];
export const PUBLIC_HOLIDAYS: Record<string, string> = {
  '2026-01-01': "New Year's Day", '2026-02-17': 'Chinese New Year', '2026-02-18': 'Chinese New Year',
  '2026-03-21': 'Hari Raya Puasa', '2026-04-03': 'Good Friday', '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji', '2026-05-31': 'Vesak Day', '2026-06-01': 'Vesak Day (observed)',
  '2026-08-09': 'National Day', '2026-08-10': 'National Day (observed)',
  '2026-11-08': 'Deepavali', '2026-11-09': 'Deepavali (observed)', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-02-06': 'Chinese New Year', '2027-02-07': 'Chinese New Year',
  '2027-02-08': 'Chinese New Year (observed)', '2027-03-10': 'Hari Raya Puasa',
  '2027-03-26': 'Good Friday', '2027-05-01': 'Labour Day', '2027-05-17': 'Hari Raya Haji',
  '2027-05-20': 'Vesak Day', '2027-08-09': 'National Day', '2027-10-28': 'Deepavali', '2027-12-25': 'Christmas Day',
};

// LTA's detailed "ERP operating hours" section and the road-user-charge rules specify Puasa:
// https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/ERP/ERP.html
// https://sso.agc.gov.sg/SL-Supp/S122-2026/Published/20260320?DocDate=20260320
// These are the actual eves, not the day before a substitute Monday or the second CNY day.
export const EARLY_CLOSING_EVES = new Set([
  '2026-02-16', '2026-03-20', '2026-11-07', '2026-12-24', '2026-12-31',
  '2027-02-05', '2027-03-09', '2027-10-27', '2027-12-24', '2027-12-31',
]);
