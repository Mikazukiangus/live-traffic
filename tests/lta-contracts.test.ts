import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPayloadError, safeFailure } from '../shared/diagnostics.ts';
import { isLtaIncidentPayload } from '../shared/traffic/incidents.ts';
import {
  captureTimeFromLink,
  fromDataMallCameras,
  fromPublicCameras,
  isCameraPayload,
  isDataMallCameras,
  isPublicCameras,
} from '../shared/traffic/cameras.ts';
import { isTimestamp } from '../shared/traffic/validation.ts';
import { fetchCameras } from '../src/features/cameras/cameraClient.ts';
import { probe } from '../server/healthProbes.ts';

const traffic = (await import('../api/traffic.ts')).default;
const cameras = (await import('../api/trafficimages.ts')).default;
const incident = {
  Type: 'Accident',
  Latitude: 1.3,
  Longitude: 103.8,
  Message: '(20/10)08:15 Accident on PIE (towards Tuas).',
};
const timestamp = '2026-10-20T00:15:00Z';
const image = 'https://images.data.gov.sg/2701_1120_20261020001500_test.jpg?signature=synthetic-private-marker';
const camera = { CameraID: 2701, ImageLink: image, Latitude: 1.44, Longitude: 103.77 };
const publicData = {
  items: [{ timestamp, cameras: [{ camera_id: '2701', image, location: { latitude: 1.44, longitude: 103.77 } }] }],
};

