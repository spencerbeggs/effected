---
"@effected/workspaces": minor
---

## Breaking Changes

### `findWorkspaceRootSync` takes `cwd` positionally

`findWorkspaceRootSync` changed from a single options bag carrying an
optional `cwd` to a path-first signature, matching the rest of the kit's
sync facades:

```ts
// Before
const root = findWorkspaceRootSync({ ...nodeSyncOps, cwd: process.cwd() });

// After
const root = findWorkspaceRootSync(process.cwd(), nodeSyncOps);
```

`cwd` is now required — the function no longer reads `process.cwd()`
ambiently when it is omitted — and the `FindWorkspaceRootSyncOptions` type
has been removed; pass `WorkspacesSyncOptions` directly. This is a
pre-`0.1.0` change; nothing built on the old signature has been published.

## Features

### `WorkspaceDiscovery.makeTest` / `layerTest` test doubles

Added an in-memory test double of `WorkspaceDiscovery`, with every method
defaulted so a test stubs only what it exercises. Defaults model an empty
workspace; `getPackage`, `importerMap`, and `resolveFile`/`resolveFiles` are
all derived from the effective `listPackages` (the override when one is
supplied), so stubbing just `listPackages` yields a consistent double.
`getPackage` fails with the service's own typed `PackageNotFoundError` on a
miss, exactly as the live implementation does; an unstubbed `info()` call
dies with an explanatory defect rather than fabricating a root path.

```ts
import { WorkspaceDiscovery, WorkspacePackage } from "@effected/workspaces";
import { Effect } from "effect";

const TestDiscovery = WorkspaceDiscovery.layerTest({
	listPackages: () =>
		Effect.succeed([
			WorkspacePackage.make({
				name: "@my-org/utils",
				version: "1.0.0",
				path: "/repo/packages/utils",
				packageJsonPath: "/repo/packages/utils/package.json",
				relativePath: "packages/utils",
			}),
		]),
});
// program.pipe(Effect.provide(TestDiscovery))
```

Bind the result of `layerTest(...)` to a `const` and reuse it — each call
mints a fresh reference, and layers memoize by reference.
