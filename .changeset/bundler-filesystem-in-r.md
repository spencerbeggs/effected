---
"@effected/bundler": minor
---

## Breaking Changes

### The build takes `FileSystem` and `Path` from its context

The build's own reads and writes go through core `FileSystem` and `Path`, which the caller now provides. tsdown, rolldown, API Extractor and the SEA compiler still use the host disk, so a real build needs the host's layers. A memory filesystem suits a build whose passes are all replaced through `seams`.

* `Bundler.build` and `ActionBundle.build` require `FileSystem.FileSystem | Path.Path` in `R`
* `ConfigValidator.layer` requires `FileSystem.FileSystem`
* `BuildJournal.layerAt`, `IssueJournal.layerAt` and `BuildJournal.record` also require `Path.Path`
* `writeIssuesArtifact`, `writeTargetsBinding` and `readTsconfigJsx` return an `Effect` instead of a value
* `removeDeclarationMaps` returns an `Effect` of `ReadonlyArray<string>`, failing with `DescendError` or `PlatformError`
* `BundlerSeams` is unchanged, and its members keep their promise and sync types

Every output of a successful build is byte for byte what it was. When an IO step the build owns fails (writing `targets.json`, stripping declaration maps, reading the emitted package), the failure in `issues.json` and the `BundlerError` message now name a `PlatformError` or `DescendError`, with that error's message, instead of a Node `Error`. An export target nested under a file (`./index.js/sub`) is now an `exports-pattern-unmatched` warning, where it used to crash the build.

### Migration

Provide the host's layers where you call the build. Callers that go through `@effected/engine`'s `BuildRun` or `ActionRun` need no change.

```ts
import { NodeServices } from "@effect/platform-node";
import { Bundler } from "@effected/bundler";
import type { BundlerBuildOptions } from "@effected/bundler";
import { Effect } from "effect";

declare const options: BundlerBuildOptions;

const result = Bundler.build(options).pipe(Effect.provide(NodeServices.layer));
```
