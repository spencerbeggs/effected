---
"@effected/npm": minor
---

## Features

### `NpmRegistry` — registry reads over `HttpClient`

`version` / `versions` / `distTags` / `publishTimes`, each taking a per-call
`RegistryTarget` (`{ registry?, token? }`) so one program can probe two
registries for the same package. A 404 decodes to `Option.none()` rather than
being classified from response text. Test doubles: `NpmRegistry.layerTest`
(unstubbed members die) and `NpmRegistry.layerSeeded` (a working fake keyed by
`registries[registry][name][version]`).

### `PackagePublish` — pack and publish over `@effected/commands`

`setupAuth` / `pack` / `publishTarball` / `dryRun`. The auth token is written
to a caller-supplied `.npmrc` path, never passed as an argv flag. `pack`
reports both an SRI `integrity` digest (compares against the registry) and a
local `sha256Hex` digest (the attestation subject) — the two are not
interchangeable. A failed `dryRun` is a result, not a thrown error.

### `NpmExecutor` — ambient npm or a pinned `dlx`

`NpmExecutor.ambient` or `NpmExecutor.dlx(spec)`, replacing repeated
`packageManager?:` options scattered across call sites. With no launcher
configured it fails typed rather than silently degrading to whatever `npm` is
on `PATH`.

### `RegistryKind` and `PublishError`

`classifyRegistry` sorts a registry URL into `npm | github-packages | jsr |
custom` — subdomain matching requires a leading dot, so a lookalike host is
never mistaken for the real registry. `PublishError` carries `kind: auth |
pack | publish | output | digest | executor`.

## Bug Fixes

`PackagePublish` now extends the parent environment when passing caller
environment variables to a spawned `npm`/`pnpm` process, rather than replacing
it — a hermetic environment previously left the child unable to resolve its
own executable through `PATH`.
