/** Data contracts shared by HTTP adapters, traffic rules and browser consumers. */
export type CongestionStatus = 'Smooth' | 'Moderate' | 'Heavy' | 'Congested';
export type SpeedSegment = [string, number, number, number, number, number];
export interface ExpresswaySpeedSummary {
  code: string;
  avgSpeedKmH: number;
  linkCount: number;
  slowLinkPct: number;
  status: CongestionStatus;
  bandCounts: Record<string, number>;
}
export interface CheckpointApproach {
  id: 'woodlands' | 'tuas';
  name: string;
  via: string;
  km: number;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  queueSpeedKmH: number | null;
}
export interface SpeedPayload {
  success: true;
  source: string;
  lastUpdatedTime: string | null;
  generatedAt: string;
  pagesFetched: number;
  totalLinks: number;
  expressways: ExpresswaySpeedSummary[];
  checkpoints: CheckpointApproach[];
  segments?: SpeedSegment[];
}
