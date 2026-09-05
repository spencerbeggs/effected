# @effected/cli

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
