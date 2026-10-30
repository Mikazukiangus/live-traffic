# Login and authenticated rate limits

## Status and scope

The user explicitly resumed login on 24 October 2026 to enable per-user rate limits.
Implementation was merged from `codex/public-api-rate-limits` in PR #28 on
25 October 2026 as `b34bc20c1870ad8e78ccc739d400cf0f98bba896`; production login
remains disabled. Starting defaults announced while product choices were pending are:
administrator-created accounts and optional sign-in. Traffic stays public. Public
signup, email delivery, social login and cloud commute sync are not enabled.

The free Neon resource `trafficpulse-auth-preview` (`store_MPzLJypjannI261q`) is in
Singapore and connected only to Preview after the 28 October Secret repair. The five authentication tables
have been migrated. A real PostgreSQL synthetic user passed password verification,
secure-cookie issuance, session reads through an independent auth instance and
logout revocation, then its account/session/user rows were removed. No real account
has been created automatically. Production requires a separate reviewed database
and secret before enabling login.

## Boundaries and modules

- `server/auth/service.ts`: maintained Better Auth 1.7.12, 24-hour opaque sessions,
  authoritative database verification, no cookie cache, and database-backed auth
  throttles. `database.ts` supplies a bounded pool, verified TLS and five-second
  connection/query/statement timeouts. Operator migrations use the direct URL;
  application traffic uses the pooled URL.
- `server/auth/request.ts`: route/method whitelist, exact origins, cross-site POST
  rejection, JSON-only bodies capped at 4096 bytes under a read deadline, and bounded
  credentials. Callback URLs, roles, IDs and unknown fields are rejected. IPs come
  from platform-overwritten metadata or a real local socket, never untrusted forwarding.
- `server/auth/handler.ts`: an application facade around library handlers. It strips
  tokens, raw sessions and internal errors from JSON, preserving only the required
  user DTO and validated response cookies. Unknown/wrong credentials have the same
  public response. Server exceptions/SQL/URLs/credentials are not logged.
- `server/auth/respond.ts`: host-only, root-path HttpOnly/Lax cookies with mandatory
  Secure/secure prefix on deployments. Auth replies are private/no-store at browser,
  generic CDN and Vercel CDN layers. The transport audit has exact reviewed operations
  for this module; arbitrary additional cookie writes still fail the gate.
- `proxy.ts` and `server/auth/userAdmission.ts`: platform Routing Middleware verifies
  an authoritative session and charges its hashed account bucket **before CDN lookup**.
  Changing IP/route/query does not change a user's bucket. Anonymous/revoked sessions
  still receive IP protection. An unavailable verifier or limiter fails closed in
  enforce mode. Observe records outcomes but does not block; off does no SDK check.
- Existing origin admission still protects IPs before provider work; it deliberately
  does not repeat user admission after middleware. Existing public feed payloads stay
  identical and may be shared in the CDN after per-request admission. No account ID,
  session, or caller-specific remaining quota is injected into cacheable replies.

Passwords use native Argon2id v19: 64 MiB, three iterations, one lane, random salt,
32-byte output; length 12–128 for enrollment/change. Cookies contain credentials;
application JSON/localStorage/logs do not. Sessions are revocable in shared storage.
Authentication attempts use Better Auth's v1.7 atomic conditional database counters,
not instance memory: five sign-in/password-change attempts per IP per 15 minutes;
other auth routes default to 30/minute. These are attempt budgets, not a per-account
failed-password lockout. The library's X-Retry-After is validated and mapped to standard
Retry-After. Mutating authentication requests are never automatically retried.

Optional sign-in means someone can sign out and make anonymous requests, subject
to IP limits. A per-account quota applies to requests presenting that verified
account's session; it is not a claim of identifying anonymous people across networks.
The WAF/SDK fixed-window counters are regional and use the same 300/minute threshold
to fit Hobby's one-rule allowance. See `api-rate-limiting.md` for native publication.

## API and function budget

