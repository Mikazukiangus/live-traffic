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

## Maintenance and troubleshooting

- Open the GitHub **Checks** run for the exact deployed commit. A PR run checks the proposed merge; production must have a successful run on its own `main` commit. Fix failures through a reviewed change or rerun a genuinely transient failure.
- If a deployment remains waiting, compare the commit SHA and `checks` name in GitHub with Vercel's deployment details. Confirm the workflow triggers on `main`, has not been disabled, and the job was not cancelled. A green Preview does not substitute for the production commit's checks.
- **Force Promote** can bypass Deployment Checks. It is an exceptional release action requiring explicit approval; do not use it to conceal a failed check.
- Use Vercel's existing rollback controls for an approved rollback. Rollback can disable automatic production domain assignment; verify/re-enable the intended release settings before resuming normal deployments. No automatic database migrations or rollback of database state is configured here.
- The separate daily `Production health` workflow remains as configured; its existing optional protection-bypass secret controls whether provider health checks run. Provider outages are not used to make deterministic unit/integration tests flaky.
- This is a release gate, not a claim that GitHub branch protection/rulesets, real-browser testing, live database tests or post-release monitoring were newly configured.

Official references: [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks), [Vercel Git integration](https://vercel.com/docs/git), [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
