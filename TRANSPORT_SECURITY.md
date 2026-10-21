# HTTPS, cookies and mixed content

Released to main through [PR #12](https://github.com/Mikazukiangus/live-traffic/pull/12), merge `7d700bc`, on 21 October 2026. Production headers, HTTP redirects and selected endpoint transport were verified after release; see Turn 110 in CHAT_COMMENTS_AND_INSTRUCTIONS.md.

Pending follow-up: `codex/xss-script-csp` tightens script sources as a separate preview on top of the metadata/notification fixes in PR #14. The script/offline details below describe that preview; main keeps its existing policy until the follow-up is approved and merged.

## Findings

| Area | Verified baseline | Released change |
|---|---|---|
| Public HTTP navigation | Production returns 308 to the same HTTPS hostname, preserving path/query | Retain Vercel's edge redirect; verified on preview and production |
| HSTS | Production sends `max-age=63072000; includeSubDomains; preload` | Record the same policy explicitly for every route in `vercel.json` |
| Browser resources | No active insecure URL literals found; cameras already reject HTTP URLs | Enforce a transport-focused Content Security Policy and add source/console checks |
| Provider requests | HTTPS URLs configured, but fetch followed redirects by default | Validate each provider URL before sending; reject all redirects |
| Configuration | Loopback HTTP was accepted even for production overrides | Permit it only in explicit local development/tests; builds and deployments require HTTPS |
| App cookies | No cookie creation, session cookie or cookie library found | Preserve this design and require explicit review for new cookie paths in CI |

Baseline source: main at `c0595e9`. The production homepage was fetched through existing authenticated access; no Set-Cookie header was present on that response. A credential-free HTTP request with redirects disabled returned 308 and `Location: https://live-traffic-carbon-bc04.vercel.app/?page=cameras&tab=signs`. This is a transport check, not an audit of Vercel's full authentication flow or every third-party response.

## Enforcement boundaries

### Edge redirects and headers

Vercel terminates TLS and upgrades HTTP before application routing. No application middleware, Host-header-derived redirect or production-only hostname redirect was added. Preview URLs remain independent. Do not add a second blanket redirect that points previews to production.

The `/(.*)` rule in `vercel.json` applies the security headers to pages, APIs, assets and the service worker. It includes two-year HSTS, the content policy, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Vite's local production preview reads that same header definition; development HMR is unaffected.

HSTS is learned from HTTPS responses and does not secure a first HTTP visit by itself. The edge redirect remains necessary. The `preload` directive preserves the observed baseline; no preload-list submission or registration check was performed. It does not prove that any hostname is in a browser preload list. Vercel documents its [default HSTS response header](https://vercel.com/docs/headers/response-headers#strict-transport-security) and [TLS/HTTP upgrade behavior](https://vercel.com/docs/cdn-security/encryption).

### Content policy and offline pages

`upgrade-insecure-requests` upgrades eligible HTTP resources to HTTPS without an HTTP fallback. On the CSP preview, scripts are restricted to `'self'` plus the narrowly required `'wasm-unsafe-eval'`; `script-src-attr 'none'` explicitly blocks inline event handlers. Arbitrary HTTPS scripts, inline scripts and ordinary JavaScript eval are not authorized. The early preference bootstrap is an external, synchronous same-origin `/theme-init.js`, preserving saved theme/text size before paint. Google Fonts, HTTPS images, data/blob images, WASM compilation and same-origin/blob workers remain supported by their existing directives. `object-src 'none'` and a same-origin base URL prevent legacy object loading and external base changes. Secure WebSockets remain available.

This is an allowlist policy, not a nonce-based strict CSP or a substitute for contextual output encoding. Existing inline React styles and HTTPS resource/connect directives remain; script permissions are tightened independently. Optional third-party scripts, including an injected Vercel Toolbar, are not permitted by the application script policy. Protected preview HTTP access does not require authorizing that toolbar; no broad production exception or account setting change was added. If toolbar execution is later needed, review a narrowly scoped preview-only exception first. See [MDN's script-src reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src) and [Vercel Toolbar CSP requirements](https://vercel.com/docs/vercel-toolbar/managing-toolbar).

The CSP preview refreshes only the shell cache to `shell-v7` and precaches `/theme-init.js` with the HTML shell. That script has a network-first shell fallback so offline startup can still apply preferences. Existing data/font/asset caches and observation ages are preserved. Network-first/cached receipt-time semantics remain unchanged. Full offline rendering still requires a previously warmed application asset cache; this change does not promise every page is available offline before its assets have been acquired.

### Server and configuration

`server/http/providerFetch.ts` checks the URL scheme and embedded credentials before sending anything, then forces `redirect: 'error'`. LTA requests, pagination, speed pages, camera metadata/images, data.gov.sg's server adapter and health probes use this boundary. Unexpected redirects fail safely through existing diagnostics rather than forwarding the AccountKey to another location or accepting a transport downgrade. Signed image query bytes remain unchanged.

The data.gov.sg client remains injected and independent of server configuration. Its production adapter supplies the guarded transport; pacing, retry deadlines and pending-request sharing remain. The browser's public camera fallback also rejects redirects.

Production/default server config, Vercel deployments and public build projections require HTTPS resource/provider settings. Vite enforces this during build/preview even if NODE_ENV was mistakenly set to development. `PRODUCTION_HEALTH_URL` always requires HTTPS because automation sends a bypass credential there. Explicit local development/test config may use loopback HTTP; arbitrary remote HTTP remains invalid. `allowLoopbackHttp` is derived policy, not a new environment setting or bypass variable. No `.env` values were changed.

## Cookie policy

TrafficPulse currently keeps preferences/commutes in localStorage and has no app login/session cookie. No cookie was introduced just to exercise cookie attributes. The source audit flags common cookie writes, Set-Cookie headers, Cookie Store API use and cookie-library dependencies for explicit review.

If application sessions are added, implement them on the server and update the gate only alongside the reviewed cookie implementation and tests. The expected session-cookie attributes are:

```text
__Host-session=<opaque-value>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Use no Domain attribute, make expiry/deletion retain the same scope/security attributes, and never put tokens in localStorage or diagnostic output. `Secure` prevents HTTP transmission; `HttpOnly` restricts JavaScript access; `SameSite` is a cross-site request control. `__Host-` binds the cookie to its HTTPS host and root path. See [MDN's Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). A real authentication feature also needs its own server authorization and CSRF design.

Vercel Authentication/Toolbar and external services control their own cookies. The app cannot rewrite those cookies with a generic response header. No platform cookie values, authentication state or private keys were inspected or printed. The single observed response without Set-Cookie does not establish that the entire protected-site login flow is cookie-free.

## Finding mixed content

Run:

```sh
bun run security:audit
```

This runs in GitHub Checks too. It inspects runtime source, CSS/HTML/SVG/JSON/public files and the root deployment/package manifests for HTTP/WS URL literals, common protocol-relative resource syntax, and cookie paths. Diagnostics contain file, line and a fixed classification only. It excludes tests/docs and non-executable license text; W3C SVG namespace identifiers are not fetched resources. Dummy URL-parsing bases now use HTTPS as well.

The gate is conservative and can flag comments/examples in runtime files. It recognizes common escaped literals, but is not a full taint analyzer: arbitrary dynamically assembled URLs, dependency internals and all third-party cookie behavior need separate review. Browser CSP and existing provider/camera validation cover runtime transport boundaries.

`src/utils/transportSecurity.ts` also listens for CSP violations on production pages. HTTP/WS violations produce a deduplicated console notice with fixed event/code, scheme and a recognized directive. Raw URLs, signatures, queries, paths, cookie values and source snippets are omitted. Upgrades that succeed do not necessarily emit a violation; use the source gate and browser Network/Console tools together. No public reporting endpoint or background telemetry was added.

## Verification

- Deterministic tests cover production versus local configuration, safe rejected-value errors, forced no-redirect provider requests, signed-query preservation, global header coverage, source-gate findings, cookie review paths and redacted/deduplicated browser notices.
- A real production-build test rejects an HTTP resource override even under an incorrect development NODE_ENV.
- A loopback fixture served the built app with the actual deployed header policy and synthetic API responses. It rendered the app/radar with zero policy violations and JavaScript errors. After warming the caches and stopping that fixture's network listener, a reload still rendered Live Traffic and confirmed the cached HTML retained CSP.
- A separate production-built fixture used the actual ONNX/WASM worker vehicle counter on a synthetic frame. It completed with zero policy violations; this checks CSP/runtime compatibility, not detection accuracy.
- Loopback browser checks are a development exception, not proof of an Internet TLS handshake. The deployed preview's actual HTTPS headers, edge redirects and selected live endpoint status/URL schemes are verified separately and recorded in CHAT_COMMENTS_AND_INSTRUCTIONS.md. No real saved user storage was modified.
