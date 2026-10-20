import type { HighwayCameraFeed } from '../../types/traffic';
import type { CameraPlace } from '../../data/cameras';
export interface CameraCard extends HighwayCameraFeed {
  // ISO capture time from LTA.
  capturedAt: string;
  short: string;
  place: CameraPlace | 'other';
  lat?: number;
  lon?: number;
}

export type TabId = CameraPlace | 'other' | 'all' | 'signs';
