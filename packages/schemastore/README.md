# @effected/schemastore

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Build, version, validate and lint SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources. Core effect already owns the generation pipeline: `Schema.toJsonSchemaDocument` produces Draft 2020-12 and `JsonSchema.toDocumentDraft07` lowers it. This package owns what [SchemaStore](https://www.schemastore.org) expects around that output — the publication shape (`$schema` + `$id` + root + `$defs`, with the `#/definitions` → `#/$defs` ref rewrite the lowering makes necessary), the gate that holds a document's non-standard surface to the language-server keyword families it declares, catalog entries in both versioning modes, structural and hygiene lints, ajv strict-mode validation, canonical JSON text and content-comparing write-if-changed file IO. `SchemaPipeline` runs that whole emit loop over a list of targets, so a build script calls one function.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/schemastore

Generating a JSON Schema from an Effect Schema is a solved problem — core does it. Publishing that schema where editors find it is not. SchemaStore recommends Draft-07 because that is what the language servers actually support, and core's Draft-07 lowering has two consequences a publisher must deal with: it rewrites `$ref` pointers to the canonical `#/definitions/...` form while the published document keeps its pool under `$defs`, and it carries unknown and custom keywords through as opaque values — so `markdownDescription`, `x-taplo` and the other editor keywords survive, and the publisher's problem is not getting them through but keeping anything *else* out of a document SchemaStore's own gate would reject. Around the document itself sits SchemaStore's own contract: ajv strict mode as the validation gate, catalog entries whose `fileMatch` patterns must not be generic and versioned schemas as suffixed files plus a `versions` map whose `url` points at the latest. This package is that last mile, so a build script does not have to reinvent it.

The scope is deliberately narrow. There is no schema construction here, no ref resolution beyond the document's own `$defs` pool and no dialect conversion — core's `JsonSchema` owns the generation pipeline, ajv provides the validation gate and this package owns the SchemaStore shape in between.

## Install

```bash
npm install @effected/schemastore effect
```

```bash
pnpm add @effected/schemastore effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency. Two regular dependencies ride along: `@effected/semver` does the version ordering inside `SchemaVersioning`, with no `SemVer` type surfacing in the public API, and `ajv` is the engine behind `SchemaValidator.layer`. ajv therefore arrives with this package and the validation examples below need no extra install; if your own code imports ajv directly, depend on it directly rather than relying on this one's copy. Every module is pure except `SchemaFile`, whose layer requires core `FileSystem` and `Path`, supplied at the edge from `@effect/platform-node` or `@effect/platform-bun`.

## Quick start

Turn an Effect Schema into a publication-ready document:

```ts
import { StoreDocument } from "@effected/schemastore";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ name: Schema.String });

const program = Effect.gen(function* () {
  const document = yield* StoreDocument.fromSchema(Config, {
    $id: "https://example.com/config.schema.json",
  });
  return yield* Effect.fromResult(document.serializeResult());
});

console.log(Effect.runSync(program));
// {
//   "$schema": "http://json-schema.org/draft-07/schema#",
//   "$id": "https://example.com/config.schema.json",
//   "type": "object",
//   "properties": {
//     "name": {
//       "type": "string"
//     }
//   },
//   "required": [
//     "name"
//   ],
//   "additionalProperties": false
// }
```

`fromSchema` runs the whole pipeline — 2020-12 generation, Draft-07 lowering, the `$ref` rewrite and the declared-family gate — so every `$ref` in a built document already resolves against its `$defs` pool. `toJson()` is the flat publication shape (`$defs` omitted when empty) and `serializeResult` routes through the owned canonical serializer, tab-indented with a single trailing newline. If core cannot convert a schema, the failure is typed as `SchemaConversionError` and carries the `$id` and the structured cause.

## Annotate at the definition site

One constraint bites consumers who do not know it, so it comes before the feature tour. An annotation applied at a hoisted schema's *usage* site (`Person.annotate({ ... })` inside a struct field) reaches neither the `$ref` node nor the `$defs` pool entry, even before the Draft-07 lowering. It silently carries nothing. Put the annotation where the schema is defined.

## Carrying language-server annotations

SchemaStore documents lean on non-standard keywords the editors read: the vscode-json-languageservice set (`markdownDescription`, `defaultSnippets`, `enumDescriptions`, `markdownEnumDescriptions`, `allowTrailingCommas`), taplo's `x-taplo` keys, tombi's `x-tombi-*` and IntelliJ's `x-intellij-*`. Effect Schema annotations accept arbitrary string keys, so `Schema.String.annotate({ "x-taplo": { ... } })` type-checks with no module augmentation, and core's Draft-07 lowering carries the key through as an opaque value — in place, on the node you attached it to. `StoreDocument.fromSchema` admits the declared families unconditionally, so the annotation you wrote is the keyword that ships:

```ts
import { StoreDocument } from "@effected/schemastore";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({
  name: Schema.String.annotate({ "x-taplo": { docs: { main: "The display name." } } }),
});

