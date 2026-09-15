# @effected/schemastore

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Publish Effect Schemas as SchemaStore-shaped Draft-07 JSON Schema documents. Core `effect` already generates JSON Schema (`Schema.toJsonSchemaDocument`) and lowers it to Draft-07 (`JsonSchema.toDocumentDraft07`); this package owns what [SchemaStore](https://www.schemastore.org) and the editors expect around that output — the publication shape, the hosted identity a document is published under, the keyword-family gate, catalog entries, lints, versioning, canonical JSON and content-comparing file IO — and the [`schemastore`](https://www.npmjs.com/package/@effected/schemastore-cli) command runs all of it from one config file.

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

## Install

Two packages, one version, two roles: this library is a regular dependency of the application that publishes a schema (its code reads the schema's identity at runtime), and the command is a devDependency that builds and checks the documents.

```bash
pnpm add @effected/schemastore effect
pnpm add -D @effected/schemastore-cli
```

Requires Node.js >=24.11.0. ESM-only. `effect` v4 is the only peer; `@effected/semver` (version ordering) is the only runtime dependency. There is no validation engine here — `SchemaValidator` is a contract, and the shipped ajv strict-mode engine is `AjvValidator` in the CLI — so importing this package at runtime never installs or bundles ajv.

## How the two packages fit together

The pattern has three parts. The application declares each schema's **hosted identity** once, next to the schema, and reads the `$schema` URL it writes into its own output from it. The config file hands the same values to `defineConfig`. The command derives every path, `$id` and catalog URL from them, so nothing is spelled twice.

```ts
// src/schema/output.ts — the application
import { HostedSchema } from "@effected/schemastore";
import { Schema } from "effect";

export const OUTPUT_SCHEMA_VERSION = "5.2";

export const OutputSchemaIdentity = HostedSchema.github({
  repo: "savvy-web/silk-release-action",
  path: "schemas",
  name: "silk-release-action.output",
  versions: [OUTPUT_SCHEMA_VERSION],
});

// Every payload the application emits names the document it was written against.
export const ReleaseOutput = Schema.Struct({
  $schema: Schema.Literal(OutputSchemaIdentity.$id),
  status: Schema.Literals(["released", "skipped"]),
});
```

```ts
// schemastore.config.ts — the config
import { defineConfig } from "@effected/schemastore";
import { OutputSchemaIdentity, ReleaseOutput } from "./src/schema/output.js";

export default defineConfig({
  outputDir: "schemas",
  schemas: {
    [OutputSchemaIdentity.name]: { schema: ReleaseOutput, hosted: OutputSchemaIdentity },
  },
});
```

```json
{
  "scripts": {
    "schema:build": "schemastore build",
    "schema:check": "schemastore check"
  }
}
```

`schemastore build` writes `schemas/5.2/silk-release-action.output-5.2.json` with `$id` equal to `OutputSchemaIdentity.$id`, closed objects (`additionalProperties: false`), and the `$schema` literal the application asserts. `schemastore check` is the CI gate: it fails when a build would write anything. Bumping the version is one constant. Everything the command does — the drift policy, the `published` flag, frozen labels, the catalog file, exit codes — is documented on the [CLI's page](https://www.npmjs.com/package/@effected/schemastore-cli).

`HostedSchema.github({ repo, branch?, path?, ... })` serves files raw from a repository (`branch` defaults to `main`); `HostedSchema.schemastore({ name, ... })` publishes to SchemaStore (`$id` on `json.schemastore.org`, the catalog URL on `www.schemastore.org`, flat layout); `HostedSchema.custom({ baseUrl, ... })` takes any `https://` directory as a string or `URL`. Each validates the identity — `current` must be one of `versions`, two spellings of one label are refused — and throws a plain `Error` naming the reason. `$id`, `url` and `fileName` answer the current document; `idFor`, `urlFor` and `fileNameFor` answer any advertised version. Versioned files carry SchemaStore's `-<version>` suffix by default; when the version directory should name the file alone (`schemas/6.0/output.json`, natural when the repository already names the tool), pass `appendVersion: false` — it needs the `"versioned"` layout, since under `"flat"` every version would share one file name. A consumer test pins `target.path === \`${outputDir}/${identity.fileName}\`` to catch a swapped `hosted:` the CLI cannot see.

## Using the library directly

Everything the command composes is exported, for a program that needs one piece or wants to drive the pipeline itself.

`StoreDocument.fromSchema` runs the assembly for one schema — 2020-12 generation, Draft-07 lowering, the `#/definitions` → `#/$defs` rewrite and the keyword-family gate — so every `$ref` in a built document resolves against its `$defs` pool:

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
// { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "…", "type": "object", …, "additionalProperties": false }
```

Objects are closed by default — a published document is a contract, and this package does not follow core's open default. `jsonSchema: { onExcessProperty: "ignore" }` on one target (or one `defineConfig` entry) reopens that document.

`SchemaPipeline.run(targets)` is the emit loop over a target manifest — generate, lint, validate, gate, write — requiring `SchemaFile` and `SchemaValidator` in `R`. Provide the file service and an engine at the edge; the engine is the CLI's:

```ts
import { SchemaFile, SchemaPipeline, SchemaTarget } from "@effected/schemastore";
import { AjvValidator } from "@effected/schemastore-cli";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

const targets = [
  SchemaTarget.make({
    schema: Schema.Struct({ name: Schema.String }),
    $id: "https://example.com/config.schema.json",
    path: "schemas/config.schema.json",
  }),
];

const program = SchemaPipeline.run(targets).pipe(
  Effect.provide(Layer.mergeAll(SchemaFile.layer, AjvValidator.layer).pipe(Layer.provide(NodeServices.layer))),
);
```

`run` is two-phase and all-or-nothing across targets: every target is generated, gated and — for a pinned version — classified against its predecessor before any file is written. A blocking finding fails with `SchemaGateError`; a contract change on a pinned, published version fails with `SchemaContractChangeError` carrying the `nextVersion` to publish under instead (`contractChanges: "allow"` classifies and reports only). `check` is the same walk with no writes. Findings are values, never logs, and the gating predicate (`blocking`) is yours to replace.

## What the library owns

- `HostedSchema` — a schema's hosted identity (`github`, `schemastore`, `custom`), deriving `$id`, the catalog URL and the file name for the current or any advertised version.
- `defineConfig` — the `schemastore.config.ts` contract: validated with one `Schema.Struct` per level (a typo'd key is named, every issue on an entry reported at once), every path and URL derived from the entry key and its identity, frozen labels resolved, a branded result the CLI recognises.
- `StoreDocument` — assembly: `fromSchema` / `fromSchemaResult`, the `draft07` constructor for hand-built documents, the flat `toJson()` publication shape, `serializeResult()`, `DRAFT_07_META_SCHEMA`.
- `KeywordFamilies` — the one registry of declared non-standard keyword families (the vscode five, `x-taplo`, `x-tombi-`, `x-intellij-`, and the house `x-ai-` machine-annotation namespace). Anything outside it fails `fromSchema` with `UndeclaredAnnotationKeyError`; nothing is silently dropped.
- `SchemaVersioning` / `SchemaVersion` — one-to-three-component version labels, `Order`, `latest`, `isPinned`, `next`, and the `fileName` / `schemaUrl` / `catalogUrls` derivations.
- `CatalogEntry` — the `catalog.json` entry as a `Schema.Class`, `assemble` for both catalog modes, and the `fileMatch` hygiene lint.
- `DocumentLint` — the total structural lint (`UnresolvedRef`, `UnknownKeyword`, `DepthExceeded`, `DescriptionWithoutUrl`, …), findings as values.
- `SchemaValidator` — the validation contract: `noop` switches it off, `makeTest` / `layerTest` are the doubles; `ValidationFinding` and `SchemaValidatorError` are its values. The engine is `AjvValidator` in `@effected/schemastore-cli`.
- `DocumentDiff` — `classify` two documents as `"none"` / `"annotations"` / `"contract"`, the signal for whether a change needs a new version.
- `DriftPolicy` — the lifecycle rule the CLI applies: `published` documents are held to a tolerance (`strict` / `semantic` / `allow`), unpublished ones regenerate in place.
- `SchemaPipeline` — the emit loop: `run` / `check`, `runOne` / `checkOne`, the gate and the contract guard.
- `SchemaFile` — write-if-changed IO over core `FileSystem` / `Path`, comparing by parsed content so a formatter that owns the file's text does not churn it; `check` is the non-writing half.
- `CanonicalJson` — the deterministic serializer (insertion order, tabs, one trailing newline, typed failures) and `equals`, the one content-equality rule.

## License

MIT
