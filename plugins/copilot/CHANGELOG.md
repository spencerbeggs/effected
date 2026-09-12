# @effected/copilot-plugin

## 0.6.0

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
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.5.1

### Other

- The generated construct index under `skills/effected-packages/references/constructs/jsonc.md` picks up `@effected/jsonc`'s synchronous fingerprint twins: the new `JsoncDigest` type, and `JsoncCanonicalizeError`'s updated summary naming `hashResult` and `hashTextResult` among its raisers. Regenerated output only — no skill prose or annotation changed. [#683][#683]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#683]: https://github.com/spencerbeggs/effected/pull/683

## 0.5.0

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

## 0.4.0

### Features

- The actions-inputs-outputs skill drops the hand-rolled check-then-run contract preflight: `SchemaPipeline.run` refuses a pinned versioned target's contract change itself, and the drift test reads `contractBlocked` to print the right remedy.
- The LLM-annotation guidance is reversed: `x-ai-hint` is a declared family carried into emitted schemas, replacing the description-only advice.
- The schemastore package reference and construct index cover `contractChanges`, `SchemaContractChangeError`, `ContractChangeTarget`, `SchemaVersioning.isPinned` and `SchemaVersioning.next`. [#607][#607]

### Documentation

- The workspaces reference no longer teaches the sync facade as the workaround for a version-less root; `WorkspacePackage.version` is optional and `getWorkspacePackagesSync` reports skips through `onSkip`.
- The secrets reference's comment stripper example uses the safe lines-then-blocks order, matching the structural-checks rule it cites. [#614][#614]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#607]: https://github.com/spencerbeggs/effected/pull/607

[#614]: https://github.com/spencerbeggs/effected/pull/614

## 0.3.0

### Features

#### `bootstrapping-an-action` interview skill

- Mirrors the Claude Code plugin's new user-invoked skill: an eight-question interview — identity, phases, GitHub access, inputs, outputs, runner capabilities, reporting, and self-dogfood — one question per message, that turns a fresh copy of the `github-action-template` repository into a planned action. It writes a plan file capturing the frozen I/O contract, the phase decision, the derived dependency list, the rename list, and a known-unknowns ledger, then hands off to the `action-engineer` agent to run `designing-an-action` from Phase 0. Only an explicit "bootstrap this template" request loads it.

- `action-engineer` now preloads `bootstrapping-an-action` and owns publishing the output schema to schemastore as part of the output-contract workflow described below.

#### Output contracts taught through schemastore

- `actions-inputs-outputs` now teaches structured outputs as versioned, published JSON Schema documents. Any action with a JSON output runs a pre-write gate before emitting it, and a `SchemaPipeline.check` drift test keeps the published schema and the runtime `Schema` definition from diverging.

#### `structuring-an-action` canon updates

- A new `schemas/` slot for committed JSON Schema documents: `schemas/<version>/<name>-<version>.json` for a versioned output contract, and an unversioned `<action>.input.schema.json` at the repo root for an input schema.

- Baseline-first emission: `program.ts` emits the all-disabled output baseline before any work, never from an `Effect.onError` handler, so a failure handler can never blank an output describing work that happened.

- A two-sided compile-time layers proof: type-level assertions that the app layer's requirement channel and the program's requirement channel, minus the runtime's `ActionServices`, are both `never`.

- The any-depth collection rule: the test runner's project discovery skips directories named `utils`, `fixtures` or `snapshots` at any depth, so `src/utils/` mirrors to `__test__/unit/utilities/`.

- The `@effected/memfs` mandate for any test that touches the filesystem, never a hand-rolled `FileSystem.layerNoop` double.

- The `building-a-github-action` router and `testing-actions` skill are reconciled with this canon so their guidance and examples stay consistent with the new schema and testing rules. [#600][#600]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#600]: https://github.com/spencerbeggs/effected/pull/600

## 0.2.0

### Features

- Mirrors CLaude Code plugin setup with agents skills and hooks. [#558][#558]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#558]: https://github.com/spencerbeggs/effected/pull/558

## 0.1.0

### Features

#### An experimental Copilot plugin

- `plugins/copilot/` introduces a GitHub Copilot build of the "effected" plugin, alongside the established Claude Code one. It is an experiment: the intent is to find out whether Copilot is usable for `@effected` development, not to reach parity with the Claude Code plugin.

- Copilot and Claude Code describe skills and hooks in similar but incompatible formats, so the agent and skill content is maintained twice. Claude Code is the source of truth — a change lands in `plugins/claude-code/` first and is then copied and refactored into `plugins/copilot/`.

#### Versioning and distribution

- The plugin is tracked by a private workspace package, `@effected/copilot-plugin`, which never publishes to npm. A changeset naming it bumps both `plugins/copilot/package.json` and the plugin manifest `plugins/copilot/plugin.json`, then cuts a git tag and a GitHub release.

- It is distributed from its own Copilot marketplace in `spencerbeggs/bot`, separate from the Claude Code marketplace. That marketplace's ref is bumped by hand for these first versions rather than on release. [#555][#555]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#555]: https://github.com/spencerbeggs/effected/pull/555
