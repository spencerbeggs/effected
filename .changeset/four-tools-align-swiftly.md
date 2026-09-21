---
"@effected/github-actions": minor
---

## Features

### `ActionInput.literals` for enum-shaped inputs

A `Config<L[number]>` accessor for an input that must be one of a closed set of strings. The match is exact — no trimming, no case folding — and a present value outside the set fails with a `ConfigError` naming the input, the value and the allowed set. Composes with `Config.withDefault` like the other accessors:

```ts
import { ActionInput } from "@effected/github-actions";
import { Config } from "effect";

// Config<"commit" | "pr">
const mode = ActionInput.literals("mode", ["commit", "pr"]).pipe(Config.withDefault("commit"));
```

`ActionInput.schema`'s docs now point at `Config.option` for an optional JSON input.

### `ToolInstallerShape.cachePath`

`cachePath(tool, version)` answers the final tool-cache path a `cacheDir`/`cacheFile` call for `tool@version` will land at, without performing any IO. A caller that must write the final path into a staged tree before the swap — a shim naming its own cached entry — reads this instead of re-deriving the cache root and arch itself. `ToolInstaller.makeTest` provides a default implementation. `PackageManagerInstaller` now asks the installer for the shim destination instead of deriving it a second time, so the `cacheFailed` failure for a diverged cache destination can no longer occur and has been removed.

### `DetachedSpawnOptions.base`

`base` is the environment `spawn` merges `env` over, defaulting to `process.env` as before. Passing it gives a spawned child a fully controlled environment — useful for a test asserting exactly what the child sees, or a worker that must not inherit the action's secrets.

## Bug Fixes

### `Artifact.download`/`unzip` no longer fails extracting into a non-empty directory on Windows

The Windows extraction path now uses the three-argument `ZipFile.ExtractToDirectory(source, destination, $true)` overload, which overwrites existing files, and captures the underlying .NET exception text to stderr on failure. Previously the two-argument overload refused to overwrite and failed with an empty error message.
