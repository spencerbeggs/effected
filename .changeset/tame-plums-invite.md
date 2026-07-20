---
"@effected/workspaces": minor
---

## Breaking Changes

### `WorkspacePackage.workspaceRoot` is now a required field

`WorkspacePackage` gains `workspaceRoot: Schema.NonEmptyString`, populated by both minting sites (`WorkspaceDiscovery`'s enumerator and `WorkspacesSync`'s sync entry point). Every construction site of `WorkspacePackage` breaks.

Because `WorkspacePackage` is a `Schema.Class`, code that still builds the old shape does not fail to type-check — it fails to **decode, at runtime**. A `WorkspacePackage` value serialized before this change (persisted to disk, sent over a wire, cached) will fail to decode against the new schema.

The motivation is that discovery already resolves the root before enumerating, and the sync entry point is handed it, so leaving it off `WorkspacePackage` was pure information loss: consumers were reconstructing the root themselves by counting `relativePath` segments and re-ascending that many `..`, which only stays correct while `path` and `relativePath` agree.

**Migration:** pass `workspaceRoot` alongside the package's other fields at every hand-built `WorkspacePackage.make(...)` call site. For values obtained through `WorkspaceDiscovery` or `getWorkspacePackagesSync`, no change is needed — both minting sites already populate the field. Any previously serialized `WorkspacePackage` value must be re-derived by re-running discovery; there is no honest default root to substitute, so decoding fails loudly rather than resolving config against a silently wrong path.

## Features

### Bounded upward ascent: `stopAt` and `maxDepth` on `WorkspaceRoot.find`

`WorkspaceRoot.find` accepts a new `FindWorkspaceRootOptions` second argument, `{ stopAt?: string; maxDepth?: number }`, passed straight through to `@effected/walker`'s `Walker.ascend`. `stopAt` is inclusive — the ceiling directory is itself probed — and is resolved to an absolute path before comparison. An unmarked ceiling now fails typed with `stopAt` recorded on the new optional field on `WorkspaceRootNotFoundError`, distinguishing "no workspace root anywhere above me" from "none below the ceiling I set".

### `WorkspaceRoot.makeTest` / `WorkspaceRoot.layerTest` — a sanctioned test double

```ts
import { WorkspaceRoot } from "@effected/workspaces";

const TestRoot = WorkspaceRoot.layerTest("/repo");
```

Consumers were hand-writing the same four-line `Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed("/repo") })` mock across nine call sites, plus three whole-module `vi.mock`s. `layerTest` honors `stopAt`: a hand-rolled `find` that ignores the ceiling would make a bounded call pass under test and fail live, which is exactly the failure `stopAt` exists to catch. The service contract is also now exported as `WorkspaceRootShape`, so a consumer can type a bespoke double against it instead of re-deriving the shape.
