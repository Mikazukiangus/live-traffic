# Application login implementation plan

Status: **on hold at the user's request**, 22 October 2026. Login and lockout
are not implemented. Resume only when the user explicitly requests it.

The user selected a **new application login** in response to the login-target question.
The user subsequently put this work on hold because the app has no login now.
The proposal below is retained for future reference; it is not active work.

## Product choices to revisit if work resumes

1. **Enrollment:** invite/admin-created accounts (recommended starting point), or
   public signup. Public signup also needs a verified-email delivery and recovery
   flow before release. Invitation/account setup needs an explicit secure mechanism;
   never email passwords or put them in source, command arguments or chat.
2. **Access scope:** keep shared traffic/cameras public and protect personal features
   (recommended), or require login for the entire site. If the latter is chosen,
   enforce it at the server/API boundary as well as in the interface; a client-only
   login screen does not protect feeds.

Existing commutes are device-local. Adding a login does not by itself make them
private or cloud-synced. If commutes become account features, scope storage to the
authenticated account, test account switching/logout, and require an explicit
import decision for existing device-local records. Demo booking/dispatch remains
a demo unless a real protected workflow is separately implemented.

## Verified prerequisites

- Vite/React frontend and Node 24 Vercel handlers; no existing auth or database
  dependency, credential verifier, session issuer or account model.
- Hosted environment metadata lists LTA_ACCOUNT_KEY for production/preview, with
  no database/auth variable. No values were decrypted or printed.
- The intended Vercel team has a Neon integration installed. Its configuration
  lists no connected projects; a database connection for this app is unverified.
- Marketplace metadata offers Neon in Singapore (`sin1`) and a Free plan requiring
  no payment method. Confirm a suitable resource can be connected before creating
  another one. Do not select a paid plan automatically. Use separate preview data
  and secrets; do not run development migrations against production.

## Recommended implementation

Use maintained Better Auth with Postgres-backed accounts and revocable opaque
sessions. Confirm the installed stable version against its versioned documentation
before implementation; the currently retrieved rate-limit docs identify 1.7.12.
Use its supported Node handler/React client, not Next.js middleware snippets.

Keep auth modules separate from provider-feed access. Add explicit auth routing in
both Vercel and local Vite/preview. Preserve the existing feed GET/OPTIONS guards
and exact CORS allowlist. Auth writes need their own bounded schemas, body limits,
content-type checks, exact trusted Origin/CSRF checks and generic sanitized errors.
Never trust an arbitrary Host or forwarded origin to construct callback URLs.

Use server-only validated config, generated .env.example entries and lazy database
initialization. Persist no password/session credential in localStorage. Use reviewed
password hashing through the auth library, with explicit algorithm/cost policy and
deployed-runtime verification. Use Secure/HttpOnly/SameSite cookies on deployments,
short documented expiry, revocation on logout, and no shared-domain cookie scope.

### Lockout starting policy

- Five failed password verifications per normalized account identifier within
  15 minutes trigger a 15-minute cooldown. Equivalent login paths share the state.
- Add a separate source-IP/subnet throttle, using the platform's trusted connection
  metadata; attacker-supplied forwarded headers must not reset limits.
- Store counters and timestamps durably in shared storage. Perform checks and
  changes atomically, including concurrent attempts. In-process or browser-only
  counters do not satisfy this policy.
- Do not keep extending an active cooldown on blocked requests. Clear account
  failures after an allowed successful verification; handle concurrent successes
  and failures deliberately. Storage failure must not silently bypass protection.
- Treat unknown and existing identifiers consistently and use generic responses.
  Bound retention and do not log plaintext identifiers, passwords or session data.
- Built-in IP request rate limiting is additional protection; it does not by itself
  implement account failure lockout. Verify the pinned library's atomic storage API.

### Offline and authorization requirements

The current service worker broadly caches successful GET /api responses. Before
adding session/private GETs, restrict caching to explicit public feed paths and
exclude auth/private routes from both writes and offline fallback. Respect no-store,
purge obsolete private entries and test offline logout/account switching.

Derive identity/role from a verified server session. Any private record must be
queried within that user's authorized scope. Hiding buttons or storing a user ID in
the browser is not authorization. Do not cache authenticated pages/data in shared
CDN caches.

## Release checks

Implement and review on a preview branch, with synthetic accounts isolated from
real users. Test actual password verification/session issuance and revocation,
cookie attributes, CSRF/origin and malformed-body rejection, lockout boundaries,
concurrency, enumeration behavior, trusted-IP handling and storage outages.
Test private routes with anonymous and cross-account callers, and test service
worker behavior online/offline. Preserve the existing feed and transport gates.
Publish a reviewable preview before asking to merge; production settings and main
are not approved for an authentication rollout by this plan alone.

References: [Better Auth rate limits](https://better-auth.com/docs/concepts/rate-limit),
[database setup](https://better-auth.com/docs/concepts/database),
[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
