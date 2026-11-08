---
"@effected/npm": minor
---

## Breaking Changes

### `NpmRegistryShape` requires `manifest`

The service shape gains a required `manifest` member, so a hand-written implementation or a `Layer.succeed(NpmRegistry, ...)` double stops compiling.

To migrate, add the member. A double that nothing calls `manifest` on can answer `Option.none()`. `NpmRegistry.layer`, `layerSeeded` and `makeSeeded` already carry it, and `makeTest` and `layerTest` die on it when unstubbed, as they do for the other members. Code that only reads the service changes nothing.

## Features

### `NpmRegistry.manifest`

Reads one version's dependency fields through the registry service, so `pnpm view` no longer has to sit beside it. It answers an `Option` of the new `VersionManifest`, with `name`, `version`, `dependencies`, `peerDependencies`, `optionalDependencies`, `peerDependenciesMeta` and `engines`, and routes as `version` does, GitHub Packages included. A seeded version takes the same optional fields.

```ts
import { NpmRegistry } from "@effected/npm";
import { Effect, Option } from "effect";

const peersOf = (name: string, version: string) =>
  Effect.gen(function* () {
    const registry = yield* NpmRegistry;
    const found = yield* registry.manifest(name, version);
    return Option.map(found, (manifest) => manifest.peerDependencies ?? {});
  });
```

A 404 or an absent version is `Option.none()`. A malformed dependency record fails `RegistryReadError` with kind `decode` rather than reading as "no peers", and an `engines` value in the legacy array form is omitted.

### `NpmConfig.load` finds the workspace root's npmrc

Two new options help a tool that runs from a member package, where the default lookup misses the root `.npmrc`. The default lookup is unchanged.

* `workspaceRoot: true` climbs from `cwd` to the nearest directory holding a `pnpm-workspace.yaml` or a `package.json` with a `workspaces` field, and falls back to the default lookup when there is none
* `projectDir` names the directory outright, resolved against `cwd` when relative, and wins over `workspaceRoot`