const program = Effect.gen(function* () {
  const document = yield* StoreDocument.fromSchema(Config, {
    $id: "https://example.com/config.schema.json",
  });
  return document.root.properties;
});

console.log(Effect.runSync(program));
// => { name: { type: "string", "x-taplo": { docs: { main: "The display name." } } } }
```

The declared families are always admitted, whatever a caller-supplied `includeAnnotationKey` answers — `KeywordFamilies` is the one registry, consumed by both the gate and the lint, so the two cannot drift on what counts as declared. The predicate's only remaining effect is to fail the build: a key it admits outside the declared families raises `UndeclaredAnnotationKeyError`, naming every offending key. That is deliberate. This package emits SchemaStore-compatible documents only, and the families are the whole non-standard surface it will ship, so a predicate that reaches past them is a mistake worth hearing about rather than a preference worth honouring quietly.

One thing the package does *not* do to a declared-family value is walk inside it. The `#/definitions` → `#/$defs` `$ref` rewrite skips those payloads entirely: they are opaque advice addressed to a language server, so a `$ref`-shaped string inside one means whatever that tool says it means and survives verbatim.

`KeywordFamilies` splits into two groups. The upstream families above are mirrored from SchemaStore's own CONTRIBUTING guide — vocabularies the language servers already read. The `x-ai-` prefix (with the trailing dash — bare `x-ai` and a look-alike like `x-aida-foo` are not declared) is different: a house machine-annotation namespace this package owns rather than mirrors, meant for a machine reader rather than an editor. It is a namespace, not a fixed vocabulary — any key under the prefix is declared, and the one recommended (non-binding) key is `x-ai-hint`, a string instruction to a machine reader about the annotated value. A key under the prefix must be one ajv can register: after `x-ai-` only `[A-Za-z0-9_$:-]` (ajv holds a keyword name to `/^[a-z_$][a-z0-9_$:-]*$/i`), so a dot, a space, a slash, an `@`, a `+` or a non-ASCII character makes the engine gate reject the whole document as a finding. A declared-family value must itself be JSON, and must not contain an `$id` — or a repeated `$anchor` — at any depth, not merely as its own top-level key: ajv's reference collection walks unknown keywords looking for them, and a colliding one fails the compile. An empty-string `$id` resolves to the root id and collides too. No upstream tool sanctions `x-ai-` today, so it is intended for self-hosted publication rather than submission to schemastore.org without that repo's own validation-config entry. Because `x-ai-*` advises a reader rather than asserting anything, `DocumentDiff` classifies it as an annotation: adopting the family on an already-published versioned document rewrites that file in place, the same as any other prose change.

## Catalog entries and versioning

`CatalogEntry` is the `catalog.json` entry as a `Schema.Class`, so decoding an existing entry and encoding one for submission are the same artifact. `SchemaVersion` is a **full three-component SemVer** label — `major.minor.patch` with an optional prerelease, enforced by `@effected/semver` — so ordering is plain SemVer precedence (`1.10.0` above `1.9.0`) and the label round-trips verbatim. Build metadata is rejected (`1.0.0+build.5` does not parse): SemVer precedence ignores it, so two labels differing only in build would compare equal and both claim to be the latest. Surrounding whitespace is rejected for the same round-tripping reason. The file-name convention is SchemaStore's own `<name>-<version>.json`; the label grammar is the one deliberate divergence, since the store's corpus uses partial labels like `1.2` that no SemVer parser accepts and that cannot be split back out of a file name unambiguously.

