# Structured application logging

Prepared on `codex/structured-request-logging` for Preview review. Main/production
activation requires explicit merge approval. This extends the centralized exception
tracking already released in PR #31; it does not add another telemetry destination.

## Usage and shape

Use the shared logger for application diagnostics:

```ts
import { logger } from '../shared/logging.ts'; // adjust the relative path
logger.warn({ event: 'api_rate_limit', outcome: 'limited' });
```

Server code can import `logger` from `server/observability/context.ts` to initialize
the server context/threshold. The shared module stays browser-safe. Do not pass a
request, session, error object, message string or arbitrary metadata. Extend the
reviewed field/event vocabulary if a new diagnostic is needed. Exception callers
continue to use `reportFailure`, `reportApplicationFailure` or `captureException`;
these now use the same JSON writer and keep safe user responses/reference IDs.

Every emitted application line has `schemaVersion=1`, server/client-generated ISO
`timestamp`, `level`, fixed `event`, allowed diagnostic fields and `context`:

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-10-28T13:30:00.000Z",
  "level": "warn",
  "event": "api_rate_limit",
  "outcome": "limited",
  "context": {
    "requestId": "10c20662-4098-4c1a-8912-aa8df17f117c",
    "route": "traffic",
    "method": "GET",
    "release": "unknown",
    "environment": "production",
    "page": "unknown",
    "user": { "status": "anonymous" }
  }
}
```

This is a synthetic example. Authenticated server context has
`user: {status: "authenticated", id: "<64 lowercase hex HMAC characters>"}`.
Exception lines additionally carry `errorId`, safe type/numeric coordinates and
a grouping fingerprint. Search these fields in the existing Vercel project logs.

## Automatic request and user context

- AsyncLocalStorage owns each request's ID/context. Awaited and nested live-feed
  calls keep it; concurrent requests cannot overwrite one another. The Vite
  dev/preview adapter scopes loader failures as well, after environment loading.
  Calls outside an HTTP context omit requestId instead of inventing one.
- Only a server-verified Better Auth session establishes identity. Cookies are
  read only by the session verifier and never enter the log. Forged headers,
  req.user fields, query/body IDs and incoming request-ID headers are ignored.
- Raw user IDs are replaced by HMAC-SHA256 using the existing private auth signing
  secret, a logging-specific versioned prefix and environment. The same account
  can be correlated without publishing its ID/email. Auth-secret rotation or
  environment changes intentionally change this pseudonym. No new key is needed.
- Missing/revoked sessions and disabled login become `anonymous`; lookup failure,
  malformed identity or missing HMAC key becomes `unavailable`. Early validation,
  preflight/admission failure and pre-verification library messages may be
  `unverified`. These states never pretend a lookup succeeded.
- Origin enrichment happens after validation and IP admission, once per actual
  request even through nested dispatch. It skips disabled login and requests
  without a session cookie. A configured deadline bounds the optional lookup;
  failure does not reject public traffic or replace existing authorization.
  Late verifier completion cannot mutate the request's identity.
- Proxy quota logs reuse their existing verified session without another logging
  lookup. Proxy and origin are separate invocations: origin verifies independently
  rather than trusting forwarded identity headers. Auth sign-out/password actions
  can attribute a verified actor; session/sign-in results use validated server data.
- Browser context remains `unverified`. The credential-free browser-report endpoint
  marks receipt `anonymous` and still rejects user/context fields in its payload.
  It does not read an account to associate browser telemetry with a person.

Production login remains in its existing disabled state. Public production traffic
therefore logs anonymous after the normal validation/admission boundary. This
change does not enable login, provision accounts, change session storage or expand
Firewall scope.

## Configuration and privacy

Validated, server-only settings are documented in the generated `.env.example`:

- `LOG_LEVEL=info`: `debug`, `info`, `warn`, `error`, or `silent`. `silent` also
  mutes exception log output; safe user responses and reference generation remain.
- `LOG_USER_CONTEXT_TIMEOUT_MS=1000`: 100–5,000 milliseconds. This bounds logging
  enrichment only; existing verifier/database deadlines and admission policies
  remain separate. No cross-request session cache or persistent identity store is
  introduced.

The writer reconstructs allowed scalar fields and numeric coordinates, ignores
object accessors/toJSON, and rejects arbitrary strings/objects and attempts to
override reserved fields/context. It recomputes fingerprints from safe fields.
Messages, raw exceptions/stacks, URLs/query strings, bodies, headers, cookies,
credentials, raw account IDs, email/IP/location and roles are not logged. No roles
or verified identity are inferred from browser input. Failed log sinks cannot
change business responses. No global console monkey-patch is used.

Application diagnostics in API/server/shared/browser code now use the writer,
including rate limiting, provider/application/auth failures, background work,
install prompts and transport policy warnings. Auth operator completion/failure
and environment-example generation also use JSON. Machine-readable configuration,
Firewall-command/audit outputs, CI annotations/Markdown and interactive hidden
password prompts retain their output contracts; they are not application logging.
Framework/dependency/hosting logs remain outside this writer's control. Existing
Vercel access, delivery and retention limits still apply.

## Verification

All **322 tests** passed, zero failures/skips; type checking, transport audit,
production build, generated-env consistency and whitespace checks passed. Eleven
new groups cover one envelope across levels/errors, allowlisting/hostile getters,
thresholds, concurrent/nested identities, missing/forged/revoked sessions, failure
and timeout without late mutation, validation ordering/safe error responses,
real Better Auth signed sessions in an isolated in-memory database, auth-failure
actor context, Node ambiguity, dev loader failures and centralized runtime sinks.
The existing account-admission test now verifies the envelope and pseudonym.
Cookie audit exceptions remain exact reviewed read/forward-to-verifier lines.
No live account/database/provider, credential export, browser permission or real
notification was used for these tests.

## Preview publication — 28 October 2026

Implementation `c06f7a38486a72a154c5f4e6eb044e1380d58609` is published in draft
[PR #32](https://github.com/Mikazukiangus/live-traffic/pull/32). GitHub Checks runs
`40699218814` and `40699148520` and Vercel checks passed; required CI job
`122853905088` diagnostics confirm all 322 tests, zero failures/skips, transport
audit and build.

[Preview](https://live-traffic-m90bnq02x-carbon-bc04.vercel.app) deployment
`dpl_FQ3MkLgE6mGdskELGqyPRonaDwRG` is READY for the exact implementation,
correct project/team and Preview branch. Read-only CLI inspection confirmed
`carbon-bc04/live-traffic` before bounded authenticated POST probes with generated
JSON in stdin. No environment settings or credentials were downloaded/exported.

- A valid synthetic report returned HTTP 202 with its matching error ID.
- An extra client-supplied `user` object returned HTTP 400 `INVALID_ERROR_REPORT`.
- A deployment-scoped Vercel log search returned the matching event with
  schemaVersion 1, level error, fixed event/code, timestamp, generated request ID,
  errors/POST route, Preview release/environment and `user.status=anonymous`.

Telemetry receipt is intentionally anonymous. Verified-user HMAC context is proven
by the isolated real signed/revoked session tests, not by creating a live account
or enabling login on this branch. These checks establish selected deployed log
receipt, not every catch site, framework output or unlimited delivery/retention.
No production or Firewall/auth setting was changed. The publication follow-up is
documentation only; main merge still requires explicit approval.
