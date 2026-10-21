# CSRF review

Reviewed on 21 October 2026 against main at `d8a3ef587ca1f8d7df397f8c85c6a6cf89ebd2ab`.

Follow-up: the [CORS allowlist preview](docs/api/cors.md) replaces the wildcard policy described at that pinned baseline and rejects untrusted origins before application work. The historical verification below describes the reviewed baseline; CORS remains separate from authentication/CSRF protection for future writes.

## Result

No app-owned cookie-authenticated routes or server-side user mutations were found. All 16 callable API modules accept only GET and OPTIONS. No application CSRF gap was identified, so no token system, authentication code or CORS change was added.

This conclusion applies to the current application boundary. It does not certify Vercel's authentication implementation or make a future cookie-authenticated write route safe automatically.

## Reviewed boundaries

| Boundary | Evidence and behavior |
|---|---|
| API methods | [Request parsing](server/http/requestSchemas.ts#L124) rejects methods other than GET/OPTIONS before body parsing, provider calls or business handlers. [The guard](server/http/validateRequest.ts#L5) returns no-store 405 with `Allow: GET, OPTIONS`. |
| GET and method overrides | GETs retrieve shared feeds, images and diagnostics; cache refreshes do not change a user's account or application records. Bodies and unknown `_method` query parameters are rejected. No method-override middleware or header-based write dispatch exists. |
| Authentication | No app session creation, cookie-based identity check or cookie-auth library was found in runtime sources/dependencies. The [LTA provider](server/providers/lta.ts#L12) uses server configuration or validated explicit key headers, not cookies. Incoming cookies are not forwarded as provider credentials. |
| CORS | [Response helpers](server/http/responses.ts#L2) advertise GET/OPTIONS and do not enable `Access-Control-Allow-Credentials`. The configurable origin defaults to `*` for shared read-only feeds. CORS is not treated as CSRF protection. |
| Forms and persistence | [Booking](src/components/BookingModal.tsx#L29), [dispatch](src/features/sos/useDemoDispatch.ts) and [SLA output](src/components/SlaModal.tsx) are local demo state. [Saved commutes](src/features/commutes/commuteRepository.ts) and preferences use browser storage. These do not call an authenticated write API. |
| Deployment login | Vercel Authentication can set its own deployment-access cookie. That platform gate is separate from an application session; its full login/logout flow and internal CSRF enforcement were not audited. Deployment protection and platform cookies were not changed. |

Callable modules covered: `traffic`, `trafficflow`, `vms`, `traveltimes`, `trafficimages`, `expresswayspeeds`, `health`, `rainforecast`, `forecast24h`, `airquality`, `imageproxy`, `live`, `_carparks`, `_roadconditions`, `_weatheralerts`, `_floods`. Internal feed modules were also exercised directly, in addition to dispatcher coverage in the existing suite.

## Verification

An isolated handler matrix used synthetic cookies/credentials and a foreign Origin with `Sec-Fetch-Site: cross-site`. It did not load `.env.local`, replay real platform cookies or call production providers.

- 512 POST/PUT/PATCH/DELETE requests across 16 modules, Node/Web adapters and four content types (URL-encoded form, multipart form, text/plain, JSON) returned 405. Responses were no-store, advertised only GET/OPTIONS, did not allow credentialed CORS and did not echo the synthetic cookie.
- 64 GET requests containing a body or `_method` query override returned 400. A method-override header did not bypass validation.
- 32 OPTIONS requests returned 204 and advertised only GET/OPTIONS, including when the proposed method was POST. A successful OPTIONS response does not authorize that proposed method.
- 12 named Web GET exports rejected a passed POST request with 405 as well.
- Rejected/preflight requests made zero provider calls and produced zero unexpected diagnostic logs.

Existing regression suites also passed: **15 tests, zero failures**.

```sh
node --import tsx --test tests/request-boundaries.test.ts tests/transport-security.test.ts
```

The permanent [boundary suite](tests/request-boundaries.test.ts) discovers callable API modules and covers method/body/query rejection before provider work. The [transport suite](tests/transport-security.test.ts) and source gate flag common new cookie-writing paths for review. The gate is conservative, not a complete authentication or CSRF analyzer. The additional matrix was an isolated check; no permanent duplicate tests or dependencies were added. These are handler/source checks, not a browser audit of the Vercel login flow.

## Before adding cookie-authenticated writes

Implement authentication and authorization alongside CSRF defenses before exposing such a route:

1. Keep GET free of user/account mutations, including logout or action links.
2. Use the framework's supported CSRF protection or unpredictable session-bound tokens on unsafe methods. Validate before state changes; include ordinary form submissions, not only JSON requests.
3. Validate the exact trusted Origin with an explicit fallback policy where necessary. Fetch Metadata checks can supplement this; account for same-site sibling origins rather than trusting every same-site request.
4. Apply the [session-cookie policy](TRANSPORT_SECURITY.md#cookie-policy), including Secure, HttpOnly and appropriate SameSite attributes. SameSite is defense in depth, not a substitute for CSRF validation.
5. Require the intended content type and narrowly allow origins if credentialed cross-origin requests are necessary. Never use wildcard credentialed CORS. Keep cookies/tokens out of logs and errors, and test rejection before mutations.

Guidance: [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Platform boundary: [Vercel Authentication documentation](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).
