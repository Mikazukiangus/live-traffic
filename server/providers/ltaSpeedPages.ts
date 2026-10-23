import { config } from '../../config/server.ts';
import { InvalidPayloadError } from '../../shared/diagnostics.ts';
import { readProvider } from '../http/readProvider.ts';

const SPEED_BANDS_ENDPOINT = config.server.upstreams.speedBands;
export async function fetchPage(skip: number, accountKey: string): Promise<{ value: any[]; lastUpdatedTime?: string }> {
  return readProvider(`${SPEED_BANDS_ENDPOINT}?$skip=${skip}`, async (response) => {
    const data = await response.json();
    if (!Array.isArray(data?.value)) throw new InvalidPayloadError();
    return { value: data.value, lastUpdatedTime: data.lastUpdatedTime };
  }, { headers: { AccountKey: accountKey, accept: 'application/json' } }, { attempts: config.server.speeds.attempts });
}
