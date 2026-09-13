# @effected/walker

## 0.9.0

### Breaking Changes

#### `descend`'s `onUnreadable: "record"` overload now carries the cause of each unreadable directory

- `DescendResult.unreadable` was `ReadonlyArray<string>`. It is now `ReadonlyArray<UnreadableDirectory>`, where `UnreadableDirectory` is `{ path: string; cause: PlatformError.PlatformError }` — the `readDirectory` failure the walk absorbed now travels with the entry, so a caller reporting why a directory was unreadable no longer needs a second syscall.

- Migrate a path-based check to match on the new shape's `path` field:

```ts
// before
if (result.unreadable.includes("")) { ... }

// after
if (result.unreadable.some((u) => u.path === "")) { ... }
```

- The walk base still records as `path: ""` when it is itself unreadable, and a `NotFound` mid-walk is still never recorded — both unchanged from before.

### Features

- New export `UnreadableDirectory`.

- Closes #648. [#693][#693]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#693]: https://github.com/spencerbeggs/effected/pull/693

## 0.8.0

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
| @effected/glob | dependency | updated | 0.5.0 | 0.6.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.7.0

### Features

#### `descend` gains an `onUnreadable: "record"` mode

- `descend` accepts a new `onUnreadable: "record"` option, resolving to a `DescendResult` — the matched file paths plus the `cwd`-relative path of every mid-walk directory whose `readDirectory` failed for a reason other than `NotFound` — instead of failing the whole walk (`"fail"`, the default) or silently discarding the unreadable directory (`"skip"`). The walk base itself is reported as the empty string `""` when it is the unreadable directory (#629).

```ts
const result = yield* descend(pattern, { cwd, onUnreadable: "record" });
// result.matches, result.unreadable
```

- Existing calls are unaffected: `descend` is now overloaded, and every call without `onUnreadable: "record"` still resolves to the plain match array it always did.

- The two modes are discriminated by two separate options types rather than by a literal, and `DescendRecordOptions` is exported alongside `DescendOptions` for that reason. `"record"` is deliberately not a member of `DescendOptions`: if it were, a value widened to that type — annotated as such, or passed through a function taking it — would select the array-returning overload at compile time while the walk resolved a `DescendResult` at runtime, and every array method on that result would fail with no type error anywhere. The same narrowing applies to `CompileAndExpandOptions`, which extends it, so `compileAndExpand` cannot be handed `"record"` under its array contract either. [#654][#654]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#654]: https://github.com/spencerbeggs/effected/pull/654

## 0.6.0

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
| @effected/glob | dependency | updated | 0.4.0 | 0.5.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.3.0 | 0.4.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.2.2 | 0.3.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.3.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.2.1 | 0.2.2 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.3

### Refactoring

- `Walker` is now a static class with a private constructor rather than an
  `as const` namespace object. Call syntax is unchanged (`Walker.ascend(...)`);
  each member's TSDoc now ships in the built `.d.ts`, where an `as const`
  object's inferred member types previously dropped it. [#180][#180]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.2.0 | 0.2.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.3.1

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.3.0

### Features

- ### `compileAndExpand`: compile a glob pattern and expand it against the filesystem, in one call
  ```ts
  import { compileAndExpand } from "@effected/walker";
  import { GlobPatternOptions } from "@effected/glob";

  const files = yield* compileAndExpand("packages/*/src/**/*.ts", {
  	cwd: "/repo",
  	glob: GlobPatternOptions.make({ dot: true }),
  });
  ```
  New `compileAndExpand(pattern, options)` returns `Effect<ReadonlyArray<string>, GlobExpansionError, FileSystem | Path>`, matching FILE paths relative to `options.cwd`. No package previously owned the "compile a pattern and expand it against the filesystem" seam, so a downstream consumer had written four differently-shaped variants of this recipe and ended up with two divergent `dot` semantics inside one package.

  The new `GlobExpansionError` is the single typed failure for the whole recipe: its `cause` is a discriminated union of `GlobPatternError | DescendError`, with a derived `stage` getter (`"compile" | "descend"`) for callers that only need the phase. `CompileAndExpandOptions` extends `DescendOptions` with one addition — `glob`, the options the pattern compiles under — and that field is **deliberately required**, so every call site states its own matching dialect instead of one site silently defaulting and drifting from another.

### Bug Fixes

- ### `Walker.ascend` normalizes `stopAt` before comparing, so an unnormalized ceiling no longer fails open
  `stopAt` matched the ceiling by raw string equality, so a ceiling that named a real ancestor in any form other than its exact resolved spelling matched nothing and the ascent ran silently past it to the filesystem root — the unbounded walk the option exists to prevent. There was no error and no warning; from the call site the bounded walk simply looked like it worked.

  `ascend` now compares each directory's `Path.resolve` form against the resolved ceiling. A trailing separator (`/repo/`), a `.` or `..` segment (`/repo/packages/..`) and a duplicated separator all stop where they name. Normalization is idempotent, so callers already resolving at the call site — `@effected/workspaces`' `WorkspaceRoot.find` does — are unaffected.

  Two points of the contract are unchanged and now pinned by tests: `stopAt` is still **inclusive**, and normalization governs the **comparison only** — the returned chain is still the lexical one derived from `start`, unrewritten, so `ascend` through a symlinked start still follows the path it was given.
  ### A relative `stopAt` is now rejected instead of resolved against the working directory
  `Walker.ascend` requires an **absolute** `stopAt` and rejects a relative one. Pass an absolute path:
  ```ts
  // Before: silently resolved against process.cwd()
  yield* Walker.ascend(start, { stopAt: "packages" });

  // Now: resolve at the call site, where the intended base is known
  yield* Walker.ascend(start, { stopAt: path.resolve("packages") });
  ```
  A cwd-relative ceiling has no fixed meaning: the same `stopAt` bounds the walk at a different directory in a lint-staged hook, in a CLI invoked from a package directory, and under a test runner — and the caller cannot see which one they got. That is the same fail-open failure the raw string comparison above produced, reached through a different door, so `ascend` refuses it rather than guessing. Rejecting costs one `path.resolve` at the site that knows the answer; resolving silently costs a wrong walk that cannot be detected. `ascend` consequently reads `process.cwd()` nowhere.

  The rejection is a **defect** (`Effect.die`), not a typed failure, so `ascend`'s error channel stays `never` and no call site needs to change its own signature. That follows the guard for an invalid `maxDepth` directly above it: a statically-wrong caller-supplied option is bad wiring, not a recoverable condition. It also has to be a defect to work at all — a typed failure would be absorbed by `@effected/config-file`'s resolver contract, which catches every failure into `Option.none()`, and would resurface as a clean-looking "no config file found". `Effect.catch` does not catch defects, so only a defect survives that absorption; a test reconstructs the absorbing caller and pins it.

  Only the **ceiling** is constrained. A relative `start` is still fine and still ascends to the relative root. Absoluteness is judged by the injected `Path` service, so the win32 layer accepts `C:\repo`. [#125][#125]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.1.2 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.1.1 | 0.1.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.1.0 | 0.1.1 |

## 0.2.0

### Features

- ### Downward glob expansion — `descend`
  `@effected/walker` gains a second traversal primitive alongside the upward `Walker`: `descend(pattern, options)` expands a compiled `@effected/glob` `GlobPattern` under `options.cwd` and returns the matching file paths (POSIX-separated, relative to `cwd`, sorted).
  ```ts
  import { descend } from "@effected/walker";
  import { GlobPattern } from "@effected/glob";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const pattern = yield* GlobPattern.compile("src/**/*.ts");
  	return yield* descend(pattern, { cwd: "/repo" });
  });
  ```
  `DescendOptions` accepts `maxDepth` (default `256`), `prune` (directory names never descended into; defaults to `["node_modules", ".git"]`), and `onUnreadable` (`"fail"` by default, or `"skip"` to absorb an unreadable directory instead of failing).

  The walker is semantics-free — dotfile handling, case folding and every other matching option live on the compiled pattern, not on `descend` itself. Only files match; a symlinked directory is never descended into. An unreadable directory mid-walk or a walk past `maxDepth` fails typed as the new `DescendError`, distinct from the upward walker's per-candidate absorption: a swallowed subtree in a downward enumeration would silently understate membership, so the default is to fail rather than degrade.

  This adds a new peer dependency on `@effected/glob` (type-only: `descend` imports `GlobPattern` as a type and calls its `matches()` method). [#91][#91]

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/glob | peerDependency | added | — | 0.1.0 | [#91][#91] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.1.0

### Features

- Upward path traversal as Effect primitives. Ascend the directory chain from a starting path to the filesystem root, find the nearest existing file among per-directory candidates, or find the nearest directory a marker predicate accepts. Every probe absorbs its own failure, so a single unreadable ancestor cannot hide a valid `.git` or `pnpm-workspace.yaml` above it — every public error channel is `never`. `FileSystem` and `Path` arrive from `effect` core through `R`, so no platform package is pulled in, not even in tests.
  ### Ascend and find
  Ascend from a directory, then look for a file in each rung of the chain. `findUpward` scans directory-major, so a nearer `config/.apprc` always beats a distant ancestor's.
  ```ts
  import { Walker } from "@effected/walker";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer, Option, Path } from "effect";

  const findConfig = Effect.gen(function* () {
    const path = yield* Path.Path;
    const dirs = yield* Walker.ascend(process.cwd());
    return yield* Walker.findUpward(dirs, (dir) => [path.join(dir, ".apprc")]);
  });

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  Effect.runPromise(findConfig.pipe(Effect.provide(PlatformLive))).then((found) =>
    console.log(Option.getOrNull(found)),
  );
  // the nearest ".apprc" at or above the cwd, or null when none is found or readable
  ```
  ### Find a root by marker
  `findRoot` is the same loop over the directories themselves, with a marker predicate instead of a filename. The predicate can be expensive — the scan short-circuits at the first match and never probes the rest.
  ```ts
  import { Walker } from "@effected/walker";
  import { Effect, FileSystem, Path } from "effect";

  const findGitRoot = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dirs = yield* Walker.ascend(process.cwd());
    return yield* Walker.findRoot(dirs, (dir) => fs.exists(path.join(dir, ".git")));
  });
  // Effect<Option<string>, never, FileSystem | Path>
  ```
  `Walker.ascend` accepts `stopAt` to halt the ascent inclusively and `maxDepth` (default 256) to cap it; `Walker.firstMatch` exposes the underlying absorbing, short-circuiting scan directly. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
