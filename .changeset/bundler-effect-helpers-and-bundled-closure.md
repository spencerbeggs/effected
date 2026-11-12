---
"@effected/bundler": minor
---

## Breaking Changes

The bundler's helpers now run on Effect's `FileSystem` and `Path` services and fail with typed errors instead of using `node:fs` and returning Promises or plain values. Provide `FileSystem` and `Path` (for example `NodeServices.layer`) where you call them.

* `buildTargetGroups`, `buildEmittedManifest`, `emitManifest`, `resolveManifest`, `resolveNextVersions`, `loadBundleManifestSources`, `writeGeneratedOgImage`, `resolvePortableTsconfig`, `buildResolvedTsconfig`, `writeResolvedTsconfig`, `writeDtsEmitTsconfig`, `copyPublicDir` and `copyAmbientDts` now return Effects requiring `FileSystem | Path`
* `PackageJsonEntriesOptions.pkg` is now required and `cwd` is removed
* New exported error types `ResolveManifestError` and `CopyPublicDirError` describe the typed failures

Migration: replace `await helper(...)` with `Effect.runPromise(helper(...).pipe(Effect.provide(NodeServices.layer)))`, or yield it inside your own Effect program, and pass `pkg` to `PackageJsonEntriesOptions` instead of `cwd`.

## Features

### Bundling a sibling package into a published package

* The emitted manifest drops any package inlined into every partition of the build
* A bare `bundle` name now covers that package's subpaths too
* Each inlined package gets its own `__PACKAGE_VERSION__` stamp
* A `THIRD_PARTY_LICENSES.txt` carries the licence of every inlined package
