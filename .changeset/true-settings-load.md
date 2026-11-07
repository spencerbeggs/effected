---
"@effected/workspaces": minor
---

## Features

### `PnpmSettings`

Reads pnpm's effective settings, the values `pnpm config get <key>` reports, without spawning pnpm. `PnpmSettings.load` reads through `FileSystem` and `Path` and fails with `PnpmSettingsError`, and `PnpmSettings.fromSourcesResult` is the pure form over text.

```ts
import { NodeServices } from "@effect/platform-node";
import { PnpmSettings } from "@effected/workspaces";
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

* Typed reads are `get`, `getString`, `getNumber`, `getBoolean` and `getStringArray`, each answering an `Option`, and `origin` says where a value came from. Keys may be camelCase or kebab-case
* The precedence, highest first, is the `pnpm_config_*` or `PNPM_CONFIG_*` environment variables, the workspace root's `pnpm-workspace.yaml`, then pnpm's global `config.yaml`. A higher source replaces a whole list
* It follows pnpm 11 and 12, where `.npmrc`, `npm_config_*` and the global `rc` file hold no pnpm setting. Registries and credentials stay in `@effected/npm`'s `NpmConfig`
* An unset `minimumReleaseAge` reads as `None`, as `pnpm config get` reports it undefined, so keep any fallback the caller applies