`/api/auth/:authPath` rewrites to the existing `/api/live` function with `feed=auth`.
The auth dispatcher runs before the public GET/OPTIONS feed schema, then applies its
own strict contract. There is no extra auth API function. The Node platform proxy counts toward Hobby’s function budget. The first build
exceeded twelve functions; the 24-hour forecast now shares the live gateway via
a public /api/forecast24h rewrite. Eleven API functions plus the proxy fit twelve.
Public forecast URL, schema, pagination and cache semantics are preserved; actual
deployed verification passed in the checks below.

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/auth/ok` | GET | Configured backend response, not a full provider/DB probe |
| `/api/auth/session` | POST `{}` | Sanitized own-session lookup |
| `/api/auth/sign-in` | POST | `{email,password}` |
| `/api/auth/sign-out` | POST `{}` | Revoke current session and clear cookies |
| `/api/auth/change-password` | POST | `{currentPassword,newPassword}`, revoke other sessions |

All POSTs require JSON and an exact trusted Origin. Public `/sign-up`, admin, OAuth,
redirect, arbitrary profile mutation and password-reset paths are not exposed.
Session lookup deliberately uses POST: an older installed worker cannot intercept
and persist it as a successful GET. The updated worker also treats all auth URLs as
network-only. Account credentials/DTOs are never placed in offline caches. Existing
public feed offline fallback stays available and honestly labelled.

The lazy account UI adds sign-in, sign-out and password change with labelled inputs,
password-manager autocomplete, pending/cooldown handling, a keyboard focus trap,
Escape/close support and safe React text rendering. Mobile appearance/install
controls move into the menu when login is enabled to preserve header space.
Commutes remain on the device; signing in does not sync or privatize old local data.

## Configuration

All fields are in the validated schema and generated `.env.example`:

| Setting | Meaning |
| --- | --- |
| `AUTH_ENABLED` | Server login backend; false by default |
| `VITE_AUTH_ENABLED` | Optional UI; true requires server backend configuration |
| `DATABASE_URL` | Private pooled Neon connection |
| `DATABASE_URL_UNPOOLED` | Private direct connection for operator migrations |
| `BETTER_AUTH_SECRET` | Private random signing secret, at least 32 characters |
| `BETTER_AUTH_URL` | Exact optional origin; preview derives from trusted platform metadata |
| `API_RATE_LIMIT_MODE` | off / observe / enforce for SDK admission |

Preview branch-only variables enable the backend/UI and set SDK admission to observe.
The signing secret is stored as a Vercel Secret for this branch. Exact platform
deployment/branch hostnames are trusted, never arbitrary request Host or a wildcard.
Production AUTH/UI defaults stay false. Do not enable production using preview data.

## Operator commands

The repaired bootstrap integrated from PR #29 no longer retrieves Vercel
variable values. Preview Secrets are write-only and Development linkage was
removed by the approved 28 October repair. Obtain the matching pooled/direct credentials
through authorized access to the existing Neon resource; supply them through a
trusted process environment or hidden terminal prompts. Never put connection URLs
in command arguments, shell history, chat, source or logs. Existing local LTA settings
are not read or overwritten. The root Vercel project link is still validated.

```sh
# Human operator: URL prompts are hidden and held only in this process.
node --import tsx scripts/auth-with-database.ts smoke --prompt
node --import tsx scripts/auth-with-database.ts create-user --prompt
node --import tsx scripts/auth-with-database.ts preview-smoke --prompt https://live-traffic-jn540di4y-carbon-bc04.vercel.app
# Migration only when a reviewed schema change actually requires it:
node --import tsx scripts/auth-with-database.ts migrate --prompt
```

With DATABASE_URL and DATABASE_URL_UNPOOLED already injected by an authorized secret
manager/provider process, omit `--prompt`. The helper neither loads an env file nor
exports one, never calls Vercel env APIs and does not read back Preview Secrets.
It rejects the old variable-ID syntax, mismatched pooled/direct credentials, unsafe
URLs, production environment scope and credential-bearing command arguments. The
above preview URL is a historical example; choose the current READY auth-enabled
Preview after the credential rotation, because old deployments retain old values.
Default local development can keep login disabled; no new local database/service
is automatically provisioned. Run enrollment in a human TTY as described below.

`create-user` requires a human TTY. It prompts for name/email and a twice-entered
hidden password. No password is accepted as a command argument or printed; public
signup remains disabled. Arrange credential delivery yourself through your approved
secure channel. New accounts can change their password in Account. No email is sent
by this implementation. Operator access is privileged and must remain restricted.

`auth:migrate` can also run with the required direct connection already injected
into a trusted process. It rejects unsafe generated migrations and creates the
account identity/session expiry/rate-limit cleanup indexes. Never run it against
production without reviewing its migration plan and database target.

## Operational limitations and incident cleanup

Automatic review rejected exporting an entire development environment to a file.
The later database-only in-memory helper was explicitly approved by the user and
successfully migrated/tested the isolated resource. Do not use whole-environment
export as a workaround.

During setup, the documented CLI `env run` unexpectedly treated a script path as a
deployment, creating the separate `auth-migrate` project. It did not run the migration.
That project was paused immediately, then deleted after explicit user approval;
the project API now returns 404 for its verified ID. Generated nested linkage was
removed and the root link still points to live-traffic. The migration source had
no embedded credentials; the deployment reported Vercel Authentication protection.
No credential exposure investigation beyond these facts is claimed. **Do not use
`env run` for this project's bootstrap**; use the narrow helper above.

Local verification: 299 Node tests, type checking, transport audit, normal build,
and a build with authentication enabled passed. Twelve new groups exercise actual
authentication with isolated SQLite, hashes/salts, cookies, concurrent shared-DB
attempt budgets, revoked sessions, CSRF/input errors, safe DTOs, pre-cache account
limits, forged identities, client requests and worker privacy. Real PostgreSQL
migration/login/logout passed separately. Deployment and interactive-browser
verification are separate gates; no UI/browser pass or production activation is
implied by these tests.


## Deployed verification, 25 October 2026

Implementation 82722783525e6c808d35053cbd0326397af7b573 reached READY at
https://live-traffic-2qdjsodg1-carbon-bc04.vercel.app. Both GitHub Checks succeeded
(40109894515, 40109890929); required job diagnostics confirm 299 passing tests,
zero failures/skips, type checking, audit and build. Public auth rewrite /ok
returns 200 with private/no-store headers. A protected CLI-only synthetic test
passed anonymous session, real password sign-in, Secure cookie, session read,
an API admission path, logout and rejection of the revoked session. Exact test
account/session/user rows were removed. Passwords/cookies remained in process
memory/stdin, with no real account or browser interaction.

Successful observe admission emits one fixed RATE_LIMIT_ALLOWED diagnostic per
warm proxy instance per minute, containing no identity/address/credential. This
makes SDK readiness distinguishable from silent skipping; enforcement omits success
noise. A permitted response in observe mode alone does not prove the limiter worked.
Turn 157 below supersedes the earlier pending-publication state.


Final runtime source 5a4d5cdfd8de4c32f180374f19100a6a7ed0f385 is READY:
https://live-traffic-et2v7hq8q-carbon-bc04.vercel.app
(deployment dpl_GkcsBFaEzWS9WuUUjXf3hFo6jZ2y). Both Checks runs
40110167552 and 40110164229 passed; required job diagnostics confirm all 299 tests.
Repeated deployed synthetic login/session/logout passed and cleaned its rows.
The targeted runtime diagnostic records RATE_LIMIT_ALLOWED from the pre-cache
proxy after the verified session and SDK check, establishing actual check readiness
in observe mode. This does not establish threshold rejection. The homepage and
rewritten /api/forecast24h?limit=1 both returned 200; the latter returned one period.
A scoped ten-minute error/fatal count query returned no groups, not a service-wide
health guarantee. Interactive UI execution remains unverified.

On 25 October the user explicitly authorized CLI publication. Turn 157 published
active Firewall v2: Preview only, 300 requests/60s/IP, HTTP 429 on excess, no pending
draft. A bounded 305-request invalid-input probe produced 300 HTTP 400 and five
HTTP 429 without provider calls. The next-window request returned HTTP 400 again; exact-rule aggregate traffic
confirms five rate-limit events. Details are in `api-rate-limiting.md`.
The SDK still observes; account-threshold exhaustion/enforce mode and production
rollout remain separate. The source merge is approved/completed in Turn 158;
production login/SDK enforcement were not enabled.


## Main release, 25 October 2026

The user explicitly approved merging PR #28. Final head
`ef04a8a38b284639f78ead4cac0b0f188e8cfa56` passed both CI runs with all 299 tests
and no failures/skips, type checking, audit and build. Merged with an expected-head
guard as `b34bc20c1870ad8e78ccc739d400cf0f98bba896`. Production deployment
`dpl_6TiXaeNmkzD3Giu2UozyfdvURPHs` is READY and canonical-host readback resolves
to this exact merge. Homepage, referenced entry bundle and paged forecast return
200. The intended /api/auth/ok response is 503 AUTH_NOT_CONFIGURED and private/no-store.

Only source was released: Preview auth/secret/observe settings and the isolated
database were not copied to production. Production login remains disabled and SDK
mode defaults off. Native Firewall v2 still enforces Preview only. Production
feature activation/SDK enforce/native-rule expansion need their own rollout; the
merge alone does not turn them on. No real account or production DB was provisioned.
Separate draft PR #23 remains outside this merge.


## Config warnings repaired, 28 October 2026

**Completed:** the human confirmed rotation, the resource was reconnected to
live-traffic Preview with Secret storage, and the project’s Needs Attention filter
now has no matching variables. All sixteen provider-generated variables are Secret
(`sensitive`) and Preview-only. Resource/database/data were preserved. No Production
or Development DB connection remains; LTA, signing secret and branch feature gates
retain their existing IDs/scopes.

The repaired connection is spc_Jk6p9HDGGBWtTXAv on the existing store_MPzLJypjannI261q.
The connector applies Sensitive to all its aliases, including host/user/database/ID
metadata; this is harmless and avoids a split source of truth. The original warning
concerned eight credential URL/password aliases saved as readable Config. It did not
establish compromise or an outage.

The [documented integration procedure](https://vercel.com/docs/environment-variables/sensitive-environment-variables#sensitive-environment-variables-for-integrations)
was followed: disconnect, human resource-secret rotation, reconnect Preview only
with makeEnvVarsSensitive=true, then redeploy. Generic Development Secrets are
supported, but integration connections containing Development cannot enable Sensitive.
CLI connect has no Sensitive flag; the supported connection API does.

The auth-enabled Preview was rebuilt through Vercel MCP from the existing
codex/public-api-rate-limits source ef04a8a38b284639f78ead4cac0b0f188e8cfa56 using
current settings. Replacement deployment dpl_3oKi2DbnL8jE9WX86zuyjugYDMj2 is READY:
https://live-traffic-jn540di4y-carbon-bc04.vercel.app. Vercel’s API target staging
represents Preview; no production feature was enabled.

Protected auth checks passed: anonymous session 200, synthetic unknown-account
sign-in 401/AUTH_REJECTED after the database lookup, anonymous sign-out 200, all
private/no-store. This checks the new connection credentials and expected error
behavior; it is not a repeated successful account sign-in/revocation test or an
explicit old-password rejection test. No real account or credential readback was
needed. Previous full auth-flow evidence remains in earlier dated sections.

[Rotation invalidates old credentials](https://vercel.com/kb/guide/how-to-reset-a-secret-for-a-neon-integration).
Old immutable Preview deployments retain old environment values; use the replacement
Preview above. Redeploy other historical branches if their auth is needed. Rollback
cannot revive a revoked password. No local env file was read or overwritten.

### Local/operator access and PR #29

The prepared operator replacement is in [draft PR #29](https://github.com/Mikazukiangus/live-traffic/pull/29),
not yet merged to main. On the repair branch it uses authorized provider/process
credentials or hidden TTY prompts, as shown above. It never reads Vercel env values
or exports an environment. Supply matching pooled/direct credentials through your
approved provider workflow; do not attempt to retrieve write-only Preview Secrets.
Local traffic development may leave auth disabled. No new local DB was provisioned.

Five new credential-boundary regression groups plus the full suite pass: 304 tests,
no failures/skips, type checking, transport audit and build, both locally and in CI
at operator source 8e344e69a99cde9f0a71ac8f5b130fa4316e5793. That branch’s separate
build Preview has auth disabled by default; the replacement auth-enabled deployment
above is the connectivity evidence. Source merge remains a separate approval.
The external Secret repair is complete and does not depend on that merge.

## Approved integration — 30 October 2026

The user approved #29 alongside #23 and the security audit. The combined source
retains hidden prompts/authorized process inputs and the newer safe structured logger.
Synthetic operator URL fixtures were constructed with URL objects so the active
secret guard needs no new exception. No database command, credential retrieval,
rotation or auth/Firewall enablement accompanies this source merge. Turn 184 records
final checks and main release status. The 28 October preview evidence above remains
historical, not a new live database verification.
