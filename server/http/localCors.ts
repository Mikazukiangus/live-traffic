// Only the Vite dev/preview adapter marks requests. Direct deployed API handlers never do.
// WeakMap context cannot be supplied by an HTTP header or leak between requests.
const originsByRequest = new WeakMap<object, readonly string[]>();

export function markLocalCorsRequest(req: any) {
  const address = req?.socket?.localAddress;
  const port = req?.socket?.localPort;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || !Number.isInteger(port) || port < 1 || port > 65535) return;
  originsByRequest.set(req, ['localhost', '127.0.0.1', '[::1]'].map((host) => {
    const origin = new URL(`https://${host}`);
    origin.protocol = 'http:';
    origin.port = String(port);
    return origin.origin;
  }));
}

export function localCorsOrigins(req: any): readonly string[] {
  return req && typeof req === 'object' ? originsByRequest.get(req) ?? [] : [];
}