function nodeResponse() {
  return {
    statusCode: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}
async function mocked(run: (logs: string[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const logs: string[] = [];
  console.error = (...values) => logs.push(JSON.stringify(values));
  try {
    await run(logs);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
}
const request = { method: 'GET', url: '/api/traffic', headers: { accountkey: 'synthetic-only' } };

test('incident schema requires every field, permits empty feeds, unknown types and added fields', () => {
  assert.ok(isLtaIncidentPayload({ value: [] }));
  assert.ok(
    isLtaIncidentPayload({
      value: [{ ...incident, Type: 'Future incident type', extra: true }],
      'odata.metadata': 'https://example.test/metadata',
    }),
  );
  for (const bad of [
    null,
    [],
    {},
    { value: null },
    { value: {} },
    { value: [null] },
    { value: [{ ...incident, Type: 7 }] },
    { value: [{ ...incident, Message: '' }] },
    { value: [{ ...incident, Latitude: '1.3' }] },
    { value: [{ ...incident, Longitude: Infinity }] },
    { value: [{ ...incident, Latitude: 91 }] },
    { value: [{ ...incident, Longitude: -181 }] },
    { value: [{ Message: 'incomplete' }] },
    { value: [incident, { ...incident, Message: {} }] },
    { value: [], 'odata.metadata': {} },
  ]) {
    assert.equal(isLtaIncidentPayload(bad), false);
  }
});

test('camera upstream schemas reject malformed wrappers, rows, duplicate IDs and unsafe URLs', () => {
  assert.ok(isDataMallCameras({ value: [] }));
  assert.ok(isDataMallCameras({ value: [camera] }));
  for (const row of [
    null,
    { ...camera, CameraID: null },
    { ...camera, CameraID: 1.5 },
    { ...camera, Latitude: NaN },
    { ...camera, ImageLink: image.replace('20261020', '20260230') },
    { ...camera, Longitude: 181 },
    { ...camera, ImageLink: 'http://images.data.gov.sg/test.jpg' },
    { ...camera, ImageLink: 'javascript:alert(1)' },
    { ...camera, ImageLink: 'https://user:pass@images.data.gov.sg/test.jpg' },
  ]) {
    assert.equal(isDataMallCameras({ value: [row] }), false);
  }
  assert.equal(isDataMallCameras({ value: [camera, { ...camera, CameraID: '2701' }] }), false);
  for (const wrapper of [{}, { value: null }, { value: {} }]) assert.equal(isDataMallCameras(wrapper), false);
  assert.ok(isPublicCameras(publicData));
  assert.ok(isPublicCameras({ items: [{ timestamp, cameras: [] }] }));
  for (const bad of [
    {},
    { items: [] },
    { items: [{}] },
    { items: [{ timestamp, cameras: null }] },
    { items: [{ timestamp, cameras: [{ ...publicData.items[0].cameras[0], location: null }] }] },
    { items: [{ timestamp, cameras: [{ ...publicData.items[0].cameras[0], timestamp: 'bad' }] }] },
    { items: [{ timestamp, cameras: [publicData.items[0].cameras[0], publicData.items[0].cameras[0]] }] },
  ]) {
    assert.equal(isPublicCameras(bad), false);
  }
});

test('timestamps reject invalid calendar dates, ambiguous local time and invalid offsets', () => {
  for (const valid of [timestamp, '2024-02-29T23:59:59.123+08:00', '2026-10-20T08:15:00+08:00'])
    assert.ok(isTimestamp(valid));
  for (const bad of [
    null,
    1,
    '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-10-20T24:00:00Z',
    '2026-10-20T00:60:00Z',
    '2026-10-20T00:00:00',
    '2026-10-20T00:00:00+14:01',
  ])
    assert.equal(isTimestamp(bad), false);
  assert.equal(captureTimeFromLink(image), '2026-10-20T00:15:00.000Z');
  assert.throws(
    () => captureTimeFromLink('https://images.data.gov.sg/2701_1120_20260230001500_test.jpg'),
    InvalidPayloadError,
  );
  assert.equal(captureTimeFromLink('https://images.data.gov.sg/current.jpg'), null);
});

test('normalization preserves signed links, capture times and public observation timestamps', () => {
  const payload = fromDataMallCameras({ value: [camera] }, '2026-10-20T01:00:00Z');
  assert.ok(isCameraPayload(payload));
  assert.equal(payload.cameras[0].image, image);
  assert.equal(payload.timestamp, '2026-10-20T00:15:00.000Z');
  assert.equal(payload.totalCameras, 1);
  const fallback = fromPublicCameras(publicData);
  assert.equal(fallback.timestamp, timestamp);
  assert.equal(fallback.cameras[0].timestamp, timestamp);
  assert.equal(
    fromDataMallCameras({ value: [{ ...camera, ImageLink: 'https://images.data.gov.sg/current.jpg' }] }, timestamp)
      .timestamp,
    timestamp,
  );
  for (const changes of [
    { totalCameras: 2 },
    { success: false },
    { source: 'unexpected' },
    { timestamp: 'bad' },
    { cameras: [{ ...payload.cameras[0], timestamp: null }] },
    { cameras: [payload.cameras[0], payload.cameras[0]], totalCameras: 2 },
  ]) {
    assert.equal(isCameraPayload({ ...payload, ...changes }), false);
  }
  assert.equal(
    fromPublicCameras({ items: [publicData.items[0], { timestamp: '2026-10-20T09:00:00+08:00', cameras: [] }] })
      .totalCameras,
    0,
  );
});

for (const mode of ['web', 'node']) {
  test(`incident ${mode} handler rejects malformed HTTP 200 JSON before caching and preserves valid OData`, async () => {
    await mocked(async (logs) => {
      for (const invalid of [false, true, 'json']) {
        const payload = { 'odata.metadata': 'https://example.test/metadata', value: [incident] };
        globalThis.fetch = async () =>
          invalid === 'json'
            ? new Response('synthetic-private-marker')
            : Response.json(
                invalid ? { value: [{ ...incident, Message: { token: 'synthetic-private-marker' } }] } : payload,
              );
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = (await traffic(request, res)) as Response;
        assert.equal(res ? res.statusCode : response.status, invalid ? 502 : 200);
        const body = res ? res.body : await response.json();
        if (!invalid) assert.deepEqual(body, payload);
        else {
          assert.equal(body.code, 'UPSTREAM_INVALID_RESPONSE');
          assert.ok(!JSON.stringify(body).includes('synthetic-private-marker'));
          assert.equal(res ? res.headers['cache-control'] : response.headers.get('cache-control'), 'no-store');
          assert.ok(!JSON.stringify([body, logs]).includes('synthetic-private-marker'));
        }
      }
      globalThis.fetch = async () => Response.json({ value: [] });
      assert.equal(((await traffic(request)) as Response).status, 200);
    });
  });

  test(`camera ${mode} handler recovers from invalid DataMall, rejects two bad sources and accepts genuine empty feeds`, async () => {
    await mocked(async (logs) => {
      for (const scenario of ['valid', 'fallback', 'invalid-date', 'both-bad', 'empty']) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          if (calls === 1)
            return Response.json(
              scenario === 'valid'
                ? { value: [camera] }
                : scenario === 'empty'
                  ? { value: [] }
                  : scenario === 'invalid-date'
                    ? { value: [{ ...camera, ImageLink: image.replace('20261020', '20260230') }] }
                    : { value: [{ ...camera, ImageLink: { token: 'synthetic-private-marker' } }] },
            );
          return Response.json(scenario === 'both-bad' ? {} : publicData);
        };
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = (await cameras(request, res)) as Response;
        const body = res ? res.body : await response.json();
        assert.equal(res ? res.statusCode : response.status, scenario === 'both-bad' ? 502 : 200);
        if (scenario === 'both-bad') {
          assert.equal(body.code, 'UPSTREAM_INVALID_RESPONSE');
          assert.ok(!JSON.stringify(body).includes('synthetic-private-marker'));
          assert.equal(res ? res.headers['cache-control'] : response.headers.get('cache-control'), 'no-store');
        } else {
          assert.ok(isCameraPayload(body));
          assert.equal(body.source, ['valid', 'empty'].includes(scenario) ? 'lta_datamall_v2' : 'data_gov_sg_lta_live');
          assert.equal(body.totalCameras, scenario === 'empty' ? 0 : 1);
          assert.equal(calls, ['valid', 'empty'].includes(scenario) ? 1 : 2);
        }
      }
      assert.ok(!JSON.stringify(logs).includes('synthetic-private-marker'));
    });
  });
}

test('browser camera client rejects bad internal data, recovers through validated public feed and rejects bad fallback', async () => {
  await mocked(async () => {
    for (const invalidPublic of [false, true]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json(calls === 1 ? { success: true, cameras: [{ image }] } : invalidPublic ? {} : publicData);
      };
      if (invalidPublic) await assert.rejects(fetchCameras(), InvalidPayloadError);
      else {
        const result = await fetchCameras();
        assert.equal(result.cameras.length, 1);
        assert.equal(result.timestamp, timestamp);
        assert.equal(result.offline, false);
      }
      assert.equal(calls, 2);
    }
  });
});

test('health probes distinguish schema-invalid HTTP 200 from a healthy empty incident snapshot', async () => {
  await mocked(async () => {
    globalThis.fetch = async () => Response.json({ value: [{ ...incident, Type: [] }] });
    const bad = await probe('https://example.test/traffic', {}, isLtaIncidentPayload);
    assert.equal(bad.status, 'DOWN');
    assert.equal(bad.httpCode, 200);
    assert.equal(bad.error, safeFailure('lta', new InvalidPayloadError()).body.error);
    globalThis.fetch = async () => Response.json({ value: [] });
    assert.equal((await probe('https://example.test/traffic', {}, isLtaIncidentPayload)).status, 'UP');
  });
});