`SchemaVersioning.isPinned(version)` answers whether a label names a published document rather than a prerelease — SemVer §9 makes a prerelease's own instability explicit, so a contract change inside one breaks nobody's pin. It is the one predicate the pipeline's contract gate and `SchemaVersioning.next` both read, so the two can never disagree about the same label. `next(current, change)` is the version a `WriteChange` classification calls for: identity for anything but a `"contract"` change on a pinned label, otherwise a MINOR bump on the 0.x line (0.x treats MINOR as the breaking axis) or MAJOR above it — always strictly greater, never a minted prerelease.

`CatalogEntry.assemble` derives both catalog modes from the same inputs. Pass `versions` for the versioned mode — the `versions` map carries every label and `url` points at the latest version's file — or omit it for the unversioned single-file mode. An empty `versions` array is a contradiction and throws; pass `undefined` instead.

```ts
import { CatalogEntry, SchemaVersioning } from "@effected/schemastore";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const versions = yield* Effect.forEach(["1.9.0", "1.10.0"], SchemaVersioning.parse);
  return CatalogEntry.assemble({
    name: "My Tool",
    description: "Configuration for My Tool.",
    fileMatch: ["mytool.config.json"],
    baseUrl: "https://example.com/schemas",
    fileBaseName: "mytool",
    versions,
  });
});

console.log(Effect.runSync(program).url);
// => "https://example.com/schemas/mytool-1.10.0.json"
```

The `fileMatch` hygiene lint enforces the patterns SchemaStore's reviewers enforce, as pure shape analysis — it never matches a pattern against a path, so there is no glob engine behind it:

```ts
import { CatalogEntry } from "@effected/schemastore";

const findings = CatalogEntry.lintFileMatch(["config.toml", "**/{a,b}.json"]);

console.log(findings.map((finding) => finding.check));
// => ["GenericFileMatch", "ComplexFileMatch"]
```

`GenericFileMatch` flags patterns matching generic names other tools also use (SchemaStore rejects them); `ComplexFileMatch` flags glob constructs like alternations that should be expanded into multiple simple patterns. `entry.lint()` runs the same checks over an assembled entry.

## Linting documents

`DocumentLint.lint` is the owned, always-available half of the validation story: total structural checks returning findings as values, never an error — hostile nesting degrades to a finding too.

| Check | Severity | Fires when |
| ----- | -------- | ---------- |
| `UnresolvedRef` | warning | a `$ref` does not resolve against the `$defs` pool — including a `#/definitions/...` pointer that survived where it should not |
| `UnknownKeyword` | warning | a keyword sits outside Draft-07 plus the declared non-standard families, which ajv strict mode would reject |
| `DescriptionWithoutUrl` | advisory | the root description's last line is not a documentation URL (SchemaStore's description convention) |
| `DepthExceeded` | warning | nesting exceeds the depth cap; the walk stops there instead of failing |

The keyword walk is position-aware: a *property* named `unevaluatedProperties` is data, not a keyword, and is not flagged; `enum`, `const`, `default` and `examples` values are never descended into.

## Real-engine validation

SchemaStore's own gate is ajv strict mode, and this package ships it. `SchemaValidator.layer` is a real ajv implementation: provide it and validation works, with no adapter to write. ajv is a direct dependency because SchemaStore's gate *is* ajv, and this package is build-time tooling for emitting documents that clear that gate. Keeping the engine out of the graph bought nothing and left every consumer writing the same adapter.

The channel convention holds: findings are values — a strict-mode rejection is a report, not an error — and the error channel is reserved for the engine failing as a mechanism (`SchemaValidatorError`). Meta-schema failures keep ajv's structured `instancePath` and `keyword`; a strict-mode rejection, which ajv raises by throwing, becomes a root-pathed finding. The declared language-server keyword families are registered before compiling, so ajv does not reject what `DocumentLint` deliberately allows — one `KeywordFamilies` predicate governs both verdicts.

