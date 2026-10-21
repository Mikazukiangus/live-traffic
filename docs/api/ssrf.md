# Outbound URL and DNS guard

Released to main through [PR #17](https://github.com/Mikazukiangus/live-traffic/pull/17), merge `c8ec1ff`, on 22 October 2026 after explicit approval. Both GitHub Checks runs and Vercel checks passed at reviewed head `2bd6a2f`. Preview evidence is recorded in Turns 120–121 of the project log; release verification and limits are recorded in Turn 122.

## Scope and enforcement

The user-supplied server URL boundary is `/api/imageproxy?url=...`. Its existing HTTPS/443 camera hostname allowlist remains in `requestSchemas.image`; arbitrary Internet destinations are not enabled. `fetchProvider` now adds a shared network guard to that proxy and every application provider request: LTA, cameras, speed pagination, data.gov.sg and health probes.

| Stage | Enforcement |
|---|---|
| URL parsing, before transport | HTTPS on port 443 only; reject credentials, fragments, raw controls/whitespace/backslashes, oversized inputs, invalid hostnames and local hostnames. Normalize with URL parsing before checking numeric IP spellings. |
| IP literals | Require public unicast; reject loopback/private/link-local/unspecified/multicast/reserved/documentation/benchmark ranges, cloud metadata addresses, IPv4-mapped IPv6 and IPv6 transition addresses. IPv6 is additionally restricted to public global-unicast space. Azure's public-shaped host-services address is explicitly denied. |
| Hostname resolution | The socket's lookup resolves all OS-returned IPv4/IPv6 answers and checks every address before selecting the requested connection family. One forbidden, malformed or mismatched-family answer rejects the entire set. Empty/failed lookups fail closed. |
| Socket connection | An explicit Undici Agent supplies the guarded lookup to TLS. The connector receives those validated addresses directly; there is no separate unchecked DNS lookup after a preflight check. Every new connection resolves/checks again. Existing pooled connections retain their already validated peer. |
| TLS, redirects and transport options | Keep hostname/certificate verification enabled and preserve the original hostname for TLS/HTTP. Force redirect:error, even if a caller asks to follow. Caller-supplied dispatcher options cannot replace the guarded agent. HTTP/2 is disabled on this agent, keeping the connection policy on the verified HTTP/1.1 path. |
| Errors and bytes | Guard errors contain fixed codes/messages only, with no submitted URL, resolver answer/error, key or signed query. Existing endpoint diagnostics remain sanitized. The original URL string, query escapes, headers, signal, response bytes and cache policies are preserved. |

This follows [OWASP's recommendation to validate all resolved addresses and prevent DNS-pinning bypasses](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). Replacing the URL's hostname with an IP would alter TLS/Host behavior and potentially signed URLs; checking at the socket lookup avoids that substitution. See [Undici connector documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Connector.md).

## Ownership and runtime

- `server/http/ssrf.ts`: IP policy, URL validation, fixed errors, guarded socket lookup and agent construction.
- `server/http/providerFetch.ts`: snapshots the input into an immutable string, validates it, and forces the protected dispatcher/no-redirect policy for every application provider call.
- `server/http/requestSchemas.ts`: retains the stricter user-facing image destination allowlist and input limits before transport.
- `shared/diagnostics.ts`: continues projecting upstream failures into fixed public/log classifications. A DNS destination rejection appears as a generic no-store upstream failure (502) through current handlers; an image destination rejected by the input allowlist retains its existing 400/403 contract.
- `tests/ssrf.test.ts`: deterministic URL/IP/DNS/connection/redirect regressions, with synthetic data and no live provider requests.

Pinned runtime dependencies are `undici@7.30.1` and `ipaddr.js@2.5.0`; `bun.lock` pins their integrity. The former supplies a supported socket lookup hook for Node's native fetch; the latter supplies maintained IPv4/IPv6 parsing/classification rather than a handwritten parser. The project is configured for Node 24 on Vercel and CI. A real native-fetch test caught an incompatible Undici 8 dispatcher interface before publication, so the maintained compatible 7.x line is used and tested. No global dispatcher or TLS setting is changed.

Use Node for the server/test runtime, as configured in this project. Bun continues installing the frozen lockfile and launching package scripts. Alternate runtimes that ignore Node fetch's dispatcher are not established as safe by this implementation.

## Compatibility and limits

The outbound helper now rejects private destinations and HTTP even in local development. The previous generic loopback-HTTP transport exception is removed. Configuration parsing can still accept local mock URLs in explicit dev/test mode, but this does not authorize the network helper to fetch them. Tests must inject a synthetic transport/resolver; the app exposes no request/environment switch to bypass the guard. The Vite localhost frontend/CORS behavior is independent and remains supported.

No redirect is followed, even to another public HTTPS URL. If a provider changes to require redirects or resolves to a special-use address, its request fails safely and needs an explicit review. The existing camera allowlist remains the first boundary; public-IP validation does not make arbitrary user-selected providers safe to receive private headers. Browser-side fallback requests and offline tooling are not server-side user-URL fetch paths and are not routed through this Node helper.

## Verification

Seven new regression groups cover:

1. Public versus private/special IPv4/IPv6, metadata, mapped/transition and zone-ID addresses.
2. Unsafe schemes, embedded credentials, non-443 ports, malformed URLs and integer/octal/hex/abbreviated/encoded private-IP URL spellings, rejected before transport.
3. Entire mixed A/AAAA answer validation, including a forbidden IPv6 answer alongside an otherwise eligible public IPv4 answer.
4. Public-to-private rebinding on a later lookup, empty/malformed answers, family mismatches and synchronous/asynchronous DNS failures with redacted errors.
5. Unchanged signed query/header/signal values and inability to override the dispatcher or redirect policy.
6. An actual native fetch/Agent connection attempt whose injected resolver returns loopback: rejected by the socket lookup with SSRF_ADDRESS_BLOCKED, before a private connection or credentials can be sent.
7. Native redirect rejection using a MockAgent with real network disabled; no redirect target is dispatched.

All **155 tests**, type checking with unused locals, production build, transport source audit and whitespace checks passed. Existing boundary/CORS, provider response, caching and diagnostics suites continue to pass. Frozen-lockfile installation and deployed preview evidence are recorded in Turn 120 of the project log.

The protected preview returned HTTP 200 for its homepage/entry asset, eight LTA camera records and the two-hour forecast's 47 areas. Its image proxy returned no-store 403 for a forbidden loopback URL. On continuation, a credential-free image from the keyless public camera feed returned HTTP 200 through the proxy as a 176,218-byte JPEG with the existing image cache policy. This verifies deployed public DNS/HTTPS/image compatibility; private DNS/rebinding cases are covered by the isolated native-fetch tests, not live private-network probes. Automatic approval review rejected a presigned-camera-URL probe before execution because it contained access credentials; the successful image check used an independent unsigned public URL instead.
