import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LookupFunction } from 'node:net';
import { MockAgent } from 'undici';
import { createPublicLookup, createSsrfAgent, isPublicAddress, providerDispatcher, SsrfError,
  validateOutboundUrl, type AddressResolver } from '../server/http/ssrf.ts';
import { fetchProvider } from '../server/http/providerFetch.ts';
import { safeFailure } from '../shared/diagnostics.ts';

const privateAddresses = [
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254',
  '172.16.0.1', '172.31.255.254', '192.168.0.1', '100.64.0.1', '100.100.100.200',
  '192.0.0.9', '192.0.2.1', '198.18.0.1', '198.19.255.254', '198.51.100.1', '203.0.113.1',
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '168.63.129.16',
  '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1',
  '::ffff:8.8.8.8', '::ffff:10.0.0.1', '64:ff9b::a00:1', '64:ff9b:1::1', '2002:7f00:1::',
  '2001::1', '2001:2::1', '2001:db8::1', '2001:20::1', '3fff::1', '100::1', '5f00::1',
  '4000::1', 'fe80::1%lo0', 'not-an-address', '2130706433', '',
];
const publicAddresses = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'];
function runLookup(lookup: LookupFunction, options: { all?: boolean; family?: number } = { all: true }) {
  return new Promise<{ address: unknown; family: number | undefined }>((resolve, reject) => {
    lookup('images.example.test', options, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
}
function redacted(error: unknown, code?: string) {
  assert.ok(error instanceof SsrfError);
  if (code) assert.equal(error.code, code);
  for (const value of ['private-marker', '169.254.169.254', 'localhost', 'signature='])
    assert.ok(!JSON.stringify([error, error.message, safeFailure('camera', error)]).includes(value));
  assert.equal(error.cause, undefined);
  return true;
}

test('public address policy rejects private, special, metadata and transition IPv4/IPv6 ranges', () => {
  for (const address of privateAddresses) assert.equal(isPublicAddress(address), false, address);
  for (const address of publicAddresses) assert.equal(isPublicAddress(address), true, address);
});

test('URL guard rejects unsafe schemes, parser tricks, private literals and non-HTTPS ports before transport', () => {
  let calls = 0;
  const transport = (async () => { calls++; return Response.json({ ok: true }); }) as typeof fetch;
  for (const url of [
    'http://8.8.8.8/private-marker', 'file:///etc/private-marker', 'ftp://8.8.8.8/private-marker',
    'gopher://8.8.8.8/', 'data:text/plain,private-marker', 'javascript:private-marker',
    '//8.8.8.8/private-marker', 'https://localhost/', 'https://localhost./', 'https://app.localhost/',
    'https://machine.local/', 'https://user:private-marker@images.example.test/',
    'https://images.example.test:8443/', 'https://images.example.test/#private-marker',
    'https://images.example.test/\nprivate-marker', 'https://images.example.test\\private-marker',
    'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://127.1/',
    'https://%31%32%37.0.0.1/', 'https://[::ffff:127.0.0.1]/', 'https://[::1]/',
    'https://169.254.169.254/latest/meta-data', 'https://168.63.129.16/',
    'https://example.test/' + 'x'.repeat(16384), 'invalid-private-marker',
  ]) assert.throws(() => fetchProvider(url, { headers: { AccountKey: 'private-marker' } }, transport), (error) => redacted(error));
  assert.equal(calls, 0);
  for (const address of publicAddresses) {
    const host = address.includes(':') ? `[${address}]` : address;
    assert.equal(validateOutboundUrl(`https://${host}/`).protocol, 'https:');
  }
});

test('socket lookup validates every DNS answer, including mixed families, before selecting a peer', async () => {
  for (const bad of privateAddresses.filter((address) => address !== '')) {
    const family = bad.includes(':') ? 6 : 4;
    const lookup = createPublicLookup(async () => [{ address: '8.8.8.8', family: 4 }, { address: bad, family }]);
    // A public requested IPv4 family cannot hide a private IPv6 answer.
    await assert.rejects(runLookup(lookup, { all: true, family: 4 }), (error) => redacted(error, 'SSRF_ADDRESS_BLOCKED'));
  }
  const answers = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
  let calls = 0;
  const lookup = createPublicLookup(async () => { calls++; return answers; });
  assert.deepEqual((await runLookup(lookup)).address, answers);
  assert.deepEqual(await runLookup(lookup, { family: 6 }), { address: answers[1].address, family: 6 });
  assert.deepEqual((await runLookup(lookup, { all: true, family: 4 })).address, [answers[0]]);
  assert.equal(calls, 3);
});

test('fresh socket lookups recheck rebinding; failed/empty/malformed DNS fails closed without raw details', async () => {
  let calls = 0;
  const lookup = createPublicLookup(async () => [{ address: ++calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]);
  assert.deepEqual((await runLookup(lookup)).address, [{ address: '8.8.8.8', family: 4 }]);
  await assert.rejects(runLookup(lookup), (error) => redacted(error, 'SSRF_ADDRESS_BLOCKED'));
  assert.equal(calls, 2);
  const invalid: AddressResolver[] = [
    async () => [], async () => [{ address: '8.8.8.8', family: 6 }],
    async () => [{ address: 'private-marker', family: 4 }], async () => [null as any],
    async () => { throw new Error('DNS private-marker:169.254.169.254'); },
    () => { throw new Error('sync DNS private-marker'); },
  ];
  for (const resolve of invalid) await assert.rejects(runLookup(createPublicLookup(resolve)), (error) => redacted(error));
  await assert.rejects(runLookup(createPublicLookup(async () => [{ address: '8.8.8.8', family: 4 }]), { family: 6 }),
    (error) => redacted(error, 'SSRF_DNS_FAILED'));
});

test('fetch preserves signed query/header/signal bytes and cannot override the guarded dispatcher or redirects', async () => {
  const url = 'https://images.example.test/photo.jpg?signature=synthetic%2Bvalue%2fexact&part=1+2';
  const headers = { AccountKey: 'synthetic-key' }, signal = new AbortController().signal;
  let calls = 0;
  await fetchProvider(url, { headers, signal, redirect: 'follow', dispatcher: 'bypass' } as RequestInit, (async (input, options) => {
    calls++;
    assert.equal(input, url);
    assert.equal(options?.headers, headers);
    assert.equal(options?.signal, signal);
    assert.equal(options?.redirect, 'error');
    assert.equal((options as any).dispatcher, providerDispatcher);
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch);
  assert.equal(calls, 1);
});

test('actual fetch connector rejects private DNS results before any connection or credentials can be sent', async () => {
  let lookups = 0;
  const agent = createSsrfAgent(async () => { lookups++; return [{ address: '127.0.0.1', family: 4 }]; });
  try {
    await assert.rejects(globalThis.fetch('https://images.example.test/', { headers: { AccountKey: 'synthetic-only' },
      signal: AbortSignal.timeout(2000), dispatcher: agent } as RequestInit), (error: any) => {
      assert.ok(error instanceof TypeError);
      assert.ok(error.cause instanceof SsrfError);
      assert.equal(error.cause.code, 'SSRF_ADDRESS_BLOCKED');
      return true;
    });
    assert.equal(lookups, 1);
  } finally { await agent.close(); }
});

test('native redirect rejection never dispatches a redirect target, including metadata and unsafe schemes', async () => {
  const mock = new MockAgent(); mock.disableNetConnect();
  const pool = mock.get('https://images.example.test');
  try {
    for (const location of ['https://169.254.169.254/latest/meta-data', 'http://127.0.0.1/',
      'file:///etc/passwd', 'https://outside.example.test/']) {
      pool.intercept({ path: '/redirect', method: 'GET' }).reply(302, '', { headers: { location } });
      await assert.rejects(fetchProvider('https://images.example.test/redirect', {},
        (async (input, options) => globalThis.fetch(input, { ...options, dispatcher: mock } as RequestInit)) as typeof fetch), TypeError);
    }
    mock.assertNoPendingInterceptors();
  } finally { await mock.close(); }
});