```ts
import { SchemaValidator, StoreDocument } from "@effected/schemastore";
import { Effect, Schema } from "effect";

const program = Effect.gen(function* () {
  const validator = yield* SchemaValidator;
  const document = yield* StoreDocument.fromSchema(Schema.Struct({ name: Schema.String }), {
    $id: "https://example.com/config.schema.json",
  });
  return yield* validator.validate(document.toJson());
});

Effect.runPromise(Effect.provide(program, SchemaValidator.layer)).then(console.log);
// [] when the document compiles clean; the engine's findings otherwise
```

The service stays an interface: `noop` switches validation off deliberately, `makeTest` / `layerTest` are the doubles (unstubbed members die naming themselves) and a consumer standardized on another engine can substitute one. `DocumentLint` remains the engine-free structural half, answering SchemaStore hygiene questions ajv does not.

`validate` takes the flat serialized record — `StoreDocument.toJson()`'s shape — so the seam stays engine-shaped and decoupled from this package's classes.

## Writing schema files

`SchemaFile` is the package's one IO surface: serialize through the canonical serializer, compare against what is on disk and write only on difference, creating parent directories as needed. The result is a value, never a log.

The comparison is by **content**, not bytes, so a generated schema can share a file with a formatter that also owns it. If your repo's Biome or Prettier hook reflows the emitted JSON, the next run still reports `"unchanged"` and leaves the file alone, and you write no exclusion rule. Pass `compare: "bytes"` to opt back into byte-exactness when the emitted text is itself the artifact.

`write` also says what the difference *meant*: `"annotations"` when only prose and editor affordances moved, so the document replaces its predecessor transparently and needs no new version, and `"contract"` when an assertion keyword moved and a consumer's valid document may now be invalid. `check` makes the same comparison without writing, which is what a CI drift job wants:

```ts
import { SchemaFile, StoreDocument } from "@effected/schemastore";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

const program = Effect.gen(function* () {
  const files = yield* SchemaFile;
  const document = yield* StoreDocument.fromSchema(Schema.Struct({ name: Schema.String }), {
    $id: "https://example.com/config.schema.json",
  });
  const first = yield* files.write("schemas/config.schema.json", document);
  const second = yield* files.write("schemas/config.schema.json", document);
  const drift = yield* files.check("schemas/config.schema.json", document);
  return [first, second, drift] as const;
}).pipe(
  Effect.provide(SchemaFile.layer),
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

Effect.runPromise(program).then(console.log);
// => [
//      { outcome: "written", change: "created" },
//      { outcome: "unchanged", change: "none" },
//      { wouldWrite: false, change: "none" },
//    ]
```

`outcome` and `wouldWrite` are the authoritative answers to whether the file was or would be touched. Never infer that from `change`, which reports content and reads `"none"` on a `compare: "bytes"` write that did rewrite the file.

Failures stay typed and apart: `SchemaFileNotFoundError` for a missing file on `read`, `SchemaFileReadError` when the comparison read fails for any other reason (the write fails rather than silently overwriting), `SchemaFileWriteError` for the filesystem write and `CanonicalJsonError` when the document does not serialize.

## The emit pipeline

`SchemaPipeline` is the loop around everything above: generate each target's document, lint it, validate it with the engine, gate on the findings, write it. It is a plain function requiring `SchemaFile` and `SchemaValidator`, not another service to wire.

```ts
import { SchemaFile, SchemaPipeline, SchemaTarget, SchemaValidator } from "@effected/schemastore";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

const targets = [
  SchemaTarget.make({
    schema: Schema.Struct({ name: Schema.String }),
    $id: "https://example.com/config.schema.json",
    path: "schemas/config.schema.json",
  }),
];

// One named layer, composed once, provided at the boundary.
const AppLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(
  Layer.provide(NodeServices.layer),
);

const program = SchemaPipeline.run(targets).pipe(Effect.provide(AppLayer));

Effect.runPromise(program).then(console.log);
// => [{ $id, path, outcome: "written", change: "created", findings: [] }]
```

