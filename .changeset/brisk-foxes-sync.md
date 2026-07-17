---
"@effected/workspaces": minor
---

## Features

### `@effected/workspaces/node-sync` — Node-bound sync entry preset

A new subpath entry ships ready-made `SyncFileSystem` and `SyncPath` operations over `node:fs` / `node:path`, so adopting `findWorkspaceRootSync` / `getWorkspacePackagesSync` is one import instead of four hand-wired one-liners:

```ts
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";

const root = findWorkspaceRootSync(nodeSyncOps);
const packages = root === null ? [] : getWorkspacePackagesSync(root, nodeSyncOps);
```

It's a separate subpath deliberately: the main entry imports nothing platform-shaped, so consumers supplying their own operations (a win32-explicit `path`, a Bun or Deno binding, a test fake) never pull in `node:*` imports.

### Typed `PublishabilityDetectorShape`

The `PublishabilityDetector` service's interface is now exported as `PublishabilityDetectorShape`, for typing a variable, field, or an overriding layer without re-declaring the surface. Its `detect` method's error channel is deliberately `never` — an override backed by something fallible must degrade to a safe answer or die, never silently swallow a failure into a wrong "publishes to npm" answer.

### `PublishConfig.linkDirectory`

`PublishConfig` gains an optional `linkDirectory: boolean` field, meaningful alongside `directory`: it signals whether workspace links should point into the publish subdirectory during local development, so siblings resolve the built artifact they'd install from the registry rather than the package root.
