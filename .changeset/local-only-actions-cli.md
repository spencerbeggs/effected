---
"@effected/cli": minor
---

## Breaking Changes

`ActionBuildFailedError` gained a required `drift` field. Code that constructs it directly must supply the field (an empty array when there is no drift); code that only catches it is unaffected.

## Features

### `effected action build --check`

`--check` builds the action and compares the result with the committed `dist/` and the persisted action directory, writing nothing. A mismatch exits non-zero and lists each drifting file as `changed`, `missing` or `extra`, in the human report, the GitHub step summary and the JSON output. It is meant for CI to prove committed bundles are current.

These combinations are usage errors (exit 64): `--check --watch`, `--check --no-persist`, `--check` when persisting is disabled in config, and `--no-persist` when `dist = false`. A persist path the bundler refuses (`PersistPathError`) exits 2.

### `effected action init --local`

Scaffolds a local-only action: persisted at the workspace root with `base = "workspace"`, `dist = false`, and a `.gitignore` for the staging directory.

```sh
effected action build --check
effected action init --local
```
