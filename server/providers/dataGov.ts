import { config } from '../../config/server.ts';
import { createDataGovClient } from './dataGovClient.ts';
const client = createDataGovClient({
  fetch: (...args) => fetch(...args),
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  intervalMs: config.server.weather.minIntervalMs,
  retryDelayMs: config.server.weatherRetryDelayMs,
  maxRetryWaitMs: config.server.weather.maxRetryWaitMs,
  timeoutMs: config.server.weatherTimeoutMs,
});
export const fetchDataGovV2 = client.data;
