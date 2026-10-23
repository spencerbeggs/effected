---
"@effected/workspaces": minor
---

## Breaking Changes

### Omitted `cwd` is `"."`

When `cwd` is omitted, `findLayerRoot` and `Workspaces.localExecLayer` pass `"."` to `WorkspaceRoot.find`, resolved through the injected `Path`, instead of `process.cwd()`. Hand-written `WorkspaceRoot` test doubles now receive `"."`, and `WorkspaceRoot.layerTest` reports a resolved `searchPath`.

The `"/"` fallback for hosts without `process` is gone. On such a host an omitted `cwd` is now a defect rather than a typed failure, so pass `cwd` explicitly there.

### Error causes

A package.json syntax failure in `WorkspaceDiscoveryError`, `WorkspaceManifestError`, `CatalogAssemblyError` and the sync `onSkip` report now carries a `PackageJsonSyntaxError` cause. The sync skip message for a manifest that is not an object is now `package.json text is not a JSON object`.

### Environment is read through `Config`

Config-dependency store discovery reads `PNPM_HOME`, `XDG_DATA_HOME` and `LOCALAPPDATA` through `Config`. Effect's default `ConfigProvider` takes one snapshot of `process.env`, so a change to `process.env` while the process runs is no longer seen. Provide a different `ConfigProvider` instead.

### `PeerCheck` judges more rows

Peer ranges written with whitespace after the operator (such as `>= 18`) now parse, so `PeerCheck` judges rows it used to skip and can report new unsatisfied peers.

## Bug Fixes

- A root package.json whose content is `null`, a number or a string is now treated as "not a root" instead of failing with a `TypeError` defect.
