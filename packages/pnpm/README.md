# @effected/pnpm

[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

Everything pnpm owns alone: its settings catalog, versioning block, overrides grammar, workspace file editor and lockfile document, over the npm vocabulary it shares.

> **Stability: unstable.** This package is part of the `@effected/*` kit and is
> in `0.x` development; pin an exact version.

## Install

```bash
pnpm add @effected/pnpm effect
```

Requires Node.js >=24.11.0. ESM only.

## Release-age gate

`ReleaseAgeGate` is pnpm's `minimumReleaseAge` (minutes) and `minimumReleaseAgeExclude` (name patterns) as pure vocabulary: `combine` merges contributions from several config sources strictest-age-wins, and `filterVersions` / `isExcluded` drop candidate versions younger than the cutoff against a caller-supplied clock, so a resolver never picks a version pnpm would reject. `matchesExclude` is pnpm's flat-`*` matcher, deliberately not `@effected/glob`'s dialect. `PartialReleaseAgeGate` is the permissive inbound form each source contributes; never clamp one on its own, route it through `combine`.

```ts
import { ReleaseAgeGate } from "@effected/pnpm";

const gate = ReleaseAgeGate.combine({ ageMinutes: 1440 }, { exclude: ["@my-scope/*"] });
console.log(gate.ageMinutes, gate.exclude);
// => 1440 [ '@my-scope/*' ]
```

npm's own `min-release-age` is measured in days with minimatch excludes; it is `@effected/npm`'s `NpmReleaseAge`.

## Pattern lists

`PnpmMatcher.compile(patterns)` compiles a `peerDependencyRules.ignoreMissing` or `allowAny` list into a predicate over package names, with `@pnpm/matcher`'s rules: `*` spans any characters, `/` included; a leading `!` negates; a mixed list is walked in order, so `["*", "!redux"]` excludes `redux` and `["!redux", "*"]` does not; an empty list matches nothing.

## pnpm settings

`PnpmSettings.load({ cwd, env, platform })` reads pnpm's effective settings, the values `pnpm config get <key>` reports, from the sources pnpm 11 and 12 read for a pnpm setting:

1. a `pnpm_config_<name>` or `PNPM_CONFIG_<NAME>` environment variable (highest);
2. the workspace root's `pnpm-workspace.yaml`: the one in the directory `PNPM_CONFIG_WORKSPACE_DIR` / `NPM_CONFIG_WORKSPACE_DIR` names, or else the nearest one at or above the real path of `cwd`, when `cwd` belongs to that workspace;
3. pnpm's global `config.yaml`, in `$XDG_CONFIG_HOME/pnpm`, else `~/Library/Preferences/pnpm` on macOS, `%LOCALAPPDATA%\pnpm\config` on Windows and `~/.config/pnpm` elsewhere (lowest).

A higher source replaces a lower one's value whole, so a workspace `minimumReleaseAgeExclude` list replaces the global one rather than adding to it.

`cwd` belongs to the workspace, as pnpm decides it, when it is the root, when it holds no project manifest (`package.json`, `package.json5` or `package.yaml`), or when it matches the manifest's `packages:` patterns. A manifest with no `packages:` key has the root as its only member, so an example app or fixture with its own `package.json` inside a single-package repo reads no workspace settings, exactly as pnpm skips them. A misnamed manifest (`pnpm-workspace.yml`, `.pnpm-workspace.yaml`) is not a workspace file, and the ascent passes it, as pnpm 12 does.

```ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PnpmSettings } from "@effected/pnpm";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const settings = yield* PnpmSettings.load({ cwd: process.cwd(), env: process.env, platform: process.platform });
  return {
    cutoffMinutes: Option.getOrUndefined(settings.minimumReleaseAge), // number | undefined
    exclude: settings.minimumReleaseAgeExclude, // ReadonlyArray<string>, [] when unset
    strict: settings.getBoolean("minimumReleaseAgeStrict"), // Option<boolean>
  };
}).pipe(Effect.provide(NodeServices.layer));
```

`get(key)` returns a setting's raw value and `origin(key)` says which source it came from; `getString`, `getNumber`, `getBoolean` and `getStringArray` read it as a type. A key is the camelCase name pnpm writes in YAML or the kebab-case one an npmrc uses, and both name the same setting. An environment value is text, read as the type the accessor asks for: canonical digits for `minimumReleaseAge` (`05`, `+5`, `0x10` and `1e2` do not count), a canonical decimal for `getNumber`, exactly `true` or `false` for a boolean, or a JSON array of strings for a list. One that does not read as that type is skipped, so the next source answers, as pnpm 12 skips it. A comma-separated list is not a list. In a file, a boolean setting also reads the words pnpm 12 coerces (`yes`, `y`, `on`, `no`, `n`, `off`, quoted or not, in any case), and an integer setting a quoted digit string. A file value that still has the wrong type answers `None`, because pnpm 12 refuses to load such a file. A `null` in a file is unset.

pnpm 11 and 12 read no pnpm setting from `.npmrc` (only registry and auth keys), from `npm_config_*` variables or from the old global `rc` file, so neither does `PnpmSettings`. For registries and credentials, use `@effected/npm`'s `NpmConfig`. pnpm's built-in defaults are not applied: an unset `minimumReleaseAge` is `None`, which is also what `pnpm config get` reports. Command-line `--config.*` flags are not modelled either. `@effected/workspaces`' `WorkspaceCatalogs.releaseAgeGate()` is a different question: the gate the workspace file and replayed config-dependency hooks declare, with no environment or global layer.

`PnpmSettings.fromSourcesResult({ workspace, global, env })` does the same merge over text you already hold, with no IO. A file that exists but cannot be read, is not YAML, or whose document is not a mapping fails `PnpmSettingsError` (`reason` `"read"`, `"parse"` or `"shape"`). A missing file is skipped.
