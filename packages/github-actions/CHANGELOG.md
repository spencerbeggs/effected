# @effected/github-actions

## 0.16.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.12.0 | 0.13.0 |

## 0.16.0

### Features

- Upgrades core Effect to `rc-117` [#812][#812]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/glob | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/markdown | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/npm | dependency | updated | 0.15.0 | 0.16.0 |
| @effected/sbom | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/semver | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/templates | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/walker | dependency | updated | 0.11.0 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#812]: https://github.com/spencerbeggs/effected/pull/812

## 0.15.0

### Features

#### `ActionInput.literals` for enum-shaped inputs

- A `Config<L[number]>` accessor for an input that must be one of a closed set of strings. The match is exact — no trimming, no case folding — and a present value outside the set fails with a `ConfigError` naming the input, the value and the allowed set. Composes with `Config.withDefault` like the other accessors:

```ts
import { ActionInput } from "@effected/github-actions";
import { Config } from "effect";

// Config<"commit" | "pr">
const mode = ActionInput.literals("mode", ["commit", "pr"]).pipe(Config.withDefault("commit"));
```

- `ActionInput.schema`'s docs now point at `Config.option` for an optional JSON input.

#### `ToolInstallerShape.cachePath`

- `cachePath(tool, version)` answers the final tool-cache path a `cacheDir`/`cacheFile` call for `tool@version` will land at, without performing any IO. A caller that must write the final path into a staged tree before the swap — a shim naming its own cached entry — reads this instead of re-deriving the cache root and arch itself. `ToolInstaller.makeTest` provides a default implementation. `PackageManagerInstaller` now asks the installer for the shim destination instead of deriving it a second time, so the `cacheFailed` failure for a diverged cache destination can no longer occur and has been removed.

#### `DetachedSpawnOptions.base`

- `base` is the environment `spawn` merges `env` over, defaulting to `process.env` as before. Passing it gives a spawned child a fully controlled environment — useful for a test asserting exactly what the child sees, or a worker that must not inherit the action's secrets.

### Bug Fixes

#### `Artifact.download`/`unzip` no longer fails extracting into a non-empty directory on Windows

- The Windows extraction path now uses the three-argument `ZipFile.ExtractToDirectory(source, destination, $true)` overload, which overwrites existing files, and captures the underlying .NET exception text to stderr on failure. Previously the two-argument overload refused to overwrite and failed with an empty error message.

#### Windows `Artifact.upload` preserves subdirectory structure and honours `compressionLevel`

- The Windows pack drove `Compress-Archive -Path` with individual file paths, which stores every entry under its bare file name — `dir\b.txt` landed as `b.txt`, and same-named files in different directories collided — and expands `[`/`]` as wildcards, so a literal `report[1].txt` failed the upload. It now drives .NET's `ZipFile` directly, naming each entry explicitly from its path relative to `rootDirectory`, so a Windows archive has the same structure as the POSIX `zip -qr` one. `compressionLevel`, previously ignored on Windows, now maps onto .NET's `CompressionLevel` (`0` `NoCompression`, `1..3` `Fastest`, `4..8` `Optimal`, `9` `SmallestSize`). [#805][#805]

#### `CacheKey.matchingFiles` follows symlinked directories, matching the runner's `hashFiles()`

- The `descend` walk now runs with `followSymlinks: true`, so a file reachable only through a symlinked directory contributes to the cache key — `@actions/glob` (the runner's `hashFiles()`) follows links by default (`followSymbolicLinks: true`), and the previously documented knowing divergence silently produced a different key than the runner for such a workspace. `descend`'s per-branch `traversalChain` cycle guard keeps link loops finite, and — as with `@actions/glob` — a link resolving outside the workspace is followed: the "never hash a file outside the workspace" property is lexical (literals climbing above it are dropped), not physical through links. [#781][#781]

### Performance

#### `ToolInstaller.cacheDir` renames the toolchain into the cache

- `cacheDir` now moves its source directory into the tool cache with a rename instead of a recursive copy. On hosted runners `RUNNER_TEMP` and `RUNNER_TOOL_CACHE` share a filesystem, so installing an extracted toolchain is O(1) regardless of its size. A cross-filesystem source (`EXDEV`) falls back to the previous copy; any other rename failure is still reported as `cacheFailed` rather than masked by a copy.

- **Behaviour change:** `cacheDir` now **consumes** `source` — after a successful call the directory no longer exists at its original path (moved, or copied and then removed). Write everything the cached entry must contain into the source before calling `cacheDir`, and read nothing from it afterwards. `PackageManagerInstaller` already followed that ordering; `cacheFile` is unchanged and still copies. [#804][#804]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | dependency | updated | 0.10.0 | 0.11.0 |

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) and [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#781]: https://github.com/spencerbeggs/effected/pull/781

[#804]: https://github.com/spencerbeggs/effected/pull/804

[#805]: https://github.com/spencerbeggs/effected/pull/805

## 0.14.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.116`

- Every package's `effect` peer moves from `4.0.0-rc.115` to `4.0.0-rc.116`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. No `@effected` API changes shape on this advance; the kit itself needed one edit (`Stream.scan` now takes a lazy initial state, met once in `@effected/jsonl`'s `Journal.projection`). A consumer that upgrades meets the rc.116 renames on its own code:

- `SchemaTransformation.make` is `makeTransformation`, and `Transformation#compose` is the dual standalone `SchemaTransformation.composeTransformation`.

- `SchemaGetter.Getter` is a tagged union exposing only `pipe`: `new SchemaGetter.Getter`, `onSome` and `onNone` are gone in favour of `SchemaGetter.map` / `compose` / `run` and `transformEffect` / `transformOptionalEffect`.

- `Stream.scan` and `Stream.scanEffect` take `() => initial`; `Stream.partition` returns `[passes, fails]`; `Stream.mapBoth` takes `onElement` / `onError`.

- `Effect.orElseSucceed` passes the error to its fallback and `Effect.isEffect` narrows to `Effect<unknown, unknown, unknown>`.

- `ByteSize.Input` string literals are checked at compile time; parse external strings with `ByteSize.fromString`.

- Arbitrary shrinking changed, so property-test replay tokens recorded at rc.115 no longer reproduce.

### Documentation

#### The Claude Code and Copilot plugins teach the rc.116 surface

- The `effect-v4-schema` transformation reference composes transformations with `SchemaTransformation.composeTransformation` and describes the `Getter` surface rc.116 left behind; the source-lookup and testing skills report rc.116 as the kit's pin and the two-copy lockfile shape the bridge now produces (`rc.115` for the toolchain, `rc.116` for the kit); the session-start briefing reports rc.116.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.10.2 | 0.11.0 |
| @effected/glob | dependency | updated | 0.6.1 | 0.7.0 |
| @effected/markdown | dependency | updated | 0.10.1 | 0.11.0 |
| @effected/npm | dependency | updated | 0.14.2 | 0.15.0 |
| @effected/sbom | dependency | updated | 0.6.2 | 0.7.0 |
| @effected/semver | dependency | updated | 0.7.1 | 0.8.0 |
| @effected/templates | dependency | updated | 0.6.1 | 0.7.0 |
| @effected/walker | dependency | updated | 0.9.1 | 0.10.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

### Maintenance

#### The rc.115 `packageExtensions` bridge is retired

- The toolchain (`@savvy-web/tsdown-plugins`, `rolldown-pnpm-config`, `@vitest-agent/*`) has republished declaring `effect` and its `@effected/*` inputs as regular dependencies, so the workspace no longer needs the `packageExtensions` block that pinned them by hand. Its ten keys named versions no longer installed and the lockfile diff on removal was the checksum line alone. Nothing published changes; this is the workspace's own install shape. [#792][#792]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#792]: https://github.com/spencerbeggs/effected/pull/792

## 0.13.4

### Documentation

- Verified `PackageManagerInstaller` support for npm 12 (12.0.2) and npm 11 (11.19.1) provisioning, and documented that the installer provisions exactly the pinned version without checking the artifact's `engines.node` against the runner's node — an incompatible pin still installs and runs, with npm itself warning on invocation. [#785][#785]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.14.1 | 0.14.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#785]: https://github.com/spencerbeggs/effected/pull/785

## 0.13.3

### Bug Fixes

- Fixes closure issues in all packages.

#### Runner-file names may no longer carry the parser separators `=` and `<<` or end in `<`

- `isUsableName` now refuses a name containing `=` or `<<`, or ending in `<`, so `ActionOutputs.set` / `exportVariable` / `setJson` fail typed with `InvalidOutputNameError` and `ActionState.save` fails typed with `writeFailed` instead of appending a block the runner would misparse. The runner's file-command parser reads each line up to its first `=` or `<<`, whichever comes first: a name carrying `=` parses as a `key=value` property before the block ever opens, and a name carrying `<<` splits at the wrong delimiter — either way every entry after the malformed block is corrupted. A name ending in `<` corrupts the composed header the same way (`a<` writes `a<<<DELIM`, whose first `<<` matches one character early, leaving a delimiter the terminating line can never match); an interior `<` remains accepted.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.10.1 | 0.10.2 |
| @effected/glob | dependency | updated | 0.6.0 | 0.6.1 |
| @effected/markdown | dependency | updated | 0.10.0 | 0.10.1 |
| @effected/npm | dependency | updated | 0.14.0 | 0.14.1 |
| @effected/sbom | dependency | updated | 0.6.1 | 0.6.2 |
| @effected/semver | dependency | updated | 0.7.0 | 0.7.1 |
| @effected/templates | dependency | updated | 0.6.0 | 0.6.1 |
| @effected/walker | dependency | updated | 0.9.0 | 0.9.1 |

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) and [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.13.2

### Bug Fixes

- `PackageManagerInstaller` now provisions pnpm 12 correctly. pnpm's registry package is a wrapper whose `pnpm` bin is a shebang-less placeholder, replaced at install time by a native binary shipped as an `@pnpm/exe.<os>-<arch>[-musl]` optional dependency. The installer detects that layout from the manifest (never the major version), downloads the host's `@pnpm/exe.*` tarball from the same registry, verifies it fail-closed against the packument's `dist.integrity`, and copies the executable over the placeholder in the cached entry.

- Shims now follow their target: Node scripts run under `node`, executables and shell aliases are exec'd directly.

- A cached entry still holding the placeholder from an earlier install is reinstalled over.

- Previously, pinning pnpm >= 12 failed at first use with `SyntaxError: Invalid or unexpected token`, because Node was handed the shell placeholder instead of the native binary. The error union and `install` signature are unchanged; pnpm 11 and npm/yarn/bun provisioning are unchanged. [#774][#774]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#774]: https://github.com/spencerbeggs/effected/pull/774

## 0.13.1

### Bug Fixes

- `ActionState.save` refuses a key that cannot open a `GITHUB_STATE` heredoc block (one containing a line break) with a typed `writeFailed` error instead of writing a value that corrupts every entry after it — the same guard `ActionOutputs` already enforced.
- `BlobStoreError` with `reason: "refused"` from the GitHub-cache `BlobStore` backend now carries a `detail` field naming the RPC method, matching the cache and artifact errors, which already did. [#758][#758]

### Performance

- `CacheKey.matchingFiles` now walks the workspace with `@effected/walker` instead of enumerating every entry: each include pattern is expanded from its own literal prefix (a literal include costs one `stat`, never a walk), matching only files, with nothing pruned implicitly (parity with the runner's `hashFiles()`). An absent `workspace` still fails typed; an absent literal is a miss, while a literal that exists but cannot be read is a typed `CacheKeyReadError`, and a literal that climbs above the workspace is dropped. One knowing divergence: `descend` never enters a symlinked directory (cycle safety), where `@actions/glob` follows links, so a file reachable only through a symlinked directory no longer contributes to the key.
- `Artifact.upload` and `Artifact.download` each spawn their archiver (`zip`/`unzip` on Linux/macOS, `Compress-Archive`/`ExtractToDirectory` on Windows) once, reading its output and exit code from that single spawn — the same pattern `ActionCache` and `ToolInstaller` already used.
- `ManagedDocument` scans a document's text once per instance instead of re-scanning on every region accessor.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#758]: https://github.com/spencerbeggs/effected/pull/758

## 0.13.0

### Features

- New `ActionOutputs.recording()` test double: every member journals a `RecordedOutput { member, name?, value }` in call order, with `setJson` recording the schema-encoded JSON text — what a later step's `steps.<id>.outputs.<name>` expression would actually read:

```ts
import { ActionOutputs } from "@effected/github-actions";

const { layer, entries } = ActionOutputs.recording();
// provide `layer`, run the program, then:
entries(); // ReadonlyArray<RecordedOutput>, in call order
```

### Bug Fixes

- `ActionOutputs.makeTest` and `layerTest` now always run the typed schema encode on `setJson` before calling any supplied override, so a `setJson` override that ignores `schema` can no longer let a value/schema drift pass silently — it now fails typed with `OutputEncodeError` exactly as the real layer would. A test relying on the old bypass now fails until the override (or the value) is corrected. [#708][#708]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/sbom | dependency | updated | 0.6.0 | 0.6.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#708]: https://github.com/spencerbeggs/effected/pull/708

## 0.12.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.115`

- Every package's `effect` peer moves from `4.0.0-rc.112` to `4.0.0-rc.115`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. This advance is the first whose Effect changes are not source-compatible with the previous pin, so a consumer that upgrades meets the same renames the kit did:

- `SchemaTransformation.transformOrFail` and `SchemaGetter.transformOrFail` are `transformEffect`.

- The `Config` constructors are PascalCase (`Config.String`, `Config.Redacted`, `Config.Int`, `Config.Boolean`, …) and `Config.mapOrFail` is `Config.mapEffect`.

- `FileSystem.Size` and `FileSystem.SizeInput` are gone in favour of the `ByteSize` module: `File.Info.size` is a `ByteSize`, `File.seek` takes a `bigint`, `read`/`write` return a `number`.

- The fast-check bridge (`effect/testing/FastCheck`, `Schema.toArbitrary`, the `fastCheck` property-test option) is removed in favour of `effect/unstable/arbitrary/Arbitrary`; `it.effect.prop` takes `arbitrary: { runs, size, seed, … }`.

#### `@effected/schemastore` documents are open unless told otherwise

- `Schema.ToJsonSchemaOptions.additionalProperties` became `onExcessProperty: "ignore" | "error"` upstream, and its default now mirrors the decoder's: generated object schemas carry `additionalProperties: true` unless `jsonSchema: { onExcessProperty: "error" }` is passed. `StoreDocument.fromSchema` passes the option through unchanged, so a document that was closed by default at rc.112 is open by default now. Pass `onExcessProperty: "error"` to keep a closed document; a generator that silently disagreed with the decoder it is paired with would be the worse default.

#### `@effected/memfs` seeks before the start of a file fail

- `File.seek` gained a `PlatformError` channel upstream, and memfs now matches Node: a seek whose resulting position would be negative fails with `BadArgument` ("Cannot seek before the start of the file") and leaves the cursor unchanged, where it previously stored the negative position and failed on the next read. No memfs-declared type changes; the `File`/`File.Info` shape changes are Effect's own, reaching consumers through the peer.

### Documentation

#### A `Schema.Class` root is annotated on the `Struct` it wraps

- [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084), which the rc.112 notes carried as an open limitation, was closed upstream as by design: annotations passed as `Schema.Class`'s second argument sit on the class node, while the `$defs` entry is generated from the encoded fields `Struct`. Annotate that `Struct` — `Schema.Class<X>("X")(Schema.Struct({ … }).annotate({ title, description, "x-taplo": … }))` — and every key reaches the document. `@effected/schemastore`'s design doc and context files now state the rule instead of the limitation.

#### The Claude Code and Copilot plugins teach the rc.115 surface

- The `effect-v4-schema`, `effect-v4-testing` and `effect-v4-module-index` skills describe the native `Arbitrary` module in place of the fast-check bridge, including the migration traps met on this advance: the `size` clamp (default 10) that silently shrinks a property's string and array domains, the `-0` the generator's near-zero bias emits for an unbounded `Schema.Int` or any `Schema.Number`, which JSON and YAML cannot round-trip, and the absence of `oneof`/`constantFrom`/`array` combinators. `ByteSize` has a module-index row, the `Config` and CLI constructors are shown in their PascalCase spellings, and the session-start briefing reports rc.115 as the kit's pin. [#686][#686]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/glob | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/markdown | dependency | updated | 0.9.2 | 0.10.0 |
| @effected/npm | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/sbom | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/templates | dependency | updated | 0.5.0 | 0.6.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.11.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/glob | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/markdown | dependency | updated | 0.8.1 | 0.9.0 |
| @effected/npm | dependency | updated | 0.12.1 | 0.13.0 |
| @effected/sbom | dependency | updated | 0.4.4 | 0.5.0 |
| @effected/templates | dependency | updated | 0.4.0 | 0.5.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.10.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.7.0 | 0.8.0 |

## 0.10.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.6.3 | 0.7.0 |
| @effected/sbom | dependency | updated | 0.4.2 | 0.4.3 |

## 0.10.0

### Breaking Changes

#### Four error classes split into per-reason tagged unions

- `DetachedProcessError`, `CacheKeyError`, `BlobEnvelopeError` and `ActionOutputError` were each a single `Schema.TaggedError` with a `reason` field. Each is now a **type alias for a union of dedicated error classes**, one per reason — so a value missing a field the reason requires (a pid, a path) is a compile error instead of a message rendering `"undefined"`.

```ts
// before
if (error.reason === "invalidPid") { ... }

// after
if (error._tag === "InvalidPidError") { ... }
```

| Old shape | New members |
| :-- | :-- |
| `DetachedProcessError` | `DetachedLogUnavailableError`, `DetachedSpawnFailedError`, `InvalidPidError`, `DetachedSignalFailedError`, `DetachedNotReadyError` |
| `CacheKeyError` | `CacheKeyReadError`, `CacheKeyBadPatternError` |
| `BlobEnvelopeError` | `NotABlobEnvelopeError`, `TruncatedBlobEnvelopeError`, `UnsupportedBlobEnvelopeVersionError`, `BlobMetadataDecodeError`, `BlobMetadataEncodeError` |
| `ActionOutputError` | `RunnerFileUnavailableError`, `RunnerFileWriteError`, `InvalidOutputNameError`, `OutputEncodeError`, `DetachedOutputError` |

- The union type names (`DetachedProcessError`, `CacheKeyError`, `BlobEnvelopeError`, `ActionOutputError`) are unchanged and still exported, so a signature typed against them keeps compiling — only a narrowing `switch`/`if` on `.reason` needs to move to `._tag`.

#### `Blob<A>` renamed to `StoredBlob<A>`

- `BlobStore`'s stored-value interface is now `StoredBlob<A>`. Update any import or type annotation referencing `Blob`.

#### `ToolInstallerError.subject` is now required

- Previously optional, `subject` is now a required field on `ToolInstallerError` — every construction site must name what failed.

### Features

- `ActionInput.pairs` now rejects a line with an empty key (`=value`, or a bare `=`) unconditionally — an empty key silently produced `{ "": v }`, which could turn into a filter matching nothing with no diagnostic. Pass `{ requireValue: true }` to additionally reject a line with an empty value (`key=`); by default an empty value is still accepted as a legitimate empty string.
- `CacheKey.withNamespace` — prepends a namespace segment (e.g. a cache-bust token) to a key. [#497][#497]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/npm | dependency | updated | 0.11.1 | 0.12.0 |
| @effected/sbom | dependency | updated | 0.4.1 | 0.4.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#497]: https://github.com/spencerbeggs/effected/pull/497

## 0.9.2

### Performance

- `CacheKey.hashFiles` now reads the files it hashes concurrently, bounded at 8 at a time, instead of one after another. Hashing a large pattern set — a lockfile-and-sources cache key, say — no longer serializes on file IO.
  - The digest is unchanged: paths are still sorted and de-duplicated before hashing, and the per-file digests are still folded into the accumulator in sorted order, so a key computed by this version matches one computed by the previous version and by `@actions/glob`'s `hashFiles`. [#409][#409]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#409]: https://github.com/spencerbeggs/effected/pull/409

## 0.9.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.6.1 | 0.7.0 |
| @effected/npm | dependency | updated | 0.10.0 | 0.11.0 |

## 0.9.0

### Features

- ### Region metadata on `ManagedDocument`
  `withRegions` and `withRegionsResult` now accept an optional third element per entry — `name="value"` attributes carried on the region's marker:
  ```ts
  import { ManagedDocument } from "@effected/github-actions";

  const next = doc.withRegionsResult([
    ["header", "## Validating Release", { at: "2026-08-17T00:00:00Z", runId: "12345" }],
    ["footer", "generated by my-action"],
  ]);
  ```
  - New `entry(key)` returns a region's content and metadata together; `regions` now exposes an always-present `meta` field (`{}` when the marker carries none).
  - Two-element entries are unchanged — metadata is purely additive.
  - New `ManagedDocumentError` kind `"invalidAttribute"` for a metadata name or value the marker grammar rejects.
  - Metadata never participates in region addressability: a region is still found by key alone, so changing its metadata updates it in place. Closes effected#285.

  ### `CheckDocument` staleness guard
  A new `stamp` option lets two runs share one document without a delayed re-run clobbering a newer run's regions:
  ```ts
  import { CheckDocument } from "@effected/github-actions";

  const layer = CheckDocument.layer({
    namespace: "my-action",
    key: "release-validation",
    render: (checks) => [
      /* ... */
    ],
    sink: { write: (rendered) => putComment(rendered), read: getComment },
    stamp: { at: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID ?? "" },
  });
  ```
  - `stamp` is a per-run constant; the sink is now `{ write, read? }` — with both `stamp` and a readable `sink.read` set, each pass reconciles against the live document and a strictly-older run's pass is dropped instead of overwriting a newer run's regions.
  - `CheckDocumentStamp.isAtLeastAsRecent` is the exported total ordering (`at`, then `runId`; equal stamps pass, so a run may always refine its own regions).
  - `flush` now resolves to `"written" | "unchanged" | "stale"` instead of `void`.
  - New `CheckDocumentError` kind `"read"`, for a failed live-document read.
  - A dropped pass logs once at the transition (subsequent drops in the same run log at debug). Closes effected#284.

  Depends on `@effected/templates`'s new marker-attribute support underneath. [#397][#397]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/templates | dependency | updated | 0.3.0 | 0.4.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#397]: https://github.com/spencerbeggs/effected/pull/397

## 0.8.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.4.3 | 0.5.0 |
| @effected/glob | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/markdown | dependency | updated | 0.5.2 | 0.6.0 |
| @effected/npm | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/sbom | dependency | updated | 0.3.1 | 0.4.0 |
| @effected/templates | dependency | updated | 0.2.0 | 0.3.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |  |
  | @effect/platform-node | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.7.0

### Features

- ### `Secret.forProcessEnv`
  Declassifies one secret for the caller to bridge into `process.env` — the third-party-SDK case, under its own auditable name, for an SDK that reads only the ambient environment and cannot take a plaintext argument:
  ```ts
  import { Secret } from "@effected/github-actions";

  const plaintext = yield* Secret.forProcessEnv(theToken); // masks first, then returns plaintext
  process.env.SDK_TOKEN = plaintext;
  ```
  ### `Secret.mask`
  Registers a secret with the runner's log filter and returns nothing — the register-only shape for a credential input that must be redacted from logs whether or not it ends up used:
  ```ts
  yield* Secret.mask(suppliedCredential);
  ```
  ### `DetachedProcess.httpProbe` and a test seam for detached workers
  `DetachedProcess.httpProbe(url)` is a readiness probe for `DetachedProcess.awaitReady`: `true` on a 2xx `GET`, `false` on any transport error or non-2xx response (a refused connection is "not up yet", never a probe failure).

  `DetachedProcess`'s operations are now also reachable as `DetachedProcessOps`, injectable via a new `DetachedProcess.makeTestOps` double — production code takes an optional `DetachedProcessOps` parameter defaulting to `DetachedProcess.ops`, and a test passes only the members it means to observe. Unstubbed members die naming themselves rather than silently succeeding. [#366][#366]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.4.1 | 0.4.2 |
| @effected/sbom | dependency | updated | 0.3.0 | 0.3.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#366]: https://github.com/spencerbeggs/effected/pull/366

## 0.6.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.3.0 | 0.4.0 |

## 0.6.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `ActionInput`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.2.3 | 0.3.0 |
| @effected/glob | dependency | updated | 0.2.2 | 0.3.0 |
| @effected/markdown | dependency | updated | 0.4.2 | 0.5.0 |
| @effected/npm | dependency | updated | 0.8.3 | 0.9.0 |
| @effected/sbom | dependency | updated | 0.2.3 | 0.3.0 |
| @effected/templates | dependency | updated | 0.1.1 | 0.2.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.2.2 | 0.2.3 |
| @effected/npm | dependency | updated | 0.8.1 | 0.8.2 |
| @effected/sbom | dependency | updated | 0.2.2 | 0.2.3 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/github | dependency | updated | 0.2.2 | 0.2.3 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 0.5.0

### Features

- ### `ActionEnvironment.makeTest` / `layerTest` accept a webhook payload directly
  A new optional second positional argument serves `payload` to the test double without routing through the filesystem:
  ```ts
  import { ActionEnvironment } from "@effected/github-actions";

  const layer = ActionEnvironment.layerTest(
  	{ GITHUB_EVENT_NAME: "pull_request" },
  	{ pull_request: { number: 42 } },
  );
  ```
  Previously there was no route to a payload through the standard double at all: `layerTest` hard-provides a noop filesystem and `makeTest` captures it at construction, so seeding `GITHUB_EVENT_PATH` through `overrides` sent the read nowhere. Consumers whose action logic is a function of the webhook payload had to drop to hand-composing a filesystem stub at every call site. `undefined` still means "not served" — an unarranged payload read fails typed, naming `GITHUB_EVENT_PATH`.
  ### `ActionLogger.withStep` — a quiet-on-success, verbose-on-failure step wrapper
  ```ts
  import { ActionLogger } from "@effected/github-actions";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const logger = yield* ActionLogger;
  	yield* logger.withStep("publish", publishEffect, { summary: "📦 published" });
  });
  ```
  Runs a named step quietly on success — exactly one info line, default `✅ <name>`, overridable via `options.summary` — and on failure emits a `❌ <name>` header followed by the full buffered transcript. `withBuffer({ onSuccess: "discard" })` alone cannot express this: it leaves a green step with zero lines. The new `WithStepOptions` type is exported alongside it.

### Documentation

- `ActionInput.string` — an input whose contract is "set it empty to disable this" cannot be read via `Config.withDefault`; empty is classified missing before the default is consulted. Use `Config.option` instead.
- `ActionInput.provider` / `providerOver` / `layerDefault` — never compose a bare `ConfigProvider.fromEnv` beneath them. It uppercases the config path, so input-name keys never match and reads silently fall back to their default while the test suite stays green.
- `GitHubMarkdown` — a render cannot fail, so wrapping it in `Effect.try` is unnecessary. The one reachable throw is `tableFor`'s row codec, for a value smuggled past the types — not the serializer. [#255][#255]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#255]: https://github.com/spencerbeggs/effected/pull/255

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/glob | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/markdown | dependency | updated | 0.4.1 | 0.4.2 |
| @effected/npm | dependency | updated | 0.8.0 | 0.8.1 |
| @effected/sbom | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/templates | dependency | updated | 0.1.0 | 0.1.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.0

### Features

- ### `GitHubContext.headRef` and `branch`
  `GitHubContext` now carries `headRef`, the pull request's source branch as an
  `Option<string>`. `GITHUB_HEAD_REF` is only set for `pull_request` events, and
  on every other event the runner may write it as the **empty string** rather
  than omitting it — both spellings of absence now decode to `Option.none()`,
  so a consumer can't build a cache key segment out of an empty branch name by
  accident.

  The new `branch` getter owns the fallback chain every consumer used to
  hand-roll: `headRef` when present (a pull request, where `refName` is the
  useless `123/merge`), otherwise `refName`.
  ```ts
  import { GitHubContext } from "@effected/github-actions";

  const branch = context.branch; // headRef, or refName when absent
  ```
  ### `CacheKey.digest`
  `CacheKey.digest(input, length = 8)` is a segment-safe short digest for
  **non-file** key inputs — a sorted version list, a branch name — replacing
  the by-hand SHA-256-and-truncate every compound key used to repeat. The
  result is lowercase hex, guaranteed nonempty and free of the characters the
  restore-key protocol reserves, so it drops straight into `CacheKey.of` with
  nothing to check at the call site. A `length` outside `1..64` throws a
  `RangeError` rather than silently answering fewer characters than asked for.
  ```ts
  import { CacheKey } from "@effected/github-actions";

  const key = CacheKey.of(
  	"Linux",
  	CacheKey.digest("node:24.4.0,pnpm:10.13.1"),
  	CacheKey.digest("feat/my-branch"),
  );
  ```
  ### `ChildEnv`
  A new zero-import module for building the environment additions a spawned
  child process needs to see prepended `PATH` entries, without the three traps
  that cost a cross-OS matrix round each: `prependPath(dirs, { base, platform })`
  answers `{ env, extendEnv: true }` as one value (a bare `env` silently
  replaces the child's whole environment), writes through the inherited `PATH`
  key's own casing (Windows spells it `Path`), and appends nothing for an
  absent inherited value. `needsShell(platform)` reports the win32 rule for
  `.cmd` shims required since CVE-2024-27980.
  ````ts
  import { ChildEnv } from "@effected/github-actions";
  import { ChildProcess } from "effect/unstable/process";

  const command = ChildProcess.make("pnpm", ["install"], {
  	...ChildEnv.prependPath(["/opt/hostedtoolcache/pnpm/10.13.1/x64/bin"], {
  		base: process.env,
  		platform: process.platform,
  	}),
  	...(ChildEnv.needsShell(process.platform) ? { shell: true } : {}),
  });
  ``` [#219](https://github.com/spencerbeggs/effected/pull/219) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.7.0 | 0.8.0 |

## 0.3.0

### Features

- ### `PackageManagerInstaller`
  A new service that provisions an exact npm, pnpm, yarn or bun version on a runner from a corepack pin (`@effected/npm`'s `PackageManagerPin`):
  ```ts
  import { ActionOutputs, PackageManagerInstaller } from "@effected/github-actions";
  import { PackageManagerPin } from "@effected/npm";
  import { Effect } from "effect";

  const provision = Effect.gen(function* () {
    const installer = yield* PackageManagerInstaller;
    const outputs = yield* ActionOutputs;
    const pin = yield* PackageManagerPin.parse("pnpm@10.13.1");
    const installed = yield* installer.install(pin);
    if (installed.source === "tool-cache") {
      yield* outputs.addPath(installed.binDir);
    }
  });
  ```
  It checks the tool cache first, then — for npm — the runner's own ambient `npm --version` (every Node toolchain ships one), and only then downloads the manager's own distribution: npm/pnpm/yarn 1.x from their registry tarballs, yarn 2+ from `@yarnpkg/cli-dist`, bun from its per-platform GitHub release. A pin carrying integrity is verified fail-closed; `install`'s `options` support `requireIntegrity`, a custom `registry`, and `allowAmbient: false` for runs that replace the runner's Node (and its bundled npm) entirely.

  The result is `AmbientPackageManager | CachedPackageManager` (the `InstalledPackageManager` union), discriminated by `source`. A `tool-cache` result carries an `addPath`-able `binDir` — executable shims for the npm-registry managers, bun's own directory for bun.
  ### Detached-worker-safe outputs: `ActionOutputs.layerDetached`
  A new layer for code that spawns a detached background worker. A worker's stdout is a log file no runner parses, so the ordinary outputs layer would either silently do nothing (`setSecret`) or write plaintext straight into the log. Under `layerDetached`: `setSecret` is a documented no-op, `set`/`setJson`/`exportVariable`/`addPath`/`summary` fail typed (`ActionOutputError` with `reason: "detached"`), and `setFailed` degrades to a plain log line. Mask secrets in the **parent**, before the spawn, with `Secret.forChildEnv`.
  ### `ToolInstaller.provisionFile`
  A new convenience method that packages the single-binary provisioning flow — `find` → `download` → chmod → `cacheFile` — as one call, for tools distributed as a bare executable (biome, and most Rust/Go tools). Also new: `ToolInstallerShape.download` takes an optional `{ timeout }` (default five minutes) so a stalled connection fails typed instead of hanging until the job's own timeout.
  ### `CacheKey` restore-key ladders
  `CacheKey.withRestoreDepths(...)` lets a key carry an explicit restore-key ladder — each depth is the number of leading segments a fallback rung keeps — for keys where the default every-prefix ladder would produce a rung that drops a segment (like a version digest) that must never be dropped alone. `CacheKey.withoutRestoreKeys()` is the exact-match-only policy: zero rungs, no fallback at all. `ActionCache.restore` picks either policy up automatically through the typed key.
  ### `ActionInput` input-name test keys
  `ActionInput.provider`/`layer` now dual-accept plain input names (`with:`-block style, e.g. `{ "biome-version": "2.3.14" }`) alongside the existing `INPUT_`-spelled runner-variable keys, so a test can key its environment by input name without hand-mangling it (a hand-written `INPUT_BIOME_VERSION` for an input named `biome-version` reads as absent, since the runner keeps the dash). `ActionInput.variable(name)` exports the same derivation for the rare case a test must spell the variable directly.

### Bug Fixes

- `ActionCache.save` now resolves its `paths` as glob patterns (matching `actions/cache`'s own resolution) before archiving; previously a glob pattern was handed to `tar` verbatim and failed on a real runner with a "Cannot stat" error.
- `ActionState.save` now proves at save time that a schema's encoded form survives the `JSON.stringify`/`parse` round trip the state file requires, failing typed (`reason: "notPlainJson"`) instead of leaving a `malformed` failure for a later phase to discover with no pointer back to the cause. [#215][#215]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/markdown | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/npm | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/sbom | dependency | updated | 0.2.0 | 0.2.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/npm | dependency | added | — | 0.6.0 | [#215][#215] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.2.0

### Features

- ### Sigstore identity token adapter for Actions
  `ActionsIdentityToken.layer` implements `@effected/sbom`'s `IdentityToken`
  contract over this package's `OidcTokenIssuer`, so an action can sign
  attestations without either package depending on the other:
  ```ts
  import { ActionsIdentityToken, OidcTokenIssuer } from "@effected/github-actions";
  import { SigstoreSigner } from "@effected/sbom";
  import { Layer } from "effect";

  const signing = SigstoreSigner.layer.pipe(
    Layer.provide(ActionsIdentityToken.layer),
    Layer.provide(OidcTokenIssuer.layer),
  );
  ```
  ### Discardable log buffers
  `ActionLogger.withBuffer` takes a new options argument,
  `{ onSuccess: "flush" | "discard" }`, defaulting to `"flush"`. A step that
  should stay quiet on a clean run passes `{ onSuccess: "discard" }`; a
  failure, defect or interruption always flushes the transcript regardless of
  the setting.
  ```ts
  yield* logger.withBuffer("install", installEffect, { onSuccess: "discard" });
  ```
  ### GitHub-surfaces markdown suite
  A new set of services for building and maintaining GitHub-rendered
  documents — PR comments, PR descriptions, check-run summaries:
  - **`CheckState`** — a check-lifecycle vocabulary (`running`, `pass`, `fail`,
    `warn`, `user_interaction_required`, `skipped`, `timeout`) wider than
    GitHub's own check-run conclusions, with `projectCheckState` mapping it onto
    GitHub's wire vocabulary.
  - **`ManagedDocument`** — marker-delimited named regions inside text a human
    may also edit, built on `@effected/templates`' section engine. Regions are
    replaced from current state, never appended, so re-rendering the same state
    is idempotent.
  - **`GitHubMarkdown`** — a fluent, escaping-safe markdown writer for GitHub
    surfaces (tables, headings, links, code, lists, `<details>` blocks), plus
    `tableFor(schema, options?)`: a GFM table whose columns are defined once by
    a row schema — headers from `title` annotations with field-name fallback,
    column order from field declaration order, cells encoded through each
    field's own codec, and a per-column `format` that the types require exactly
    where a field's encoded side is not a string. The only module in this
    package that imports `@effected/markdown`.
  - **`CheckDocument`** — an in-process reconciler that turns a stream of
    `report` calls into a debounced (trailing, 500ms quiet / 3s max-wait),
    byte-identical-render-skips-the-write update to a managed document:

  ```ts
  import { CheckDocument, CheckReport, GitHubMarkdown } from "@effected/github-actions";

  const layer = CheckDocument.layer({
    namespace: "my-action",
    key: "release-validation",
    render: (checks) => [
      ["header", GitHubMarkdown.table(["Check", "Outcome"], [...checks].map(([key, c]) => [key, c.outcome ?? c.state]))],
    ],
    sink: (rendered) => Effect.log(rendered),
  });
  ```
  This package adds `@effected/templates`, `@effected/markdown` and
  `@effected/sbom` as workspace dependencies.
  ### SLSA provenance capture from OIDC claims
  `ActionsProvenance.capture(audience?)` reads the runner's OIDC claims and
  `GITHUB_SERVER_URL` and returns a `SlsaProvenance`, replacing an eleven-field
  snake-case-to-camelCase rename every attesting consumer previously wrote by
  hand — a hazardous mapping where transposing the repository and owner ids
  compiles clean and produces a validly signed wrong attestation:
  ```ts
  import { ActionsProvenance } from "@effected/github-actions";

  const provenance = yield* ActionsProvenance.capture();
  ```
  The typed `OidcTokenError` passes through untouched, so skip-versus-mandatory
  attestation stays the caller's decision. A missing `GITHUB_SERVER_URL`
  defaults to `https://github.com` rather than failing — only GHES runners set
  it.

### Documentation

- `Secret.forSigning`'s TSDoc now scopes what it's for: any in-process use that
  needs a secret's raw value without writing it to a runner file, not only
  signing — the dividing line is where the value goes, not what it's for. [#191][#191]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/markdown | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/sbom | dependency | updated | 0.1.0 | 0.2.0 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/markdown | dependency | added | — | 0.3.0 |  |
  | @effected/sbom | dependency | added | — | 0.1.0 |  |
  | @effected/templates | dependency | added | — | 0.1.0 | [#191][#191] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

- First release. The GitHub Actions runtime — the services an action needs to
  talk to the runner it is executing inside. The one package in the kit with
  `@effect/platform-node` as a required peer, because a GitHub Action always
  runs as a Node process on a GitHub-provided runner.
  ### `Action.run` — the default runtime
  ```ts
  import { Action, ActionCache } from "@effected/github-actions";

  // The default runtime covers inputs, outputs, state, logging and HTTP.
  // Cache/Artifact/BlobStore are opt-in — they are the only modules that reach
  // Azure, so pulling one in costs exactly one line:
  Action.run(program, { layer: ActionCache.layer });
  ```
  `ActionRuntime.layer` installs an input-aware `ConfigProvider`, so a bare
  `Config.string("dry-run")` resolves correctly instead of silently taking a
  default. `ActionInput` owns the `INPUT_` name mangling and the absence
  contract: a missing input and an input set to `""` are both treated as
  missing data.
  ### Inputs, outputs, state, logging
  `ActionInput`, `ActionOutputs`, `ActionState`, `ActionLogger` (mapping
  `Effect.log*` onto workflow commands and structured annotations),
  `ActionEnvironment` (`GitHubContext` / `RunnerContext`), and `WorkflowCommand`
  for the raw runner protocol.
  ### Cache, artifacts and the blob store
  `ActionCache`, `Artifact`, `BlobStore` / `GitHubCacheBlobStore`, and
  `CacheKey.hashFiles` implement the Actions cache and artifact protocols
  directly over HTTP — no `@actions/*` dependency. `Secret` is the only place a
  secret ever becomes a plain string (declassification and masking are the same
  call).
  ### Auth, OIDC and process control
  `GitHubToken` bridges an installation token from `@effected/github` into the
  runner; `OidcTokenIssuer` reads the runner's OIDC claims; `ToolInstaller`
  downloads and stages a tool atomically into the tool cache; `DetachedProcess`
  manages a spawned child that must outlive the current step. [#180][#180]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
