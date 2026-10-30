# CI/CD: GitHub checks and Vercel deployments

TrafficPulse uses its existing GitHub → Vercel integration for `carbon-bc04/live-traffic`. Vercel builds Git commits; the required GitHub `checks` job gates production promotion. No additional deployment token, deploy hook, environment export or paid service is needed.

## Release flow

1. Open/update a pull request targeting `main`. GitHub runs `.github/workflows/checks.yml`; Vercel creates its usual Preview.
2. The `checks` job installs the committed Bun lockfile, checks TypeScript, audits HTTPS/cookie policy, runs all unit/integration tests with coverage and builds the application. Any failed step fails the job. Available coverage reports are retained for seven days.
3. Review the Preview and explicitly approve the merge. This pipeline does not merge pull requests or remove the project's human merge approval requirement.
4. A push/merge to `main` starts a fresh `checks` run for the production commit and a Vercel production build. Vercel's **Deployment Checks → GitHub → checks → Production: Blocking** holds production domain assignment until the required check passes. A failed build/check does not replace the previous production release.
5. Once both the Vercel build and required GitHub check succeed, Vercel automatically assigns the production domains. No routine manual promotion is needed. Normal Preview builds are not held by this production-only check.

Keep the job ID/name **`checks`** stable and unique across workflows: the Vercel gate refers to that name. Rename it only together with the saved Deployment Check. Do not add path filters or conditional skips to this required job without revisiting release behavior.

The workflow runs once per PR revision and on pushes to `main`, avoiding competing push/PR check runs on the same revision. Superseded runs for the same PR/branch are cancelled. Checkout does not retain Git credentials; the workflow has `contents: read`, and actions are pinned to verified upstream commits. Provider/database/application secrets are not supplied to the synthetic test job.

## Installed settings and verification — 29 October 2026

The existing project/team IDs were verified through authenticated Vercel tools. The dashboard was then used because the connected MCP tools do not expose Deployment Check configuration. Added the existing `checks` job from default-branch commit `99b77ee`; the saved UI shows GitHub, Production and **Blocking**, with the notice that it takes effect on the next production deployment.

Production environment readback confirms branch tracking is `main` and **Auto-assign Custom Production Domains** remains enabled. PR #33 was explicitly approved and merged on 29 October 2026 as `93078e80bd490cf30583504e3068c26c7f18565c`, activating the tested workflow and coverage suite on `main`.

The updated workflow ran successfully on implementation commit `844f47c808b2ecf55d16c1f8b214c51ec2cddc7a`: [Actions run 40787978659](https://github.com/Mikazukiangus/live-traffic/actions/runs/40787978659), one required `checks` job, 344 passing tests with zero failures, type check, transport audit, coverage upload and build. [Preview](https://live-traffic-qnp6a4741-carbon-bc04.vercel.app) deployment `dpl_2EjUYDj3Qwsxve52Erc6ruXD1x9C` is READY for the same SHA. The [coverage artifact](https://github.com/Mikazukiangus/live-traffic/actions/runs/40787978659/artifacts/12860037735) has the configured seven-day retention.

The production merge passed [Checks run 40789246625](https://github.com/Mikazukiangus/live-traffic/actions/runs/40789246625): all 344 tests, type check, transport audit, artifact upload and build. Production deployment `dpl_DPWzhLGczuH7oFgZQkMVLfuwfzRn` reached READY and canonical-domain readback resolves to the exact merge SHA. Homepage and its actual module entry returned HTTP 200 through authenticated access. No manual/force promotion was used. This verifies the automatic main release path; the intermediate waiting state and a deliberately failing production check were not exercised. Test/build/tooling changed, while application runtime remained unchanged.

## Current confirmation — 29 October 2026

The pipeline is already active; no second deployment workflow is required. A fresh dashboard reload confirms the GitHub `checks` requirement still applies to Production with **Blocking** behavior. The source workflow/Vercel configuration is unchanged from approved PR #33.

After PR #34 expanded the suite to 351 tests, the latest released main revision `f93d9d366aa5a8e0c5905ebd97e4742a5d25dcdf` passed [Checks run 40815747920](https://github.com/Mikazukiangus/live-traffic/actions/runs/40815747920), including install, type check, transport audit, tests/coverage, artifact upload and build. Canonical production readback identifies READY deployment `dpl_JBspWAvscQm5M93szJ1hKzEKqXpf` for that exact revision. This confirmation makes no new platform/configuration change or manual promotion.

## Maintenance and troubleshooting

- Open the GitHub **Checks** run for the exact deployed commit. A PR run checks the proposed merge; production must have a successful run on its own `main` commit. Fix failures through a reviewed change or rerun a genuinely transient failure.
- If a deployment remains waiting, compare the commit SHA and `checks` name in GitHub with Vercel's deployment details. Confirm the workflow triggers on `main`, has not been disabled, and the job was not cancelled. A green Preview does not substitute for the production commit's checks.
- **Force Promote** can bypass Deployment Checks. It is an exceptional release action requiring explicit approval; do not use it to conceal a failed check.
- Use Vercel's existing rollback controls for an approved rollback. Rollback can disable automatic production domain assignment; verify/re-enable the intended release settings before resuming normal deployments. No automatic database migrations or rollback of database state is configured here.
- The separate daily `Production health` workflow remains as configured; its existing optional protection-bypass secret controls whether provider health checks run. Provider outages are not used to make deterministic unit/integration tests flaky.
- This is a release gate, not a claim that GitHub branch protection/rulesets, real-browser testing, live database tests or post-release monitoring were newly configured.

Official references: [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks), [Vercel Git integration](https://vercel.com/docs/git), [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Approved action upgrades — 30 October 2026

The user approved and merged Dependabot PRs #36/#37/#38. Checks and health now
use checkout 7.0.1 and setup-node 7.1.0; coverage upload uses upload-artifact 7.0.2.
All references remain full immutable SHAs. Exact-head PR CI passed with the existing
Node 24 hosted runner, frozen Bun install, secret/advisory scans, tests and build.
Artifact upload retains its default archive behavior and seven-day retention.
Read-only token permissions, non-persistent credentials and the existing blocking
production check remain unchanged. Turn 185 records merge/main/deployment results.
This upgrade changes CI tooling only; application packages and runtime are unchanged.

Final combined main `96b749fd4134550dfa2b9ff2085b05628e1f8d49` passed
[Checks 40997435934](https://github.com/Mikazukiangus/live-traffic/actions/runs/40997435934)
with 392 passing tests, no failures/skips, all security checks, successful coverage
archive upload and build. Production `dpl_38ULFUWAXFMFayJ7LJgH7ovYRuZj` is READY
and the canonical homepage returns 200. The following log/comment update uses the
same CI/deployment gate and changes no application source.
