# API CORS policy

Released to main through [PR #16](https://github.com/Mikazukiangus/live-traffic/pull/16), merge `df32e08`, on 21 October 2026 after explicit approval. Both GitHub Checks runs and Vercel checks passed at reviewed head `2032891`. Preview evidence is recorded in Turn 118 of the project log; release verification and its limits are recorded in Turn 119.

## Allowed frontend origins

The validated `config.server.corsOrigins` allowlist includes:

- The canonical `VITE_SITE_URL` (default: `https://live-traffic-carbon-bc04.vercel.app`).
- When `VERCEL=1`, exact HTTPS origins from the current deployment's platform-owned `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`, if provided. These keep this deployment and its branch/production aliases usable, without trusting other projects or every preview on `vercel.app`.
- Additional frontend origins explicitly listed in server-only `API_CORS_ORIGINS`.
- In explicit local development/tests only, HTTP loopback origins on the configured `DEV_PORT` and `PREVIEW_PORT` for `localhost`, `127.0.0.1` and `[::1]`.

The Vite dev/preview adapter also marks its actual bound loopback listener in request-scoped server context. This preserves camera pixel access under local production preview or a CLI port override. Only that local adapter creates the context, using the socket's local address/port; deployed API handlers do not. No request Host, Forwarded header, wildcard domain or request URL is used to grant access. LAN/custom development hostnames require an explicit trusted HTTPS origin or use of a loopback address.

The frontend uses relative `/api/...` URLs, so normal requests remain on its own origin. No browser environment variable, provider CORS change or secret in frontend code is needed. Vercel Authentication remains an independent platform access gate; an allowlisted origin does not bypass it.

## Additional frontend configuration

For a separately hosted frontend, add its **origin**, not an API endpoint or page URL:

```dotenv
API_CORS_ORIGINS=https://dashboard.example.com,https://app.example.com
```

Set this server-only value on the API deployment, scoped to the intended Vercel environment/branch, then redeploy. For local work, put selected settings in the ignored `.env.local` and restart the dev server. Do not overwrite that file or copy credentials into `.env.example`.

Blank/unset adds no extra origins. Up to 32 comma-separated entries are accepted, trimmed, normalized and deduplicated. Wildcards, `null`, credentials, paths, query strings, fragments and invalid hosts fail configuration. HTTPS is required in builds/deployments; loopback HTTP is supported only in explicit local development/test config. Scheme, host and port must match the browser's serialized Origin exactly at request time.

The legacy `API_CORS_ORIGIN` accepts one exact extra origin and is combined with the list. Prefer the plural setting for new configuration. **An existing `API_CORS_ORIGIN=*` must be removed or replaced before deploying this change**; it now fails validation. Project environment metadata and local override names were checked during implementation: neither contained a CORS override, so no migration or environment mutation was needed for this project.

## Request and response behavior

| Request | Result |
|---|---|
| No Origin header | Normal API validation/handling, without Access-Control-Allow-Origin; same-origin/server clients remain usable |
| Exact allowed Origin | That single origin is returned in Access-Control-Allow-Origin, including on application/input errors |
| Unknown, opaque `null`, wildcard or origin-list value | 403 CORS_ORIGIN_DENIED before provider/business work; no allow-origin header |
| Malformed, duplicate or non-scalar consumed CORS header | 400 INVALID_REQUEST with safe field/code metadata |
| Valid preflight | 204, GET/OPTIONS advertised, no provider/business work |
| Preflight proposing a write method or unsupported header | 403 CORS_METHOD_DENIED/CORS_HEADERS_DENIED, no allow-origin header |
| Incomplete preflight | 400; plain OPTIONS without CORS request headers remains supported |

Cross-origin preflights can request GET and the headers `Content-Type`, `AccountKey`, `x-account-key`, `x-lta-account-key`. The unused Authorization permission was removed. No origin/header wildcard, credentialed CORS or exposed response-header permission is emitted. This change does not make browser-supplied provider keys necessary; the existing private server key remains preferred.

Every API response carries `Vary: Origin`, even when Origin is absent or denied. OPTIONS additionally varies by Access-Control-Request-Method and Access-Control-Request-Headers. Existing Vary tokens are preserved. Rejections/preflights are no-store, while valid shared feed/image cache profiles and signed image bytes are preserved. The existing in-instance caches retain provider data independently of response CORS headers.

CORS policy lives in `server/http/cors.ts` and runs through `withRequestSchema` before application logic. The wrapper applies it to Node and Web responses, including image bytes, with no independent wildcard headers in individual handlers. `server/http/localCors.ts` holds only local adapter context. `server/http/responses.ts` serializes responses and cache headers without choosing origins.

## Verification and limits

- Eight CORS regression groups cover configuration, environment scoping, safe errors, all 16 callable modules in Node/Web modes, named Web exports, hostile/duplicate origins, allowed/rejected preflights, errors, JSON/binary success, signed-query preservation, cache headers, Vary merging and local adapter isolation.
- The full suite passed **148 tests**; type checking with unused locals, production build, transport source audit and whitespace checks passed.
- Nine real loopback HTTP cases through the actual API middleware passed using synthetic providers, including a duplicate raw Origin header and JPEG-byte response. Exactly three authorized reads reached the synthetic provider. Three further local-preview image cases accepted the actual loopback listener origins and denied another port, with only two authorized reads.
- No real cookie, provider key, signed camera URL, saved browser data or provider traffic was used in these fixtures. The temporary HTTP listeners were stopped. Deployed preview verification is recorded in the project log.

CORS controls browser response access, not authentication or general network access. Clients outside a browser can omit or forge Origin; requests without Origin intentionally continue to work. The app still has no cookie-authenticated write API. Any future such feature requires the independent authorization/CSRF design in [CSRF_REVIEW.md](../../CSRF_REVIEW.md).

Primary references: [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [Vercel CDN cache variation](https://vercel.com/docs/caching/cdn-cache), [Vercel system deployment variables](https://vercel.com/docs/environment-variables/system-environment-variables).
