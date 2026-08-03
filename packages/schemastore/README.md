# @effected/schemastore

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Build, version and lint SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources. Core effect already owns the generation pipeline — `Schema.toJsonSchemaDocument` produces Draft 2020-12 and `JsonSchema.toDocumentDraft07` lowers it — and this package owns what [SchemaStore](https://www.schemastore.org) expects around that output: the publication shape (`$schema` + `$id` + root + `$defs`, with the `#/definitions` → `#/$defs` ref rewrite the lowering makes necessary), annotation carriers that keep the language-server keyword families alive through the lowering, catalog entries in both versioning modes, structural and hygiene lints, canonical JSON text, write-if-changed file IO and a validation contract seam a consumer closes with a real engine at the edge.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
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

Generating a JSON Schema from an Effect Schema is a solved problem — core does it. Publishing that schema where editors find it is not. SchemaStore recommends Draft-07 because that is what the language servers actually support, and core's Draft-07 lowering has two consequences a publisher must deal with: it rewrites `$ref` pointers to the canonical `#/definitions/...` form while the published document keeps its pool under `$defs`, and it drops every keyword outside its fixed copy-list — which is exactly where `markdownDescription`, `x-taplo` and the other editor keywords live. Around the document itself sits SchemaStore's own contract: ajv strict mode as the validation gate, catalog entries whose `fileMatch` patterns must not be generic and versioned schemas as suffixed files plus a `versions` map whose `url` points at the latest. This package is that last mile, so a build script does not have to reinvent it.

The scope is deliberately narrow. There is no schema construction here, no ref resolution beyond the document's own `$defs` pool, no dialect conversion and no JSON Schema engine anywhere in the runtime graph — core's `JsonSchema` owns the pipeline, ajv stays at the consumer's edge behind a contract, and this package owns the SchemaStore shape in between.

## Install

```bash
npm install @effected/schemastore effect
```

```bash
pnpm add @effected/schemastore effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency. `@effected/semver` rides along as a regular dependency — it does the version ordering inside `SchemaVersioning`, and no `SemVer` type surfaces in the public API. Every module is pure except `SchemaFile`, whose layer requires core `FileSystem` and `Path`, supplied at the edge from `@effect/platform-node` or `@effect/platform-bun`.

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

`fromSchema` runs the whole pipeline — 2020-12 generation, Draft-07 lowering, the `$ref` rewrite and the annotation re-graft — so every `$ref` in a built document already resolves against its `$defs` pool. `toJson()` is the flat publication shape (`$defs` omitted when empty) and `serializeResult` routes through the owned canonical serializer, tab-indented with a single trailing newline. A schema core cannot convert fails typed as `SchemaConversionError` carrying the `$id` and the structured cause.

## Two rules to read first

Two constraints bite consumers who do not know them, so they come before the feature tour:

- **Annotate at the definition site.** An annotation applied at a hoisted schema's *usage* site — `Person.annotate({ ... })` inside a struct field — reaches neither the `$ref` node nor the `$defs` pool entry, even before the Draft-07 lowering. It silently carries nothing. Put the annotation where the schema is defined.
- **Read version ordering from labels, never from key position.** A versioned catalog's `versions` map is a JSON object, and JavaScript enumerates integer-like keys first: a bare-major label like `"2"` serializes ahead of every dotted label regardless of insertion order. `SchemaVersioning.Order` and `SchemaVersioning.latest` order by the labels themselves; key position promises nothing.

## Carrying language-server annotations

SchemaStore documents lean on non-standard keywords the editors read: the vscode-json-languageservice set (`markdownDescription`, `defaultSnippets`, `enumDescriptions`, `markdownEnumDescriptions`, `allowTrailingCommas`), taplo's `x-taplo` keys, tombi's `x-tombi-*` and IntelliJ's `x-intellij-*`. Effect Schema annotations accept arbitrary string keys, so `Schema.String.annotate({ "x-taplo": { ... } })` type-checks with no module augmentation — but core's Draft-07 lowering copies a fixed keyword subset and would drop them. `StoreDocument.fromSchema` re-grafts the declared families onto the lowered document with a parallel walk (`AnnotationCarriers`), so the annotation you wrote is the keyword that ships:

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

The declared families are always admitted — `KeywordFamilies` is the one registry, consumed by both the carriers and the lint, so the two cannot drift on what counts as declared. A caller-supplied `includeAnnotationKey` predicate is consulted in addition, but know the boundary: keys it admits outside the declared families reach the Draft 2020-12 document and are still dropped by the lowering.

## Catalog entries and versioning

`CatalogEntry` is the `catalog.json` entry as a `Schema.Class`, so decoding an existing entry and encoding one for submission are the same artifact. `SchemaVersion` is SchemaStore's own label grammar — `major[.minor[.patch]][-prerelease]`, leading zeros rejected — not strict SemVer: `1.2` is a valid catalog label that a SemVer parser rejects. Ordering pads labels to full SemVer internally, so `1.10` sorts above `1.9` numerically and the label round-trips verbatim.

`CatalogEntry.assemble` derives both catalog modes from the same inputs. Pass `versions` for the versioned mode — the `versions` map carries every label and `url` points at the latest version's file — or omit it for the unversioned single-file mode. An empty `versions` array is a contradiction and throws; pass `undefined` instead.

```ts
import { CatalogEntry, SchemaVersioning } from "@effected/schemastore";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const versions = yield* Effect.forEach(["1.9", "1.10"], SchemaVersioning.parse);
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
// => "https://example.com/schemas/mytool-1.10.json"
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

SchemaStore's own gate is ajv strict mode, and `SchemaValidator` is the seam that reaches it without ajv ever entering this package's dependency graph. The contract's channel convention: findings are values — an ajv strict-mode compile failure is a report, not an error — and the error channel is reserved for the engine failing as a mechanism (`SchemaValidatorError`). The package ships `noop` (validates nothing) and `makeTest` / `layerTest` (unstubbed members die naming themselves); the consumer closes the seam at the application edge:

```ts
import { SchemaValidator, StoreDocument, ValidationFinding } from "@effected/schemastore";
import Ajv from "ajv";
import { Effect, Layer, Schema } from "effect";

const AjvValidator = Layer.succeed(SchemaValidator, {
  validate: (document, options) =>
    Effect.sync(() => {
      const ajv = new Ajv({ strict: options?.strict !== false, allErrors: true });
      try {
        ajv.compile(document);
        return [];
      } catch (error) {
        return [ValidationFinding.make({ path: "", message: String(error) })];
      }
    }),
});

const program = Effect.gen(function* () {
  const validator = yield* SchemaValidator;
  const document = yield* StoreDocument.fromSchema(Schema.Struct({ name: Schema.String }), {
    $id: "https://example.com/config.schema.json",
  });
  return yield* validator.validate(document.toJson());
});

Effect.runPromise(Effect.provide(program, AjvValidator)).then(console.log);
// [] when the document compiles clean; the engine's findings otherwise
```

`validate` takes the flat serialized record — `StoreDocument.toJson()`'s shape — so the seam stays engine-shaped and decoupled from this package's classes.

## Writing schema files

`SchemaFile` is the package's one IO surface: serialize through the canonical serializer, compare against what is on disk and write only on difference, creating parent directories as needed. The outcome is a value, so a generator committed to a repo does not churn mtimes, and a CI drift check is `read` plus compare:

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
  return [first, second] as const;
}).pipe(
  Effect.provide(SchemaFile.layer),
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

Effect.runPromise(program).then(console.log);
// => ["written", "unchanged"]
```

Failures stay typed and apart: `SchemaFileNotFoundError` for a missing file on `read`, `SchemaFileReadError` when the comparison read fails for any other reason (the write fails rather than silently overwriting), `SchemaFileWriteError` for the filesystem write and `CanonicalJsonError` when the document does not serialize.

## Canonical JSON

`CanonicalJson` is the deterministic serializer behind `serializeResult` and `SchemaFile.write`: insertion-order keys (assembly owns ordering — nothing is sorted), tab indentation by default, LF line endings and a single trailing newline, so equal documents serialize to equal bytes. Where `JSON.stringify` silently drops or rewrites `undefined`, `NaN` and non-plain objects, it fails typed instead — `NonJsonValueError` carries a JSON pointer to the offending value, and `JsonDepthExceededError` catches hostile nesting and cycles.

## Features

- `StoreDocument` — the assembly pipeline: `fromSchema` / `fromSchemaResult`, the flat `toJson()` publication shape, `serializeResult()`, the `DRAFT_07_META_SCHEMA` constant and `SchemaConversionError`.
- `AnnotationCarriers` / `KeywordFamilies` — the post-lowering re-graft and the one registry of declared keyword families, consumed by both the carriers and the lint so they cannot disagree.
- `SchemaVersioning` / `SchemaVersion` — the store-native label grammar with `parseResult` / `parse`, the `Order` instance and `latest`, plus `fileName`, `schemaUrl` and `catalogUrls` deriving both catalog modes.
- `CatalogEntry` — the `catalog.json` entry as a `Schema.Class`, `assemble`, and the `fileMatch` hygiene lint (`CatalogLintFinding`).
- `DocumentLint` — the total structural lint returning `DocumentLintFinding` values, never an error.
- `SchemaValidator` — the real-engine contract seam: `ValidationFinding`, `SchemaValidatorError`, `noop` and the `makeTest` / `layerTest` doubles.
- `SchemaFile` — write-if-changed IO over core `FileSystem` / `Path`, answering `"written" | "unchanged"` as a value.
- `SchemaTarget` — the target manifest vocabulary: schema, `$id`, name, destination path and optional version.
- `CanonicalJson` — the deterministic serializer with typed failures (`NonJsonValueError`, `JsonDepthExceededError`).

## License

[MIT](LICENSE)
