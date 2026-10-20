import { InvalidPayloadError } from '../diagnostics.ts';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const isLatitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 90;
export const isLongitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 180;

/** Require an explicit timezone and a real calendar date, without Date.parse rollover. */
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone, zoneHour, zoneMinute] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() + 1 === Number(month) &&
    calendar.getUTCDate() === Number(day) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (zone === 'Z' ||
      (Number(zoneHour) <= 14 && Number(zoneMinute) <= 59 && (Number(zoneHour) < 14 || Number(zoneMinute) === 0))) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Keep signed query parameters untouched. Host restrictions remain owned by the image proxy. */
export function isImageUrl(value: unknown): value is string {
  if (!isText(value) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Parse failures and schema failures use the same safe classification, without response snippets. */
export async function readValidatedJson<T>(
  response: Pick<Response, 'json'>,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
    throw new InvalidPayloadError();
  }
  if (!validate(value)) throw new InvalidPayloadError();
  return value;
}
