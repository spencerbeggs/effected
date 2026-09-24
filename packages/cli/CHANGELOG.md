# @effected/cli

## 0.8.0

### Breaking Changes

- On the `0.x` line breaking changes ship as `minor`; the changes below need action on upgrade.

#### `CliLogger`'s default `stderrFrom` is now `"All"`

- Every log level now goes to stderr by default, closing #716. Previously `stderrFrom` defaulted to `"Error"`, so `Info`/`Warning` went to stdout as program output — fine for a tool whose output *is* its log lines, but wrong the moment stdout is a machine-readable document, since a `--format=json` command would interleave its warnings into the JSON stream.

- Write program output with `Console.log`, never `Effect.log`. Pass the old default explicitly if your CLI relies on it:

```ts
import { CliLogger } from "@effected/cli";

CliLogger.layer({ stderrFrom: "Error" }); // restores the previous default
```

#### `reportFailures` no longer double-renders a `UserError`, and `ShowHelp` exit codes changed

- `Command.runWith` already renders a `CliError.UserError` itself, through its `CliOutput` formatter, before re-failing with it — `CliRuntime.reportFailures` and `CliRuntime.main` now detect that (the mark `runWith` flips) and skip printing it a second time, exiting with the usage code (`64` by default) instead of the generic fallback.

- A `UserError` marked with an explicit exit code keeps it: `CliRuntime.reported(userError, 3)` exits `3`, not the usage code. Such an error is treated as already printed and is not rendered, so use a different error type if the program has not printed it.

- A bare `ShowHelp` — `--help`, or a root invocation with no parse errors — still exits `0` silently. A `ShowHelp` carrying parse errors now exits `usageExitCode` (default `64`, BSD `EX_USAGE`) instead of the previous fallback of `1`.

### Features

#### `CliRuntime.main` and `MainOptions`

- Assembles a whole program in the one order that reports every failure well: a fresh `CliExit` cell, then your platform layer (inside failure reporting, so a layer-build failure renders as one line instead of escaping to a stack trace), then failure reporting, then the logger outermost.

```ts
import { CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";

NodeRuntime.runMain(CliRuntime.main(Command.run(root, { version }), { platform: NodeServices.layer }));
```

#### `CliExit` and findings exit codes

- A findings command — a linter that found problems, say — can now exit non-zero on a *successful* run, with finalizers intact on any runtime:

```ts
import { CliExit } from "@effected/cli";

yield* CliExit.set(2); // highest code set during the run wins; must be an integer 0..255
```

- `CliExit` is a `Context.Service`, not a reference, so forgetting to provide it is a type error. A program run under `CliRuntime.main` must not provide `CliExit.layer` itself — `main` already provides a fresh one.

#### `CliColor`

- The no-color.org colour decision, shared by every renderer:

```ts
import { CliColor } from "@effected/cli";

CliColor.enabled; // Effect<boolean, never, Stdio> — off when stdout isn't a terminal, or NO_COLOR is a non-empty value
CliColor.formatterLayer(); // wires effect/unstable/cli's CliOutput.Formatter to the same decision
```

#### `ReportFailuresOptions.usageExitCode`

- A new option controlling the exit code for a usage error (a `ShowHelp` carrying parse errors, or an already-rendered `UserError`), separate from the general failure fallback. Defaults to `64`.

#### `@effected/cli/testing`

- A new subpath, never reachable from the main entrypoint, for spawning a **built** CLI bin hermetically in tests: [#821][#821]

```ts
import { CliTest } from "@effected/cli/testing";

const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
const result = yield* CliTest.run("dist/bin.js", ["--help"], { sandbox, execPath: process.execPath });
// { exitCode, stdout, stderr } — a non-zero exit is data, never a failure
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#821]: https://github.com/spencerbeggs/effected/pull/821

## 0.7.0

### Features

- Upgrades core Effect to `rc-117` [#812][#812]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.11.1 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#812]: https://github.com/spencerbeggs/effected/pull/812

## 0.6.0

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
| @effected/config-file | dependency | updated | 0.10.1 | 0.11.0 |
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

## 0.5.2

### Bug Fixes

- Fixes closure issues in all packages.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.10.0 | 0.10.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.9.0 | 0.10.0 |

## 0.5.0

### Features

- `CliRuntime.reported` now preserves the error's type: a new `<E extends Error>(error: E, exitCode?: number): E` overload returns the very instance a typed caller passed (the marks are added in place), so a program can `Effect.fail(CliRuntime.reported(typedError, code))` and keep `catchTags` narrowing downstream without an `as typeof error` cast. The `unknown -> Error` fallback is unchanged: a non-`Error` value is still wrapped in a plain marked `Error`, and the exit code still defaults to `1`. `schemastore-cli` drops its three casts and its local re-typing wrapper. [#726][#726]

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) for their contributions!

[#726]: https://github.com/spencerbeggs/effected/pull/726

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.8.0 | 0.9.0 |

## 0.4.0

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
| @effected/config-file | dependency | updated | 0.7.1 | 0.8.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.6.0 | 0.7.0 |

## 0.3.0

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
| @effected/config-file | dependency | updated | 0.5.2 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.4.2 | 0.5.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.1.0

### Features

- ### New package: `@effected/cli`
  The boundary layer of a command-line program built on `effect/unstable/cli` — how output reaches a human, how a failure is reported, and how a schema issue becomes a sentence. It is **not** a CLI framework: core owns parsing, flags, the command tree and help, and this package must never grow a second one.

  Everything here shares one property: a consumer only discovers the need by shipping bad output to a person. None of it fails a type-check, a test, or a review of the code in isolation.
  ```ts
  import { CliLogger, CliRuntime } from "@effected/cli";
  import { NodeRuntime } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

  NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)));
  ```
  **`CliLogger`** renders a log record as a plain line and routes `Error`/`Fatal` to stderr. Effect's default logger emits `[00:33:56.619] INFO (#2): message`, which is right for a service being scraped and wrong for a tool someone is watching. It reads the `Console` off the fiber rather than writing to `process.stdout`: `Logger.make` takes a synchronous callback and a `Sink` write is an `Effect`, so `Stdio` is unreachable from a logger — and the reference approach keeps the package platform-free while making the stream split assertable, which a `process.stdout` write is not. `References.LogToStderr` is honoured as a one-way override: it can force everything to stderr, never move an error onto stdout.

  **`CliRuntime.reportFailures`** fixes *where* a failure is reported. A platform `runMain` composes its reporting `tapCause` around the already-provided effect, so an unhandled failure prints through Effect's **default** logger — outside your layers, in the format `CliLogger` exists to replace, on **stdout**. This catches inside the program, renders through your logger, and re-fails carrying `Runtime.errorExitCode` and `Runtime.errorReported`, so the exit code is right and the runtime does not report it twice. No platform import. An error that already carries its own exit code keeps it; an interrupt is left alone.

  **`SchemaIssueRenderer`** and **`ConfigIssueRenderer`** flatten an issue tree to `unknown key at groups.g.cleanup.rulesetz`. Core ships the formatters this wraps, and they are effectively undiscoverable — they live on `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*`, and `SchemaError.message` does not use them, so printing the error hints at nothing. One phrasing is overridden: core's `"Expected no excess property"` describes the schema's rule rather than the user's mistake. Lines are deduplicated, because a union otherwise repeats the same unknown-key line once per branch, burying the lines that say which shapes were allowed.

  `@effected/config-file` is an **optional** peer, consumed only by `ConfigIssueRenderer`, which is a module nothing else imports — so a consumer who does not install it never reaches for it at runtime. [#352][#352]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.3.1 | 0.4.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352
