# @effected/schemastore

## 0.2.1

### Documentation

* The README quick-start now composes one named layer and provides it once at the boundary, rather than stacking two `Effect.provide` calls at the call site. Both run correctly for this package — `SchemaFile` holds no state — but the stacked form is how a layer ends up built more than once, and the example is what consumers copy. The named const is also reusable, so a drift test and the generator providing the same value cannot disagree about what the layer contains. [#268][#268]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

* | Dependency       | Type       | Action  | From  | To    |                                                          |
  | ---------------- | ---------- | ------- | ----- | ----- | -------------------------------------------------------- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.2.0

### Breaking Changes

* ### `SchemaFile.write` now answers a result object

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

* ### Write-if-changed now compares content, not bytes

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

* | Dependency | Type       | Action | From | To      |                                                                       |
  | :--------- | :--------- | :----- | :--- | :------ | --------------------------------------------------------------------- |
  | ajv        | dependency | added  | —    | ^8.20.0 | [#263][#263] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#263]: https://github.com/spencerbeggs/effected/pull/263

## 0.1.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Documentation

* Added the package README, which ships in the published artifact.
* Corrected the package-documentation usage example so the lint advisory it
  describes actually fires against the shown output — the prior example's
  schema had no `description` at all, so the advisory it was meant to
  demonstrate never triggered. [#219][#219]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#219]: https://github.com/spencerbeggs/effected/pull/219

## 0.1.0

### Features

* ### Initial release

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

  * **`StoreDocument`** — assembles the SchemaStore publication shape (`$schema` + `$id` + root + `$defs`) and re-grafts the non-standard editor keyword families (the vscode five, plus `x-taplo`, `x-tombi-` and `x-intellij-` prefixes) that the Draft-07 lowering otherwise drops.
  * **`CatalogEntry`** — the `catalog.json` entry vocabulary, supporting both versioned and unversioned catalog modes, with fileMatch hygiene lints.
  * **`SchemaVersioning`** — a branded `SchemaVersion` with numeric (not lexical) ordering, so `1.10` sorts after `1.9`.
  * **`DocumentLint`** — a total structural lint (unresolved refs, unknown keywords, missing description URLs, excessive nesting) that never fails, only reports findings.
  * **`SchemaFile`** — write-if-changed file IO over `FileSystem`/`Path`, answering `"written" | "unchanged"` as a value.
  * **`SchemaValidator`** — a contract seam for real-engine validation (ajv or similar) that the consumer closes at the edge; this package ships no validation engine itself.
  * **`CanonicalJson`** — deterministic serialization (insertion-order keys, single trailing newline) with typed failures instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain values. [#215][#215]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215
