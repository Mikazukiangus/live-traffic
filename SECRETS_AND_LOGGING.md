# Secret scan and safe logging guide

Audited on **19 October 2026 (SGT)** against `main` at `c34987a`.
This report and the examples below contain no actual credential values or fragments.
The original findings below describe that audit baseline. Logging/error safeguards are
now implemented on preview branch `codex/safe-error-logging`; production requires
explicit merge approval. The local file-permission recommendation remains a manual step.

## Scan result

**No confirmed credential leaks were detected in the scanned code or available Git history.**
This is a bounded scan, not proof that a credential has never been exposed elsewhere.

- Fetched all available remote branches and tags. The clone is not shallow:
  90 reachable commits, also 90 when local reflogs are included.
- Ran checksum-verified Gitleaks **8.30.1** with its built-in rules and an additional
  quoted LTA-key literal rule, full redaction, two decoding levels and one archive
  level. Scanned 131 tracked/non-ignored working files, all available history
  (86 commits with patches), and all 90 commit messages/metadata records.
- Built-in rules found no credentials. The LTA rule found two historical candidates
  and one current candidate: an old `.env.example` placeholder and the deliberately
  fake browser-isolation fixture at `tests/config.test.ts:59`. These are false positives.
- Independently checked 452 unique historical text blobs and all commit metadata
  for an exact match to the configured local `LTA_ACCOUNT_KEY`, without printing
  the value. Found no matches, including no matching masked-fragment candidates.
  The existing local `dist/` files also contained no exact match to that key.
- `.env.local` is ignored and untracked. Only `.env.example` is tracked among
  environment files; its credential defaults are empty.
- GitHub reports secret scanning and push protection enabled, with **zero secret
  alerts** at this check. Non-provider pattern scanning is disabled. Provider
  detectors may not recognize proprietary keys, which is why the local exact-key
  comparison and LTA rule were included.

Excluded: hosted build/runtime/Actions logs, chat transcripts, GitHub forks and
cached/deleted remote refs, other clones, credential validity tests and deployed
environment values. Binary model/image assets were not treated as historical
text by the exact-key scan. No production credentials were retrieved or tested.
No credentials were rotated, remote settings changed, or history rewritten.

## Findings at the audit baseline

### 1. API error output can disclose credentials — medium

`api/_client.ts:176` forwards `error.message` to the caller. Its non-success
upstream path also forwards the parsed response body without filtering
(`api/_client.ts:160`). Other handlers use the same raw-message pattern, including
`api/health.ts:46`, `api/imageproxy.ts:93`, `api/trafficimages.ts:132`, weather,
car parks, floods and the speed summary.

Two local checks using a fake credential and mocked fetches reproduced disclosure:

- A thrown provider error containing the fake credential appeared in the 502 JSON.
- A provider's 401 JSON containing the fake credential appeared in the proxied JSON.

These tests made no network requests and used no real key. They demonstrate a
disclosure path, not evidence that a real credential has already leaked.

**Fix:** return fixed public error codes/messages, and log only selected diagnostic
fields. Do not forward an upstream error body, `errorMsg`, stack, cause, request
headers or full URL. Preserve successful camera payloads: their signed image URLs
are needed to load images, but should not be copied into diagnostic logs.

### 2. Development logs and CI summaries relay raw errors — medium

`vite.config.ts:64` logs the original exception and returns its message.
`.github/workflows/health.yml:61` copies endpoint error strings into the Actions
summary, and line 64 collects them for failure annotations. An upstream error can
therefore reach both a response and a public repository's workflow output.

**Fix:** use the same safe error projection in development. In the health workflow,
show the feed name, fixed path, HTTP status and latency; omit provider error text.
Do not enable shell tracing (`set -x`), `curl -v`, environment dumps or full
request/response debugging when secrets are loaded. GitHub masking is an extra
layer, not a replacement for controlling what the app prints.

### 3. The local key file has broad file permissions — low

`.env.local` has mode `0644`. This permits group/other read access when its parent
directories and ACLs allow it. Use owner-only `0600`; see the commands below.
Git ignore rules prevent commits, but do not control local read access or backups.

### Historical observation

The original `api/health.ts:21` in commit `1e0fca4` returned the first and last four
key characters at runtime through `keyMasked`. Commit `fd3aa65` removed it. The
history contains that code, not the actual key or its fragments. Old deployment
logs and old deployments were not inspected in this scan.

## Store credentials safely

### Local development

Run these from the repository root. They do not print or replace the existing key:

```sh
umask 077
if [ ! -e .env.local ]; then cp .env.example .env.local; fi
chmod 600 .env.local
git check-ignore .env.local
```

Edit `.env.local` directly in your editor. Keep `LTA_ACCOUNT_KEY` there and obtain
it from your password manager/provider dashboard. Do not paste it into shell
commands, commits, chat, screenshots or test fixtures. Restart Vite after editing.
Use an encrypted password manager for the durable copy; exclude plaintext env
files from shared folders and unencrypted backups.

