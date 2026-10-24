import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withListResponse } from '../server/http/listPagination.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import { snapshotCacheHeaders } from '../server/http/responses.ts';
import { config } from '../config/server.ts';
import { getSpeedSummary } from '../server/traffic/speedService.ts';
import { NO_STORE, getLtaAccountKey } from './_client.ts';
export type { ExpresswaySpeedSummary, CheckpointApproach, SpeedSegment } from '../shared/traffic/types.ts';
export { traceCheckpoint, CHECKPOINT_ROUTES } from '../server/traffic/traceCheckpoint.ts';

const handler = withListResponse(requestSchemas.speeds, 'expresswayspeeds', ['expressways', 'checkpoints', 'segments'], async (_req, res, input) => {
  const { send } = input;

  const accountKey = getLtaAccountKey();
  if (!accountKey) {
    return send(401, { success: false, error: 'LTA_ACCOUNT_KEY not configured' }, NO_STORE);
  }

  try {
    const cache = await getSpeedSummary(accountKey);
    const body = input.query.includeSegments ? { ...cache.payload, segments: cache.segments } : cache.payload;
    return send(200, body, snapshotCacheHeaders(cache.expiresAt, config.server.cache.speeds));
  } catch (err: any) {
    return send(providerFailureStatus(err), reportFailure('lta', err), providerFailureHeaders(err));
  }
}, query => query.includeSegments ? ['expressways', 'checkpoints', 'segments'] : ['expressways', 'checkpoints']);
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
