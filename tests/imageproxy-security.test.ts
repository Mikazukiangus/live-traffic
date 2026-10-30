import { test } from 'node:test';
import assert from 'node:assert/strict';
// Use the real circuit policy: caller-selected invalid content must not pause healthy images.
const { default: proxy } = await import('../api/imageproxy.ts');

const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 1, 255, 217]);
const request = () => new Request('https://fixture.test/api/imageproxy?url=' + encodeURIComponent('https://images.data.gov.sg/current.jpg?signature=synthetic-only'));

test('image proxy rejects HTML/SVG/spoofed or incomplete images without caching provider content', async () => {
  const fetch = globalThis.fetch, error = console.error;
  console.error = () => {};
  try {
    for (const [bytes, type] of [[new TextEncoder().encode('<svg onload="synthetic-private-marker"/>'), 'image/jpeg'],
      [jpeg.slice(0, -2), 'image/jpeg'], [jpeg, 'text/html'], [new Uint8Array(), 'application/octet-stream']] as const) {
      globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': type } });
      const response = await proxy(request()) as Response;
      assert.equal(response.status, 502);
      assert.match(response.headers.get('cache-control')!, /no-store/);
      assert.ok(!(await response.text()).includes('synthetic-private-marker'));
    }
  } finally { globalThis.fetch = fetch; console.error = error; }
});

test('image proxy cancels both declared oversize and streamed oversize, even with a misleading Content-Length', async () => {
  const fetch = globalThis.fetch, error = console.error;
  console.error = () => {};
  try {
    for (const length of [String(5 * 1024 * 1024 + 1), null, '8']) {
      let cancelled = false, chunks = 0;
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        if (chunks++ < 8) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close();
      }, cancel() { cancelled = true; } });
      globalThis.fetch = async () => new Response(body, { headers: {
        'content-type': 'image/jpeg', ...(length ? { 'content-length': length } : {}),
      } });
      const response = await proxy(request()) as Response;
      assert.equal(response.status, 502); assert.equal(cancelled, true);
      assert.ok(chunks <= 7, 'stop consuming the stream as soon as the cap is crossed');
      assert.match(response.headers.get('cache-control')!, /no-store/);
    }
  } finally { globalThis.fetch = fetch; console.error = error; }
});

test('image proxy preserves bounded JPEG bytes for official octet-stream images', async () => {
  const fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(jpeg, { headers: { 'content-type': 'application/octet-stream' } });
    const response = await proxy(request()) as Response;
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
  } finally { globalThis.fetch = fetch; }
});

test('repeated caller-selected invalid images cannot open the shared provider circuit', async () => {
  const fetch = globalThis.fetch, error = console.error;
  console.error = () => {};
  try {
    const target = new Request('https://fixture.test/api/imageproxy?url=' + encodeURIComponent('https://datamall.lta.gov.sg/not-an-image'));
    for (let i = 0; i < 8; i++) {
      globalThis.fetch = async () => new Response('synthetic non-image page', { headers: { 'content-type': 'text/html' } });
      assert.equal((await proxy(target.clone()) as Response).status, 502);
    }
    globalThis.fetch = async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    assert.equal((await proxy(target.clone()) as Response).status, 200);
  } finally { globalThis.fetch = fetch; console.error = error; }
});
