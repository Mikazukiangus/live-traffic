import { isLatitude, isLongitude, isRecord, isText } from './validation.ts';

export interface LtaIncident {
  Type: string;
  Latitude: number;
  Longitude: number;
  Message: string;
}
export interface LtaIncidentPayload {
  value: LtaIncident[];
  'odata.metadata'?: string;
}

/** Empty lists and new incident types are valid; one malformed row rejects the whole snapshot. */
export function isLtaIncidentPayload(value: unknown): value is LtaIncidentPayload {
  return (
    isRecord(value) &&
    (value['odata.metadata'] === undefined || typeof value['odata.metadata'] === 'string') &&
    Array.isArray(value.value) &&
    value.value.every(
      (row: unknown) =>
        isRecord(row) &&
        isText(row.Type) &&
        isText(row.Message) &&
        isLatitude(row.Latitude) &&
        isLongitude(row.Longitude),
    )
  );
}