`NodeServices` is composed **into** the layer with `Layer.provide` rather than
stacked onto the program with a second `Effect.provide`. Both run correctly
here — `SchemaFile` holds no state, so nothing observes the difference — but
the composed form is the shape to copy. Stacking `Effect.provide` calls at the
call site is how a layer ends up built more than once, and the first stateful
service you add is where that starts to matter. Binding the composition to a
named `const` also makes it reusable: a drift test and the generator that
provide the same value cannot disagree about what the layer contains.

A target names its schema, its `$id` and where the file goes. `name` is optional and only catalog naming reads it, so a file-only target like the one above does not repeat its path's basename; supply it when you also pass a `version`, since versioned naming is `<name>-<version>.json`.

Both gates' findings normalize into one `PipelineFinding` shape, so a single predicate judges them. Gating is **policy, not mechanism**: `blocking` defaults to `severity === "warning"`, which is what `UnresolvedRef`, `UnknownKeyword` and `DepthExceeded` are. Replace the predicate rather than the loop when you disagree.

```ts
SchemaPipeline.run(targets, { blocking: (finding) => finding.source === "validator" });
```

Worth knowing which gate actually stops you here. A target carries a `Schema`, so pipeline documents come from `fromSchema`, which never admits an undeclared keyword in the first place: `UnknownKeyword` is effectively unreachable through this entry point and **the engine gate is what blocks in practice**. The lint's warning checks earn their keep on depth and on documents the pipeline did not build, such as a hand-assembled `StoreDocument.draft07` or one read back off disk.

Findings come back as values and are never logged, so the wording of your build output stays yours. A blocking finding fails with `SchemaGateError` carrying every finding that blocked. `run` is **two-phase and all-or-nothing across targets**: every target is generated, gated, and — for a target the contract policy guards — classified against its predecessor before any file is touched, and only then are the held documents written, in order. A gate or contract failure on the third target therefore leaves the first two unwritten too, not merely the third; nothing is written unless every target passes both gates.

### The contract gate

A schema with a pinned `version` — `SchemaVersioning.isPinned`'s name for a label with no prerelease — is a published document: consumers pin its URL. `SchemaPipeline.run` will not silently rewrite one in place when the new document's validation contract has moved out from under it: by default (`contractChanges: "block-versioned"`), a `"contract"` change on such a target fails the whole run with `SchemaContractChangeError` before anything is written, carrying every affected target's `$id`, `path`, `version` and the `nextVersion` it should publish under instead (`SchemaVersioning.next`). A target with no `version`, or with a prerelease label, declares its own instability and is rewritten in place as before.

```ts
import { SchemaContractChangeError, SchemaPipeline } from "@effected/schemastore";
import { Effect } from "effect";

declare const targets: Parameters<typeof SchemaPipeline.run>[0];

const program = SchemaPipeline.run(targets).pipe(
  Effect.catchTag("SchemaContractChangeError", (error: SchemaContractChangeError) =>
    Effect.succeed(
      error.targets.map((target) => `${target.$id}: ${target.version} -> ${target.nextVersion}`),
    ),
  ),
);
```

Pass `contractChanges: "allow"` to classify and report only, never refuse — the same behavior the pipeline had before this gate existed. That is also the sanctioned repair path for a published file whose on-disk text no longer parses: `SchemaFile` classifies unparseable text as `"contract"` so a corrupted generated file stays regenerable, and the default policy would otherwise refuse that exact repair.

The contract gate is only coherent when `version` participates in a target's `path` (`schemas/<version>/<name>-<version>.json`) — a target at a fixed path compares the same file forever, so bumping `version` alone does not move where the next write lands.

