# @effected/jsonl

## 0.4.0

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
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.3.0

### Refactoring

- Adopted effect rc.108's relocation of `SchemaError` into the `Schema` module: `InvalidData`'s self-schema now declares via `Schema.isSchemaError`. The error surface and call shapes are unchanged; no consumer action is required. [#389][#389]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.2.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.0

### Features

- ### Initial release
  `@effected/jsonl` ships append-only, schema-validated JSONL journals as a definable Effect service. A journal is a live object, not just a file format: its current state is its last valid line, its tail may be torn mid-append, and several processes can read it while one writes. Every line is an envelope (`at`, `event`, an optional `scope`, and a `data` payload validated by the schema registered for that event), so a journal stays greppable and diffable while the reads that matter stay typed.
  ```ts
  import { Journal, JsonlEvent } from "@effected/jsonl";
  import { NodeFileSystem } from "@effect/platform-node";
  import { Effect, Schema } from "effect";

  const Snapshot = JsonlEvent.make("snapshot", {
    data: Schema.Struct({ round: Schema.Number, phase: Schema.String })
  });

  class GameJournal extends Journal.Service<GameJournal>()("app/GameJournal", {
    events: [Snapshot] as const
  }) {}

  const GameJournalLive = GameJournal.layer({ path: "game.jsonl" });

  const program = Effect.gen(function* () {
    const journal = yield* GameJournal;
    yield* journal.create;
    yield* journal.append("snapshot", { round: 1, phase: "waiting" });
  });

  Effect.runPromise(program.pipe(Effect.provide(GameJournalLive), Effect.provide(NodeFileSystem.layer)));
  ```
  - **`Journal`** — `Journal.Service<Self>()(id, { events })` mints a per-registry service class whose `.layer({ path })` is a scoped layer over `FileSystem`, with `append`, `appendPatch`, `latest`, `quiescent`, `query`, `changes`, `projection`, `create` and `remove` all typed by that registry. `at` is stamped by the service from the Effect `Clock`, never by the caller, so two writers can never disagree about ordering.
  - **`JsonlEvent`** — declares one event's tag, payload schema and optional `terminal`/`reopen` markers for a registry array.
  - **`Envelope`** / **`EnvelopeFrame`** — a two-stage decode: the frame (`at`, `event`, `scope?`, `data` left unknown) is what every filter reads, and the registered payload schema runs only for lines a slice has already selected.
  - **`Slice`** — the one filter shape every read surface (`query`, `changes`, `projection`) takes: `events`, `scopes`, an inclusive `from`, an exclusive `to`, and a `cursor` for resuming — no read surface ever materializes the whole file.
  - **`Line`** / **`Envelope.lastValidResult`** — a pure, synchronous, `Result`-based core that walks back to the last valid envelope with no Effect runtime at all, so a hook script or shell-adjacent tool can read a journal's current state directly.
  - A built-in watcher cross-observes external writers — a second service instance, a sibling process, or a shell script appending with `>>` — so a subscriber cannot tell a local append from an external one.

  Eight tagged errors (`MalformedLine`, `UnknownEvent`, `InvalidData`, `UnserializableData`, `TerminalViolation`, `JournalClosed`, `JournalNotFound`, `JournalResync`) carry their causes structurally rather than stringified; core's `PlatformError` passes through IO failures untranslated rather than being wrapped. [#232][#232]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#232]: https://github.com/spencerbeggs/effected/pull/232
