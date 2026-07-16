---
"@effected/workspaces": minor
---

## Breaking Changes

### `CatalogAssemblyError` moved to `@effected/npm`

`CatalogAssemblyError` is no longer exported from `@effected/workspaces`. Import it from `@effected/npm` instead, alongside the `CatalogResolver` contract that names it in its error channel:

```ts
// before
import { CatalogAssemblyError } from "@effected/workspaces";

// after
import { CatalogAssemblyError } from "@effected/npm";
```

`WorkspaceCatalogs.catalogResolver` now passes a failed catalog assembly through **typed** as `CatalogAssemblyError`, rather than folding it into a `DependencyResolutionError` defect `cause`. Code that previously `_tag`-sniffed the defect to tell an assembly failure from a resolution failure should catch `CatalogAssemblyError` directly instead.

### `WorkspacesSync` retrofitted to consumer-supplied operations

`findWorkspaceRootSync` and `getWorkspacePackagesSync` no longer import `node:fs` / `node:path` internally. Each now takes a single options object carrying `fileSystem` and `path` operations the caller supplies — Node's built-ins satisfy them with one-liners:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";

const ops = {
	fileSystem: {
		exists: existsSync,
		readFile: (p: string) => readFileSync(p, "utf8"),
		readDirectory: (p: string) => readdirSync(p),
		isDirectory: (p: string) => statSync(p).isDirectory(),
	},
	path, // node:path IS a SyncPath
};

const root = findWorkspaceRootSync(ops);
const packages = root === null ? [] : getWorkspacePackagesSync(root, ops);
```

`findWorkspaceRootSync`'s optional `cwd` now rides on the options bag rather than a positional argument. This lets the sync entry points run in any host without assuming Node or posix — pass a win32-appropriate `path` (`node:path` on Windows, or `node:path/win32` explicitly) for Windows correctness.

## Features

### One-call resolver factory and manifest resolution

`Workspaces.resolverLayer(options?)` wires both `@effected/npm` contracts (`CatalogResolver`, `WorkspaceResolver`) over a real workspace from just a platform (`FileSystem` + `Path`). `Workspaces.resolveManifest(manifest, options?)` runs `@effected/npm`'s `Manifest#resolve()` over a fresh `resolverLayer` in one call:

```ts
import { Manifest } from "@effected/npm";
import { Workspaces } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const manifest = yield* Manifest.decode({ dependencies: { effect: "catalog:" } });
	const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest) : manifest;
	return resolved.toRecord();
});
```

Each call mints a fresh, unmemoized layer — root discovery (including `process.cwd()`) re-runs every time, which matters for a build tool that changes directory between manifests.

### `WorkspacePackage.manifestRecord`

`WorkspacePackage` gains `manifestRecord`: the package's `package.json` as read, values `unknown`, for tolerant access to fields outside the typed discovery slice (`scripts`, `exports`, …) without a second file read. Defaults to `{}` for construction sites and previously-serialized values that predate the field.
