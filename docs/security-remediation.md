# Approved security remediation — 29 October 2026

Baseline: `main` at `f13253c633347d239df8cbe54adbafee182b91aa`. The user approved F01–F07 and F09 after the read-only audit. Changes are on `security/audit-20261029`; no main merge, production access, credential rotation or database migration is included. The audit's no-third-party-network restriction still applies; a push, tool download or advisory lookup needs separate authorization.

## Before / after

| Finding | Before | After / evidence |
| --- | --- | --- |
| F01 account throttling | Only IP/path budgets; rotating IPs reset the effective budget | A shared HMAC-keyed account budget reserves at most ten attempts in a fixed 15-minute window using Better Auth's existing unique-key table and atomic adapter increments. Case variants/unknown accounts use the same policy, all attempts count, blocked requests cannot extend cooldown. `tests/auth-security.test.ts` exercises concurrent instances, IP rotation and expiry. |
| F02 logout revocation | A failed session DELETE still returned success and a copied cookie remained valid | A Better Auth before hook performs authoritative deletion and propagates a sanitized failure before logout can report success. Storage-failure/retry regression passes. |
| F03 image buffering | Unbounded upstream `arrayBuffer()`; arbitrary bytes labelled JPEG | Declared and streamed responses are capped at 5 MiB and cancelled when rejected. JPEG markers and acceptable MIME types are checked; official octet-stream JPEGs remain supported. `tests/imageproxy-security.test.ts` covers invalid content, misleading lengths, cancellation and exact valid bytes. Repeated caller-selected policy rejections cannot trip the shared host circuit; ordinary provider outages still count. |
| F04 framing | No application framing restriction | Shared response headers include `frame-ancestors 'none'` and `X-Frame-Options: DENY`; framing/transport regressions pass. Actual deployed headers remain unverified until an authorized deployment check. |
| F05 session lifetime | Sliding expiry could renew indefinitely; GET verification wrote storage | Renewal is disabled, GET reads defer cleanup, and creation age is checked for both legacy and new sessions. Sessions older than 24 hours cannot authorize password changes. The read-only/session-age regression passes. |
| F06 health workflow | Floating action tags, inherited token permissions and retained checkout credentials | Reuses the already reviewed action SHAs from Checks; explicitly grants only contents read and disables credential persistence. All-workflow regression passes. |
| F07 scanning controls | No committed CI/pre-commit scanner or dependency audit gate | Adds a pinned/checksummed Gitleaks installer, Git-history and build scans, staged scanning with full redaction/fixed diagnostics, Bun advisory audit, Dependabot and SECURITY.md. Offline workflow/wrapper/archive tests pass. **Actual Gitleaks and registry audit results remain UNVERIFIED because downloads/network access are not authorized.** |
| F09 env-file access | Local `.env.local` mode 0644 | Mode is 0600; metadata-only checks run in tests, CI and the pre-commit hook. Broad permissions and symlinks fail. No credential contents were read, copied or committed. |

## Regression and verification scope

New auth regressions failed on the baseline, then passed after remediation. The negative image regressions, framing policy, workflow requirements and local permission regression were likewise checked before their fixes. Existing tests were retained; arbitrary-byte camera fixtures were replaced by valid JPEG fixtures with byte/length assertions preserved or strengthened.

TypeScript (`npm run lint`) and the existing transport audit are run for each category commit, followed by the existing suite. Loopback HTTP fixtures require execution outside the filesystem/network sandbox; those requests are local only. Auth tests use in-memory SQLite and synthetic identities, not the Neon database. Provider calls, scanner processes and installer downloads in the new tests are mocks/local fixtures. Installer tests check checksum rejection before binary execution and exact-version enforcement.

The source CLI reports advisory-scanner availability and the TOML/YAML/shell configuration parses locally. These checks do not establish that the real Gitleaks policy has zero findings or that dependencies have no advisories. No external registry, GitHub/Vercel API or production request was made. Existing unrelated untracked files remain untouched.

Final offline result: **368 tests passed, zero failed**; type checking, transport audit, private-env permission check and the production build all passed. The existing suite was rerun after category commits. Local Gitleaks execution, advisory results and hook activation remain pending authorized tool installation. The category commits preserve the existing required `checks` job and Git-based Vercel deployment gate; no additional deployment token or release workflow was introduced.

## Compatibility and rollout

- This branch is for explicit review/merge. Existing auth enablement flags are preserved; no production login is enabled.
- Active/legacy sessions older than 24 hours require another login. The account budget also counts correct sign-ins, so ten sign-ins per account per 15 minutes is the effective cross-IP cap. This is an attempt budget, not progressive failure-only lockout.
- Failed logout now produces a retryable failure instead of claiming revocation. Keep the user's ability to retry; do not display logout success on 503.
- The app can no longer be embedded in an iframe after deployment. Existing camera images, scripts and WASM worker policy are otherwise preserved. General CSP tightening remains deferred; use report-only observation before that separate change.
- The proxy accepts JPEGs only, matching its existing response contract. Oversized, truncated, unsupported or incorrectly labelled non-image responses become safe unavailable states. Validate official live images later under explicit network authorization.
- Gitleaks is a separate development/CI tool, not an application dependency. After local hook activation, missing/wrong-version Gitleaks blocks nonempty code commits. Follow SECURITY.md to install the pinned tool only with authorized network access. Hook configuration is local to this clone; contributors must activate their own hooks.

## Deferred / requires human or network action

- F08 broader CSP/isolation headers, F10 expanded authentication audit events and F11 transparent password parameter upgrades were not in the approved first batch.
- Download/run the pinned scanner, run `bun audit --audit-level=high`, inspect findings by reachability and validate package provenance before claiming these checks pass. Do not publish real values or disable scanner rules to make CI green.
- Authorize a Git push separately; no branch was pushed or deployed during the offline remediation.
- Actual TLS/redirect/certificate state, deployed headers, auth flags, WAF enforcement, GitHub protections/operator MFA, database RLS/grants/encryption/backups, provider signed-URL policies and data retention/export/deletion remain unverified. No cloud setting was changed.
- No compromised real secret was established in the bounded audit. If a future scan confirms one, rotate/revoke first and coordinate consumer updates; removing source alone does not revoke it. See SECURITY.md.

Residual risk remains outside the inspected code and local tests. Review the threat model when enabling private records or privileged roles, then perform an authorized staging penetration test. Consider a vulnerability reporting/bounty program only after operational ownership and reporting procedures are ready.
