---
"@effected/workspaces": minor
---

## Features

### Test doubles for the three remaining services

`WorkspaceCatalogs`, `WorkspaceSnapshots` and `LockfileReader` gain `makeTest` and `layerTest`, matching `WorkspaceRoot` and `WorkspaceDiscovery`. Every service in the package now ships one, so a consumer extends the double instead of implementing the shape by hand.

```ts
const layer = WorkspaceCatalogs.layerTest({
  set: () => Effect.succeed(catalogSet),
});
```

An unstubbed method dies with a named message rather than returning an empty value — an empty catalog set reads as a legitimate answer and makes every dependency look newly added. Where a method is honestly derivable from a supplied override it derives using the live logic, so a stubbed `set` answers `resolveSpecifier` and a stubbed `read` answers `resolvedVersion`.

## Documentation

* The README covers the `@effected/workspaces/node-sync` subpath and its `nodeSyncOps` preset, so the synchronous escape hatch no longer reads as though the operations must be hand-written
