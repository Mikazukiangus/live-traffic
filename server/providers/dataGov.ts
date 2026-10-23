import { config } from '../../config/server.ts';
import { createDataGovClient } from './dataGovClient.ts';
import { fetchProvider } from '../http/providerFetch.ts';
import { waitForRetry } from '../../shared/requestDeadline.ts';
const client = createDataGovClient({
  fetch: fetchProvider,
  now: Date.now,
  sleep: waitForRetry,
  random: Math.random,
  intervalMs: config.server.weather.minIntervalMs,
  retryDelayMs: config.server.weatherRetryDelayMs,
  maxRetryWaitMs: config.server.weather.maxRetryWaitMs,
  timeoutMs: config.server.weatherTimeoutMs,
  budgetMs: config.server.weather.requestBudgetMs,
  transientRetryDelayMs: config.server.lta.retryDelayMs,
});
export const fetchDataGovV2 = client.data;
