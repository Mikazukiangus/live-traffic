# API request contracts

Implemented on preview branch `codex/request-boundary-validation` (21 October 2026). Main merge requires approval.

Every HTTP API entry point validates its request before entering the handler's application logic, looking up a cached feed or making provider/health requests. Pure schemas live in `server/http/requestSchemas.ts`; `withRequestSchema` adapts their results to Node and Web responses. No new dependency is required.

## Accepted inputs

| API | Query schema |
|---|---|
| `/api/traffic`, `/api/trafficflow`, `/api/vms`, `/api/traveltimes` | Optional `$skip`: canonical decimal integer, 0–2147483647 (OData Int32) |
| `/api/expresswayspeeds` | Optional `include=segments`, exactly |
| `/api/imageproxy` | Required `url`: absolute HTTPS image URL, at most 8192 characters; existing exact hostname allowlist; no embedded credentials, fragment, nonstandard port, whitespace, backslash or malformed percent escape |
| `/api/live` | Required `feed`: `roadconditions`, `carparks`, `weatheralerts` or `floods` |
| `/api/health`, `/api/trafficimages`, `/api/rainforecast`, `/api/forecast24h`, `/api/airquality` | No query parameters |
| Internal `_roadconditions`, `_carparks`, `_weatheralerts`, `_floods` modules | Guarded even when invoked directly. Optional `feed` must match that module |

Only `GET` and `OPTIONS` are accepted. No route accepts a request body: parsed bodies, declared nonzero/invalid content lengths and transfer-encoded bodies are rejected without consuming a stream. These are read-only feeds, so a JSON body/content-type schema is intentionally absent. A future write endpoint must define a body contract before parsing and business processing.

Queries reject unknown keys, duplicate keys (including encoded aliases), arrays/objects/numbers from a Node query parser, invalid UTF-8/percent encoding, conflicting raw-versus-parsed values, more than eight keys and request URLs over 16384 characters. This deliberately stops the old LTA proxy's arbitrary query forwarding. `$filter`, `$format`, `$top`, arbitrary cache-busters and misspelled parameters now return 400. Existing app requests use the contracts above; success payloads and cache policies are preserved.

Consumed credential headers (`AccountKey`, `x-account-key`, `x-lta-account-key`) must be nonempty printable ASCII scalars of at most 512 characters, with no whitespace, commas or duplicate same-name headers. Multiple aliases must agree. Node dictionaries/raw headers and Web `Headers` share these rules. The validated server environment key retains precedence; otherwise the existing header fallback works on the LTA proxy and camera metadata routes. An invalid supplied header is rejected even if the environment key exists. Other transport/platform headers are not business inputs and are not passed to providers.

Image validation inspects a parsed URL but forwards the original string, preserving signed query bytes. Host restrictions and provider redirect rejection remain enforced. This is an allowlist for the existing public image services, not an arbitrary URL-fetch service.

## Rejections

Malformed requests return HTTP 400. Unsupported methods return 405 and `Allow: GET, OPTIONS`; a disallowed image destination returns 403. All validation errors are `no-store`, without upstream work or raw input logging. Example:

```json
{
  "success": false,
  "code": "INVALID_REQUEST",
  "error": "Invalid request",
  "issues": [{ "field": "$skip", "code": "INVALID_REQUEST" }]
}
```

Fields/codes are closed metadata. Responses never echo submitted values, arbitrary field names, credentials, signatures, request bodies or parser exceptions. Missing/unknown live feed selectors now return 400 (previously 404); malformed image URLs now return 400 (previously they could become 502). Genuine provider failures remain upstream errors.

`OPTIONS` validates the envelope, body, credentials and query encoding, then answers CORS without requiring GET-specific fields such as `feed` or `url`. It does not call application logic. Node/Web preflights consistently advertise the existing GET/OPTIONS contract and all supported key aliases.

## Boundaries and verification

This contract concerns incoming HTTP requests. Existing validated environment configuration, incident/camera/rain provider responses, browser feed guards and versioned commute-storage schemas retain their own owners. It does not claim new exhaustive schemas for all third-party response fields, browser form state or a future authentication/database API. HTTP framing/TLS and rejection of oversized raw network headers remain platform responsibilities. No authentication or rate-limit policy is added by this change.

The regression matrix covers every callable API module, Node and Web adapters, named Web exports, CORS, no-store rejections and zero provider calls for rejected input. Additional cases cover ambiguous query values, encoded duplicate keys, scalar bounds, header alias conflicts/duplicates, unsafe proxy destinations, exact signed-link forwarding and validated OData pagination. Existing diagnostics tests now supply valid envelopes so they continue exercising upstream failure sanitization.

Implementation references: [Vercel Node request helpers](https://vercel.com/docs/functions/runtimes/node-js) and [MDN's 405/Allow contract](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/405).
