import { CongestionStatus, IncidentAlert } from '../../types/traffic';
import { TravelRoute } from '../../utils/ltaTravelTimes';
import { CorridorRain } from '../../utils/rainForecast';
import { RoadWork } from '../../utils/roadConditions';
import { FloodAlert } from '../../utils/floodAlerts';

interface SpeedSummary {
  avgSpeedKmH: number;
  status: CongestionStatus;
}

export interface MyCommuteProps {
  routes: TravelRoute[];
  travelFetchedAt: number | null;
  travelStatus: 'loading' | 'live' | 'error';
  speeds: Record<string, SpeedSummary> | null;
  incidents: IncidentAlert[];
  roadWorks: Record<string, RoadWork[]>;
  rain: Record<string, CorridorRain>;
  lightning: Record<string, number>;
  floods: Record<string, FloodAlert[]>;
  // Whole-expressway estimate for KPE/MCE, which LTA doesn't publish travel times for
  estimateMinutes: (code: string) => number | null;
  onShowOnMap: (code: string) => void;
}