Read the key only through `config/server.ts` in server code. Keep all `VITE_*`
variables public: that prefix makes values available to the browser. The existing
browser projection, server-import build guard and value-free configuration
validation are useful protections; retain their tests.

### Vercel

Open [live-traffic environment settings](https://vercel.com/carbon-bc04/live-traffic/settings/environment-variables).

1. Store `LTA_ACCOUNT_KEY` as type **Secret**, scoped to the intended environment.
   Older UI versions call this **Sensitive**; existing Sensitive values are Secrets.
2. Prefer separate provider credentials for Production and non-production where
   the provider supports them. Keep project access limited to people who need it.
3. Save the replacement through the dashboard when rotating; do not reveal or
   retrieve the existing value. Deploy the intended environment after saving:
   existing deployments do not automatically receive updated variables.

Vercel describes the current [Config and Secret types](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types).
Its documented build-log masking covers values of at least 32 characters. The
local LTA key is shorter than that threshold (only its length was checked for
this comparison). Do not rely on platform masking for all keys or for runtime
logs. See [Vercel's build-log redaction notice](https://vercel.com/changelog/build-logs-now-redact-sensitive-environment-variable-values).

### GitHub Actions

Keep `VERCEL_AUTOMATION_BYPASS_SECRET` in repository **Settings → Secrets and
variables → Actions → Secrets**. Keep non-sensitive URLs and timing overrides in
**Variables**. The current workflow already obtains its bypass credential from
`secrets`; keep it out of summaries, artifacts and command tracing. Do not send
secrets to code from untrusted pull requests.

## Implemented logging and error safeguards

`shared/diagnostics.ts` contains the dependency-free implementation:

- `safeFailure` selects fixed public error codes/messages and log fields. It accepts
  only known service labels and validated numeric HTTP codes. Timeout/abort errors
  have a fixed classification. It never reads or serializes an error's message,
  stack, cause, headers, URL, config or response body.
- `UpstreamHttpError` carries only a numeric provider status. DataMall/data.gov.sg
  error bodies and `errorMsg` strings are not retained for diagnostic output.
- `reportFailure` emits one JSON line from the safe projection and returns its
  public body. Node-style and Web Response errors use the same projection and
  `no-store` headers. Successful feed data and required signed camera image URLs
  remain available.

Example integration in a server handler:

```ts
import { reportFailure } from '../shared/diagnostics.ts';
import { sendJson } from './_client.ts';

// Inside catch (error):
return sendJson(res, 502, reportFailure('lta', error));
```

A provider HTTP 500 produces a diagnostic line such as:

```json
{"event":"upstream_failure","service":"lta","code":"UPSTREAM_HTTP_ERROR","upstreamHttpCode":500}
```

The public body contains only fixed text and the numeric status:

```json
{"success":false,"code":"UPSTREAM_HTTP_ERROR","error":"Upstream responded 500"}
```

`server/apiMiddleware.ts` applies the same policy to development and preview
loader/handler exceptions. The browser's health errors and vehicle-count warnings
also omit raw exception details.

`scripts/health-report.ts` validates the health response and writes only static
feed names/paths, status, numeric HTTP codes and latency to Actions summaries and
annotations. Unknown/duplicate/missing feeds and invalid measurements fail closed.
Upstream 429 responses still trigger a retry and then remain warnings; other
failures still fail the job. The bypass header is sent to curl through stdin,
not its process arguments. The workflow does not print its target URL or body.

`tests/diagnostics.test.ts` exercises fake secrets in error messages, stacks,
causes, URLs, headers, upstream JSON/HTML and weather error envelopes; both response
styles; the dev/preview middleware; browser health errors; and the native Node CI
reporter. No real secrets or provider calls are used in these regression tests.

For future diagnostic fields, omit credentials or replace their **whole value**
with `[REDACTED]`. Do not preserve prefixes/suffixes. This includes `AccountKey`,
`Authorization`, cookies, password/token/secret fields, protection-bypass values
and signed URL parameters. The current logger avoids these fields altogether.
Do not add a full config/request/error object to a log call or assume literal
string replacement can catch every token or encoding. This follows
[OWASP's logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude).

## Keep checking

GitHub secret scanning and push protection are already enabled. An additional
local history scan can be run with [Gitleaks](https://github.com/gitleaks/gitleaks):

```sh
brew install gitleaks
gitleaks git --redact=100 --log-opts="--all --reflog --full-history" .
```

Review candidates without posting their values. Keep any scanner reports outside
the repository, owner-readable only; do not upload them as public CI artifacts.
A custom LTA literal rule should require quoted values to avoid mistaking
`getLtaAccountKey()` calls for credentials. Do not exclude all tests or env files
just to silence one intentional fixture.

If a real credential is discovered later, revoke/rotate it first and update the
appropriate local/Vercel/GitHub secret stores. Then assess history cleanup and
cached logs with the repository owner. Rewriting published history requires
coordination and explicit approval; it does not invalidate a stolen credential.
See [GitHub's sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
