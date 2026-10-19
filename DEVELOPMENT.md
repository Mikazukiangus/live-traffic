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
