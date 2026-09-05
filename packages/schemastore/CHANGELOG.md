# @effected/schemastore

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
| @effected/semver | dependency | updated | 0.5.1 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Breaking Changes

- `run` and `runOne` gained `SchemaContractChangeError` in their error union; an exhaustive `catchTags` over that channel must handle it.
- A target carrying a pinned `version` whose contract changed is now refused by default where it was previously rewritten in place. Pass `contractChanges: "allow"` to restore the old behaviour.
- `PipelineCheckResult` gained the required field `contractBlocked`; code constructing that shape by hand must supply it. [#607][#607]

### Features

#### `SchemaPipeline.run` gates contract changes before writing

- `SchemaPipeline.run` is now two-phase: it builds, lints, validates and gates every target first, and writes only when every target passes. A gate failure on any target leaves every other target unwritten, where previously targets ahead of the failing one were already on disk.

- A new `contractChanges` option on `SchemaPipelineOptions` decides what happens when a document's validation contract changes:

- `"block-versioned"` (the default) — a target whose `version` is a pinned label (not a prerelease) is a published, URL-pinned document; a `"contract"` change fails with the new `SchemaContractChangeError` before any write. Unversioned and prerelease targets are rewritten in place as before.

- `"allow"` — classify and report only, never refuse. This is also the repair path for a published file whose text no longer parses, which `SchemaFile` classifies as a contract change.

- `SchemaContractChangeError` is total over the targets and carries one `ContractChangeTarget` per refused document (`$id`, `path`, `version`, `nextVersion`), so its message names the label to bump to. `PipelineCheckResult` gains `contractBlocked`, computed by the same predicate `run` uses, so a drift test can print the right remedy for a target the generator would refuse.

#### `SchemaVersioning.isPinned` and `SchemaVersioning.next`

- `isPinned(version)` answers whether a label is a non-prerelease, and is the one predicate shared by the pipeline's contract guard and the bump. `next(current, change)` answers the label a change warrants: a contract change bumps MAJOR (MINOR on the 0.x line), a prerelease is left alone, and every other change returns `current`.

#### The `x-ai-` machine-annotation family

- `KeywordFamilies` declares a house `x-ai-` prefix beside the upstream language-server families, so an `x-ai-hint` annotation on an Effect Schema field survives the Draft-07 lowering, passes the ajv strict-mode gate, and classifies as an annotation change in `DocumentDiff`. The family is a namespace, not a vocabulary: `x-ai-hint` (a string) is the one recommended key, values must be JSON, a value must not carry an `$id` at any depth, and key names must stay within ajv's keyword grammar.

### Bug Fixes

- A declared keyword whose name ajv cannot register now surfaces as a root-pathed validation finding instead of a `SchemaValidatorError`, so `SchemaPipeline.check` stays total over its targets.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.5.0 | 0.5.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#607]: https://github.com/spencerbeggs/effected/pull/607

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Bug Fixes

- `StoreDocument` assembly now correctly names an encoded-side `$defs` entry with an `Encoded` suffix (e.g. `PersonEncoded`) when the encoded AST has no identifier of its own, matching upstream's updated encoded-schema naming in `4.0.0-beta.107`. Consumers that pinned generated `$defs` keys by name should re-check them after upgrading. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.1

### Documentation

- The README quick-start now composes one named layer and provides it once at the boundary, rather than stacking two `Effect.provide` calls at the call site. Both run correctly for this package — `SchemaFile` holds no state — but the stacked form is how a layer ends up built more than once, and the example is what consumers copy. The named const is also reusable, so a drift test and the generator providing the same value cannot disagree about what the layer contains. [#268][#268]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.2.0

### Breaking Changes

- ### `SchemaFile.write` now answers a result object
  `write` previously answered `"written" | "unchanged"`. It now answers `{ outcome, change }`, so it can report what the difference *meant* alongside what it did to the file.
  ```ts
  // Before
  const outcome = yield* files.write(path, document);
  if (outcome === "written") { /* … */ }

  // After
  const { outcome, change } = yield* files.write(path, document);
  if (outcome === "written") { /* … */ }
  if (change === "contract") { /* a new schema version is warranted */ }
  ```
  ### Version labels are now full three-component SemVer
  `SchemaVersion` required `major[.minor[.patch]][-prerelease]`; it now requires all three components, validated by `@effected/semver` itself. `1.2` and `1` are rejected — pass `1.2.0` and `1.0.0`.

  The file-name convention is unchanged and still SchemaStore's own `<name>-<version>.json`. Only the label grammar narrows, so that a version can be split back out of a file name or URL unambiguously — the operation a consumer of these artifacts actually performs. Build metadata (`+build`) remains rejected: SemVer precedence ignores it, so two labels differing only in build would compare equal and both claim to be the latest.

  Two hazards retire with the old grammar: `Order` no longer pads labels before parsing (the brand's check and the ordering parse are now the same call), and a `versions` map's ascending order now survives serialization, since no SemVer label is array-index-like the way a bare-major `"2"` was.
  ### `SchemaTarget.name` is now optional
  `name` is only read by catalog naming, so a target that merely emits a file no longer has to invent one that duplicates its path's basename. It remains **required when `version` is present**, since versioned naming is `name-<version>.json` — now enforced by an overload pair, so a versioned target without a name is a compile error rather than a runtime throw. An empty string still throws.

### Features

- ### Write-if-changed now compares content, not bytes
  `SchemaFile.write` compares the parsed document rather than the exact text, so a repo whose formatter also owns the emitted file no longer churns. Previously, a pre-commit hook that reflowed the JSON meant every run found the bytes different and rewrote the file — forever — making `"unchanged"` unreachable and failing CI drift checks on documents whose content never changed. No formatter exclusion is needed.

  Pass `compare: "bytes"` to opt back into byte-exactness when the emitted text is itself the artifact.
  ### `SchemaFile.check` — drift checking without writing
  The non-writing half of the pair: the same comparison `write` makes, against the filesystem, without touching it. This is what a CI drift job wants, since it must not regenerate.
  ```ts
  const { wouldWrite, change } = yield* files.check("schemas/config.schema.json", document);
  ```
  `change` classifies the content and is immune to a formatter having reflowed the file; `wouldWrite` honors `compare`, so it agrees with the writer under either mode. `outcome` and `wouldWrite` are always the authoritative answer to "was the file touched" — under `compare: "bytes"` a `change` of `"none"` still writes.
  ### `SchemaPipeline` — the emit loop, shipped
  Generate, lint, validate, gate, write — over a `SchemaTarget` manifest, as a plain function requiring `SchemaFile` and `SchemaValidator` rather than another service to wire.
  ```ts
  const results = yield* SchemaPipeline.run(targets);
  const drift = yield* SchemaPipeline.check(targets); // same walk, no writes
  ```
  `runOne` / `checkOne` take a single target. `run` enforces — it fails with `SchemaGateError` and stops, so a gated document is never written. `check` reports — it is total over the targets and carries `blocked` per target, so a repo with several broken documents learns about all of them in one run.

  Both gates' findings normalize into one `PipelineFinding` shape (with a `label` for rendering) so a single predicate judges them. Gating is policy, not mechanism: `blocking` defaults to `severity === "warning"` and is overridable, so disagreeing with the default costs a predicate rather than a re-implementation of the loop. Findings come back as values and are never logged. A blocking finding fails with `SchemaGateError` and stops the run, so a gated document is never written.
  ### `DocumentDiff` — is this change breaking, or just wording?
  Classifies two emitted documents as `"none"`, `"annotations"` or `"contract"`. A change confined to documentation keywords replaces its predecessor transparently for every consumer, while a change to any assertion keyword means a document valid yesterday may be invalid today — the signal for whether a new `SchemaVersioning` version is warranted.
  ```ts
  DocumentDiff.classify(before, after); // => "annotations"
  DocumentDiff.isClean(change); // the clean case, without spelling "none"
  ```
  Key order is never a difference (a formatter may sort); array order is. `default`, `examples`, `readOnly` and `writeOnly` count as contract rather than documentation, because consumers act on them.
  ### `SchemaValidator` ships closed over ajv
  `SchemaValidator.layer` is now a real implementation — provide it and validation works, with no adapter to write. ajv is a direct dependency: this package is build-time tooling, and ajv strict mode *is* SchemaStore's own gate, so keeping the engine behind a contract every consumer re-implemented identically bought nothing.

  Meta-schema failures keep ajv's structured `instancePath` and `keyword` instead of collapsing into one root-pathed finding, and the declared language-server keyword families are registered before compiling, so ajv no longer rejects what `DocumentLint` deliberately allows.

  The service stays an interface: `noop` switches validation off, `makeTest` / `layerTest` remain the doubles, and another engine can still be substituted.
  ### `StoreDocument.draft07`
  Builds a document from `{ $id, root, defs? }`, filling `$schema` with the meta-schema constant — so hand-built values no longer import `DRAFT_07_META_SCHEMA` just to repeat what the package already knows.

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | ajv | dependency | added | — | ^8.20.0 | [#263][#263] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#263]: https://github.com/spencerbeggs/effected/pull/263

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Documentation

- Added the package README, which ships in the published artifact.
- Corrected the package-documentation usage example so the lint advisory it
  describes actually fires against the shown output — the prior example's
  schema had no `description` at all, so the advisory it was meant to
  demonstrate never triggered. [#219][#219]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#219]: https://github.com/spencerbeggs/effected/pull/219

## 0.1.0

### Features

- ### Initial release
  `@effected/schemastore` builds, versions, validates and lints SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources.
  ```ts
  import { CatalogEntry, DocumentLint, StoreDocument } from "@effected/schemastore";
  import { Effect, Schema } from "effect";

  const Config = Schema.Struct({ name: Schema.String });

  const program = Effect.gen(function* () {
    const document = yield* StoreDocument.fromSchema(Config, {
      $id: "https://example.com/config.schema.json",
    });
    const findings = DocumentLint.lint(document);
    const text = yield* Effect.fromResult(document.serializeResult());
    return [findings.length, text.endsWith("\n")] as const;
  });
  ```
  It sits on top of core's own `Schema.toJsonSchemaDocument` + Draft-07 lowering and owns what core does not:
  - **`StoreDocument`** — assembles the SchemaStore publication shape (`$schema` + `$id` + root + `$defs`) and re-grafts the non-standard editor keyword families (the vscode five, plus `x-taplo`, `x-tombi-` and `x-intellij-` prefixes) that the Draft-07 lowering otherwise drops.
  - **`CatalogEntry`** — the `catalog.json` entry vocabulary, supporting both versioned and unversioned catalog modes, with fileMatch hygiene lints.
  - **`SchemaVersioning`** — a branded `SchemaVersion` with numeric (not lexical) ordering, so `1.10` sorts after `1.9`.
  - **`DocumentLint`** — a total structural lint (unresolved refs, unknown keywords, missing description URLs, excessive nesting) that never fails, only reports findings.
  - **`SchemaFile`** — write-if-changed file IO over `FileSystem`/`Path`, answering `"written" | "unchanged"` as a value.
  - **`SchemaValidator`** — a contract seam for real-engine validation (ajv or similar) that the consumer closes at the edge; this package ships no validation engine itself.
  - **`CanonicalJson`** — deterministic serialization (insertion-order keys, single trailing newline) with typed failures instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain values. [#215][#215]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215
