---
"@effected/github-actions": minor
---

## Features

### `PackageManagerInstaller`

A new service that provisions an exact npm, pnpm, yarn or bun version on a runner from a corepack pin (`@effected/npm`'s `PackageManagerPin`):

```ts
import { ActionOutputs, PackageManagerInstaller } from "@effected/github-actions";
import { PackageManagerPin } from "@effected/npm";
import { Effect } from "effect";

const provision = Effect.gen(function* () {
  const installer = yield* PackageManagerInstaller;
  const outputs = yield* ActionOutputs;
  const pin = yield* PackageManagerPin.parse("pnpm@10.13.1");
  const installed = yield* installer.install(pin);
  if (installed.source === "tool-cache") {
    yield* outputs.addPath(installed.binDir);
  }
});
```

It checks the tool cache first, then — for npm — the runner's own ambient `npm --version` (every Node toolchain ships one), and only then downloads the manager's own distribution: npm/pnpm/yarn 1.x from their registry tarballs, yarn 2+ from `@yarnpkg/cli-dist`, bun from its per-platform GitHub release. A pin carrying integrity is verified fail-closed; `install`'s `options` support `requireIntegrity`, a custom `registry`, and `allowAmbient: false` for runs that replace the runner's Node (and its bundled npm) entirely.

The result is `AmbientPackageManager | CachedPackageManager` (the `InstalledPackageManager` union), discriminated by `source`. A `tool-cache` result carries an `addPath`-able `binDir` — executable shims for the npm-registry managers, bun's own directory for bun.

### Detached-worker-safe outputs: `ActionOutputs.layerDetached`

A new layer for code that spawns a detached background worker. A worker's stdout is a log file no runner parses, so the ordinary outputs layer would either silently do nothing (`setSecret`) or write plaintext straight into the log. Under `layerDetached`: `setSecret` is a documented no-op, `set`/`setJson`/`exportVariable`/`addPath`/`summary` fail typed (`ActionOutputError` with `reason: "detached"`), and `setFailed` degrades to a plain log line. Mask secrets in the **parent**, before the spawn, with `Secret.forChildEnv`.

### `ToolInstaller.provisionFile`

A new convenience method that packages the single-binary provisioning flow — `find` → `download` → chmod → `cacheFile` — as one call, for tools distributed as a bare executable (biome, and most Rust/Go tools). Also new: `ToolInstallerShape.download` takes an optional `{ timeout }` (default five minutes) so a stalled connection fails typed instead of hanging until the job's own timeout.

### `CacheKey` restore-key ladders

`CacheKey.withRestoreDepths(...)` lets a key carry an explicit restore-key ladder — each depth is the number of leading segments a fallback rung keeps — for keys where the default every-prefix ladder would produce a rung that drops a segment (like a version digest) that must never be dropped alone. `CacheKey.withoutRestoreKeys()` is the exact-match-only policy: zero rungs, no fallback at all. `ActionCache.restore` picks either policy up automatically through the typed key.

### `ActionInput` input-name test keys

`ActionInput.provider`/`layer` now dual-accept plain input names (`with:`-block style, e.g. `{ "biome-version": "2.3.14" }`) alongside the existing `INPUT_`-spelled runner-variable keys, so a test can key its environment by input name without hand-mangling it (a hand-written `INPUT_BIOME_VERSION` for an input named `biome-version` reads as absent, since the runner keeps the dash). `ActionInput.variable(name)` exports the same derivation for the rare case a test must spell the variable directly.

## Bug Fixes

* `ActionCache.save` now resolves its `paths` as glob patterns (matching `actions/cache`'s own resolution) before archiving; previously a glob pattern was handed to `tar` verbatim and failed on a real runner with a "Cannot stat" error.
* `ActionState.save` now proves at save time that a schema's encoded form survives the `JSON.stringify`/`parse` round trip the state file requires, failing typed (`reason: "notPlainJson"`) instead of leaving a `malformed` failure for a later phase to discover with no pointer back to the cause.
