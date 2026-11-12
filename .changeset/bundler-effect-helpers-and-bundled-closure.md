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
* A `bundle` entry now covers its subpaths too: a bare name, and a glob such as `@effected/*`, whose matches would otherwise have been pruned from the manifest while their subpath imports stayed external
* Each inlined package gets its own `__PACKAGE_VERSION__` stamp, from the nearest `package.json` that carries a name; a nested `{"type":"module"}` marker no longer hides its owner
* A `THIRD_PARTY_LICENSES.txt` carries the licence of every inlined package, at the group root as well, so it also names what an `outSubdir` partition inlined
* Loose-file passes get the same subpath coverage, version stamping and licence collection as the entry passes