`SchemaPipeline.check(targets)` is the same walk with no writes, answering `wouldWrite`, `change`, `blocked` and `contractBlocked` per target. Where `run` enforces, `check` reports: it is total over the targets and never stops at a failing gate or a blocked contract, so a repo with several broken documents learns about all of them in one run rather than one per run. `blocked` and `contractBlocked` answer different questions side by side — the first, whether findings would block under `blocking`; the second, whether the contract policy would refuse the write under `contractChanges` — so a drift job can print the right remedy instead of telling a refused target to "just regenerate."

`runOne` and `checkOne` take a single target and answer its one result directly, so a one-target caller need not prove element zero exists.

## Comparing two documents

`DocumentDiff.classify` is the pure form of the comparison `SchemaFile` makes internally: hand it two emitted documents and it answers `"none"`, `"annotations"` or `"contract"`. That is the signal for whether a change needs a new schema version — `"annotations"` replaces its predecessor transparently, `"contract"` does not. `DocumentDiff.isClean` is the predicate for the clean case, so consumers do not spell `"none"` themselves; `"created"` is deliberately not clean.

The classification is key-order insensitive and keyword-position aware, like the lint. `default`, `examples`, `readOnly` and `writeOnly` count as contract rather than documentation, because consumers act on them: reporting a contract change as annotations ships a silent break, while the reverse only costs a version bump.

## Canonical JSON

`CanonicalJson` is the deterministic serializer behind `serializeResult` and `SchemaFile.write`: insertion-order keys (assembly owns ordering — nothing is sorted), tab indentation by default, LF line endings and a single trailing newline, so equal documents serialize to equal bytes. Where `JSON.stringify` silently drops or rewrites `undefined`, `NaN` and non-plain objects, it fails typed instead — `NonJsonValueError` carries a JSON pointer to the offending value, and `JsonDepthExceededError` catches hostile nesting and cycles.

## Features

- `StoreDocument` — the assembly pipeline: `fromSchema` / `fromSchemaResult`, the `draft07` constructor for hand-built documents, the flat `toJson()` publication shape, `serializeResult()`, the `DRAFT_07_META_SCHEMA` constant and `SchemaConversionError`.
- `KeywordFamilies` — the one registry of declared keyword families (upstream language-server families plus the house `x-ai-` machine-annotation namespace), consumed by both the `fromSchema` gate and the lint so they cannot disagree.
- `SchemaVersioning` / `SchemaVersion` — full-SemVer version labels with `parseResult` / `parse`, the `Order` instance and `latest`, `isPinned` and `next` for the contract-change version bump, plus `fileName`, `schemaUrl` and `catalogUrls` deriving both catalog modes.
- `CatalogEntry` — the `catalog.json` entry as a `Schema.Class`, `assemble` and the `fileMatch` hygiene lint (`CatalogLintFinding`).
- `DocumentLint` — the total structural lint returning `DocumentLintFinding` values, never an error.
- `SchemaValidator` — real-engine validation, closed by default over ajv: provide `SchemaValidator.layer` and it works. `ValidationFinding`, `SchemaValidatorError`, `noop` to switch validation off and the `makeTest` / `layerTest` doubles.
- `DocumentDiff` — `classify` puts two documents in `"none"` / `"annotations"` / `"contract"`, the signal for whether a change needs a new schema version, plus `isClean` for the clean case.
- `SchemaPipeline` — the emit loop over a target manifest, two-phase and all-or-nothing across targets: `run` and `check`, the single-target `runOne` and `checkOne`, `PipelineFinding`, `SchemaGateError` and an overridable gating predicate, plus the contract gate (`ContractChangePolicy`, `ContractChangeTarget`, `SchemaContractChangeError`, `PipelineCheckResult.contractBlocked`) that refuses to rewrite a published document's validation contract in place.
- `SchemaFile` — write-if-changed IO over core `FileSystem` / `Path`, comparing by content and answering what changed as a value; `check` is the non-writing drift half, answering `wouldWrite` alongside `change`.
- `SchemaTarget` — the target manifest vocabulary: schema, `$id`, destination path, an optional name and an optional version that requires one.
- `CanonicalJson` — the deterministic serializer with typed failures (`NonJsonValueError`, `JsonDepthExceededError`).

## License

[MIT](LICENSE)
