/** Reviewed Firewall rule IDs and fixed-window policy. Keep deployment rules in sync. */
export const API_RATE_LIMITS = Object.freeze({
  id: 'trafficpulse-public-api-v1',
  name: 'TrafficPulse public API rate limit',
  windowSeconds: 60,
  requests: 300,
});
