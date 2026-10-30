# Security policy

## Reporting

Report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature, if enabled. Otherwise contact the owner through their GitHub profile to arrange a private channel. Do not publish credentials, personal data or working production exploit payloads in an issue. Include the commit, affected route, preconditions, impact and a minimal synthetic reproduction. Current development on `main` is the supported version; do not assume old deployments receive fixes automatically.

## Local checks and CI

- Existing request schemas, auth Origin checks, secure cookie validation and HTTPS policy remain mandatory.
- `npm run lint`, `npm test` and `npm run security:audit` are local code/transport checks. The tests use synthetic accounts, mocked providers and loopback HTTP fixtures. The full suite now includes real scanner canaries, so install the pinned Gitleaks binary on PATH before running `npm test`; those tests make no network requests.
- Gitleaks **8.30.1** is the only additional development tool. It scans staged changes, all fetched Git history and public build artifacts. No application package dependency is added. The custom rules supplement upstream rules for quoted and unquoted proprietary setting literals. Value exceptions match explicit synthetic markers; .gitleaksignore additionally lists seven reviewed historical fixture fingerprints. Neither mechanism exempts whole test directories or future commits. Real generated canaries verify that new test-file credentials are rejected.
- With approved network access, run `sh scripts/install-gitleaks.sh "$HOME/.local/bin"`, ensure that directory is on PATH, then `npm run security:hooks` and `npm run security:secrets`. Check existing Git hook settings before replacing them. Missing/wrong-version scanners and scanner failures block commits after activation. Hook configuration is per clone; repository files alone do not install a hook for other contributors.
- The installer pins the version and verifies the archive against the matching HTTPS release checksum manifest before execution. That verifies integrity against the release manifest; it is not independent publisher attestation. Do not bypass a failed download, checksum or version check.
- Run `bun audit --audit-level=high` only with authorized registry access; it does not apply fixes. CI failures block the required checks job. Dependabot proposes weekly package/action updates; review and merge them explicitly.
- Do not use environment dumps, verbose authenticated HTTP logging, unredacted scanner output or public artifacts containing secret findings. The pre-commit wrapper emits fixed outcomes only.

## Credentials and rotation

Keep private settings in the existing server configuration, a password manager and appropriately scoped Vercel Secrets. Never put private values in `VITE_*`, Git, command arguments, URLs, screenshots or logs. Local private env files must be owner-only (`0600`) and remain ignored; `.env.example` contains empty credentials/placeholders.

`npm run security:env-permissions` checks root private env file metadata on macOS/Linux without reading values; the pre-commit hook and CI run it too. It rejects group/other permissions and symlinks. Use `chmod 600 .env.local` for the normal local file. Windows ACLs require a manual check. No `.env.local` value is copied or committed by this check.

Record a responsible owner, environment, scope and rotation/review date for each credential in your private operational inventory. This repository does not establish provider expiry, IAM permissions or successful rotation.

If a real secret is exposed, treat it as **COMPROMISED**: revoke/rotate it at the provider first, update its consumers, verify recovery and invalidate old deployments/sessions as applicable. Removing the Git line or rewriting history is insufficient. Coordinate any history rewrite separately; it affects forks and clones and does not revoke secrets.

| Credential | Rotation considerations |
| --- | --- |
| LTA AccountKey | Replace it through the authorized provider workflow, update only intended Vercel environments and redeploy. Confirm the new key works before retiring the old key when the provider supports overlap. Do not assume overlap is supported. |
| PostgreSQL credentials | Keep pooled/direct aliases coherent and use least-privileged runtime roles. Coordinate provider rotation, Vercel settings and redeployment; some Neon resets immediately invalidate the old password. Review target/environment before migrations. |
| Better Auth secret | Replace through secret storage and redeploy. This implementation uses one signing key; rotation invalidates existing signed cookies. Planned overlapping-key support needs a separate reviewed library configuration; do not silently accept an old compromised key. |
| Vercel protection bypass / GitHub tokens | Rotate/revoke at the issuing service, replace the intended CI secret and verify the automated check. Keep workflows at read-only permissions and do not print headers. |

No production credential retrieval, rotation, database migration or cloud setting change is authorized by a code-only remediation approval.

## Authentication behavior after the approved remediation

Traffic remains public and authentication follows its existing enablement flags. Sign-in has both the existing shared IP budget and an atomic, HMAC-keyed account budget of ten attempts per fixed 15 minutes. Correct and incorrect attempts both count to reserve capacity before hashing. Blocked attempts do not extend the cooldown; identities are not stored in plaintext counters or logged. This is a bounded attempt budget, not a permanent account disablement or cross-network identification of anonymous visitors.

Logout must complete authoritative server-side revocation before it reports success. Session reads do not refresh/delete rows. Sessions expire no later than 24 hours after creation, including old sliding sessions; users then sign in again. This intentionally changes rolling-session behavior. Expired rows can be cleaned by a separately reviewed maintenance operation; no scheduled production deletion is introduced here.

## Limits of the review

The approved work is on a local security branch until pushed/merged explicitly. Framing is denied, so iframe embedding will stop working after deployment. Image proxy responses must be supported JPEGs within 5 MiB. Broader CSP changes, expanded auth audit events and password-parameter rehashing remain separate findings.

Actual TLS/certificates, database RLS/grants/encryption/backups, WAF publication, operator MFA, GitHub protections, data retention/deletion and provider image policies require their own authorized evidence. Neither a green test run nor a static scan establishes that the deployed system is secure. Revisit the threat model and conduct an authorized staging penetration test before enabling new privileged or private-data features.
