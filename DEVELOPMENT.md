# Local development

TrafficPulse is a React/TypeScript application. Bun installs its app dependencies
in this project's `node_modules/`, using the committed `bun.lock`.

## Run the app

```sh
cd /Users/admin/Projects/TrafficPulse
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3100>. The Python environment below is optional when running
the app.

To add an app package, use `bun add package-name`, or `bun add --dev package-name`
for a development dependency. Commit both `package.json` and `bun.lock` when adding
app packages.

## Activate the Python environment

The local `.venv/` environment was created with Python 3.12.14 for helper scripts.
Activate it in each terminal where you want to use Python packages:

```sh
cd /Users/admin/Projects/TrafficPulse
source .venv/bin/activate
python --version
python -m pip --version
```

The pip location should be inside this project's `.venv/`. Activation applies to
the current terminal and processes started from it.

## Install Python packages

Use the activated environment's Python to install packages. For example, if you
need the PDF helper package:

```sh
python -m pip install pypdf
python -m pip list
```

`pypdf` is an optional example; no extra Python packages are required by the
current `scripts/build-basemap.py`, which uses Python's standard library.

To save installed package versions for reuse:

```sh
python -m pip freeze > requirements.txt
```

Install those versions in another activated environment with:

```sh
python -m pip install -r requirements.txt
```

To leave the environment:

```sh
deactivate
```

You can also use it without activation:

```sh
.venv/bin/python -m pip list
```

## Recreate the environment

Virtual environments are local to their machine. If the folder or its base
Python installation changes, recreate it using your installed Python:

```sh
python3 -m venv .venv
source .venv/bin/activate
```

For this checkout, the original base interpreter is Codex's bundled Python at
`/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`.

`.venv/`, `node_modules/`, and `.env.local` are ignored by Git. Keep the LTA key in
`.env.local` for the app's server-side handlers; activating Python does not load
that file automatically.

## Environment configuration

All supported settings and validation live in `config/schema.ts`:

- Server handlers import the frozen `config` from `config/server.ts`.
- Browser code imports the public projection from `config/client.ts`. It contains
  no credentials or server configuration. Vite rejects imports of the server entry
  point into the browser build.
- Vite, the map-generation helper and the production-health workflow use the same
  schema. The Python helper asks Bun for only its non-secret Overpass settings.
- `.env.example` is generated from that schema with `bun run config:example`.
  Defaults preserve the app's existing behavior; blank LTA keys allow keyless
  camera/weather operation. Set `LTA_ACCOUNT_KEY` to enable the other LTA feeds.

On a fresh clone, create the private override file only if it does not exist:

```sh
if [ ! -e .env.local ]; then cp .env.example .env.local; fi
```

This checkout already has `.env.local`. Add or change selected overrides there;
keep its existing LTA key. Shell/platform values take precedence over Vite's env
files. Stop and restart the development process after changing settings.

`VITE_*` settings are public and baked into the browser build. Rebuild/redeploy
for their changes to take effect. Never put a secret under that prefix. Unknown
public settings, invalid URLs, unsupported booleans and out-of-range numbers fail
validation with setting names and no supplied values. Empty optional settings use
safe defaults. `LTA_API_KEY` remains a legacy alias; `LTA_ACCOUNT_KEY` wins.

Examples of optional overrides:

```dotenv
DEV_HOST=127.0.0.1
DEV_PORT=3100
VITE_CAMERA_POLL_MS=45000
VITE_VEHICLE_COUNTING_ENABLED=false
```

Configure Vercel settings in the intended Development/Preview/Production scope.
Keep `LTA_ACCOUNT_KEY` server-only and sensitive. No additional Vercel variables
are required to preserve current behavior.

The scheduled health workflow reads `VITE_SITE_URL`, `PRODUCTION_HEALTH_URL`,
`HEALTHCHECK_RETRY_DELAY_MS` and `HEALTHCHECK_TIMEOUT_MS` from GitHub Actions
repository **variables**, and `VERCEL_AUTOMATION_BYPASS_SECRET` from repository
**secrets**. The bypass secret is never app configuration. The workflow's 07:30
SGT schedule remains a versioned workflow setting.

See `CONFIGURATION_AUDIT.md` for scope and settings deliberately kept in code.
