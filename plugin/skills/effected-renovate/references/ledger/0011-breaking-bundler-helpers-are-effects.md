---
id: "0011"
title: "@effected/bundler: the exported build helpers are Effects over FileSystem and Path, and packageJsonEntries takes the manifest"
kind: breaking
shows: typed
applies:
  "@effected/bundler": ">=0.5.0"
detect: ["(buildTargetGroups|buildEmittedManifest|emitManifest|resolveManifest|resolveNextVersions|loadBundleManifestSources|writeGeneratedOgImage|copyPublicDir|copyAmbientDts|packageJsonEntries|resolvePortableTsconfig|buildResolvedTsconfig|writeResolvedTsconfig|writeDtsEmitTsconfig)\\("]
changesets: ["bundler-effect-helpers-and-bundled-closure"]
closes: ["spencerbeggs/effected#1254"]
---

This applies only to code that calls `@effected/bundler`'s helpers directly. A repository that builds through `effected package build`, `effected action build` or `Bundler.build` needs no change: `Bundler.build` and `ActionBundle.build` still require exactly `FileSystem | Path`, and the build seams keep their promise and sync types.

The bundler's own reads and writes now go through core `FileSystem` and `Path`. The exported helpers that did IO changed shape, so the compiler finds every call:

- **A promise or a plain value becomes an `Effect`** requiring `FileSystem | Path`, with a typed error channel: `buildTargetGroups`, `buildEmittedManifest`, `resolveManifest`, `resolveNextVersions`, `loadBundleManifestSources`, `writeGeneratedOgImage`, `resolvePortableTsconfig`, `buildResolvedTsconfig`, `writeResolvedTsconfig`, `writeDtsEmitTsconfig`, `copyPublicDir` and `copyAmbientDts`. `emitManifest` returns an `Effect` of the rolldown plugin rather than the plugin itself.
- **`packageJsonEntries` reads no disk.** `PackageJsonEntriesOptions.pkg` is required and `cwd` is gone: read the manifest first and pass it in.
- **`ResolveManifestError` and `CopyPublicDirError`** are new exported error types.
- **A failing pass** carries a `PlatformError` as its cause, so its message is that error's text where it was a raw Node errno message. Assert on the `PlatformError`, or its `cause.code`, rather than on message text.

At each call the search matched, `yield*` the helper inside an `Effect.gen` that has `NodeServices.layer`, or memfs in a test, provided; handle the new error types by tag; and pass `pkg` to `packageJsonEntries`. Read the installed `.d.ts` for each helper's error channel. Verify with the typecheck.
