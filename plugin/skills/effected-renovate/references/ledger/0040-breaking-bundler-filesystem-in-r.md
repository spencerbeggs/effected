---
id: "0040"
title: "@effected/bundler's build takes FileSystem and Path from its context"
kind: breaking
shows: typed
applies:
  "@effected/bundler": ">=0.2.0"
detect:
  - "(Bundler|ActionBundle)\\.build\\("
  - "ConfigValidator\\.layer|(Build|Issue)Journal\\.layerAt\\(|BuildJournal\\.record\\("
  - "(writeIssuesArtifact|writeTargetsBinding|removeDeclarationMaps|readTsconfigJsx)\\("
changesets: ["bundler-filesystem-in-r"]
---

This applies only to a repository that calls `@effected/bundler` directly. A repository that builds through `effected package build`, `effected action build` or `@effected/engine`'s `BuildRun` and `ActionRun` needs no change, because the engine already provides both services.

The build's own reads and writes now go through core `FileSystem` and `Path`, which the caller provides. A direct caller that provides neither fails to typecheck: the effect's requirements are not satisfied.

- Where the search matched `Bundler.build(` or `ActionBundle.build(`, provide the host's layers, `NodeServices.layer` from `@effect/platform-node`, or the program's existing platform layer. Use the host's: tsdown, rolldown, API Extractor and the SEA compiler always use the real disk, so a memory filesystem suits only a build whose passes are all replaced through `seams`.
- `ConfigValidator.layer` now requires `FileSystem`, and `BuildJournal.layerAt`, `IssueJournal.layerAt` and `BuildJournal.record` also require `Path`. Provide them the same way.
- `writeIssuesArtifact`, `writeTargetsBinding`, `removeDeclarationMaps` and `readTsconfigJsx` now return an `Effect`. `yield*` them inside a generator instead of using the return value. `removeDeclarationMaps` answers a read-only array.
- Test doubles passed through `seams` keep their promise and sync shapes. Leave them alone, even where they share a name with a function above: a seam key such as `writeTargetsBinding:` is not a call, and the search does not match it.
- A gate that matches on `issues.json`'s `failure` for an IO crash inside the build now sees `PlatformError` or `DescendError` with that error's message, not a Node `Error`. Every output of a successful build is unchanged.

Check the installed `.d.ts` for the exact requirement on each export. Verify with the typecheck, then run a real build and confirm `dist/prod/issues.json` has `buildOk: true`.
