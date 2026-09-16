# @effected/schemastore-cli

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The `schemastore` command: build and check SchemaStore-shaped JSON Schema documents from a `schemastore.config.ts`. It is the companion to [`@effected/schemastore`](https://www.npmjs.com/package/@effected/schemastore), which owns the pipeline and every type a config needs; this package ships the plumbing every consumer used to write by hand — the config loader, the drift policy, the frozen-label checks, the catalog file, exit codes, a GitHub step summary — once, as a `bin`. It is also where the validation engine lives: `AjvValidator`, ajv in strict mode, composed by the command and exported for a program that drives the pipeline itself, so the library stays free of ajv.

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

The two packages release together at one version. The library is a regular dependency (the application reads its schema's identity from it at runtime); the command is a devDependency.

```bash
pnpm add @effected/schemastore effect
pnpm add -D @effected/schemastore-cli
```

`effect` and `@effected/schemastore` are peers of the command, so your config and the pipeline share one instance of each.

## Configure

Declare each schema's hosted identity once, in the application, next to the schema — the application writes `$schema` from it, and the config hands the same value to `defineConfig` so nothing is spelled twice:

```ts
// src/schema/output.ts
import { HostedSchema } from "@effected/schemastore";
import { Schema } from "effect";

export const OUTPUT_SCHEMA_VERSION = "5.2";

export const OutputSchemaIdentity = HostedSchema.github({
  repo: "savvy-web/silk-release-action",
  path: "schemas",
  name: "silk-release-action.output",
  versions: [OUTPUT_SCHEMA_VERSION],
});

export const ReleaseOutput = Schema.Struct({
  $schema: Schema.Literal(OutputSchemaIdentity.$id),
  status: Schema.Literals(["released", "skipped"]),
});
```

```ts
// schemastore.config.ts (also .mts, .js, .mjs; found by walking upward, or passed as the positional argument)
import { defineConfig } from "@effected/schemastore";
import { OutputSchemaIdentity, ReleaseOutput } from "./src/schema/output.js";

export default defineConfig({
  // Relative paths resolve against this file's directory.
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

`schema:build` writes `schemas/5.2/silk-release-action.output-5.2.json`; `schema:check` in CI fails whenever a build would write anything. Bumping the version is one constant, and once a label has shipped it stays in `versions` as a frozen file the command verifies but never regenerates.

A schema published to SchemaStore itself uses `HostedSchema.schemastore` and declares its catalog entry; the command assembles every entry into one `catalog.json`:

```ts
export default defineConfig({
  outputDir: "schemas",
  schemas: {
    okfit: {
      schema: OkfitConfig,
      hosted: HostedSchema.schemastore({ name: "okfit", versions: ["1.0"] }),
      published: true,
      catalog: { description: "okfit configuration", fileMatch: ["okfit.toml", ".okfit.toml"] },
    },
  },
});
```

### The entry contract

- The key IS the schema's `name`; `$id`, the write `path` and every catalog URL derive from it and the identity. There is no `$id` override. With `hosted`, the key must equal `hosted.name` and `baseUrl` / `versions` / `current` / `layout` must not be spelled beside it; without `hosted`, spell those fields (and a top-level `baseUrl` default) and the command builds the identity for you.
- `versions` lists every label the catalog advertises; `current` (default: the newest) is the one generated at `path` / `$id`. Every other label is **frozen**: it must exist on disk and declare the `$id` the config derives for it, or the build fails before anything is written (`FrozenVersionMissingError`, `FrozenVersionIdMismatchError`). A `repo` / `branch` / `path` / `baseUrl` change is therefore a re-publish event for every frozen label. Declare a single label on a first run; append the next only once the first has shipped.
- `appendVersion` (default `true`) keeps SchemaStore's `-<version>` file suffix; `false` lets the version directory name the file alone (`schemas/6.0/output.json`) and requires the `"versioned"` layout. Like `baseUrl`, it belongs to `hosted` when that is given, and flipping it is a re-publish event for every frozen label.
- `published` (default `false`) marks a version other people already depend on: an unpublished schema regenerates in place through any change, a published one is held to the drift policy.
- `drift` (`strict` / `semantic` / `allow`, default `semantic`) and `onDrift` (`error` / `warn`) are top-level defaults; `drift`, `published`, `jsonSchema` and `rootAnnotations` may be set per entry. Objects are emitted closed (`additionalProperties: false`); `jsonSchema: { onExcessProperty: "ignore" }` reopens one document.
- `catalog` is required under SchemaStore hosting and optional under a custom host; every entry lands in ONE file at `catalogPath` (default `<outputDir>/catalog.json`).
- A typo'd key anywhere in the config is named and rejected, never ignored, and every issue on an entry is reported at once.

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
```

- Before anything is generated, every frozen label is verified — present on disk, and self-identified by the derived `$id`.
- `build` generates every schema, runs the gates (the structural lint and ajv strict mode), applies the drift policy, and writes what passes — content-compared, so an unchanged file is untouched — plus the catalog file when any entry declares one.
- `check` is the identical walk with no writes: it reports what `build` would do under the same flags and exits the same way, and also fails (exit `1`) whenever a build would write anything — a stale or missing document is fixed by running `schemastore build` and committing the result. A `catalog.json` left behind after the last `catalog` block was removed is reported `orphaned` and fails `check` the same way, but `build` never deletes it: delete the file by hand, or restore a `catalog` block.
- `--drift` and `--on-drift` override the config for one run; `--force` is sugar for `--drift=allow` (combined with a different explicit `--drift` it is a usage error).
- `--format=json` emits one JSON document on stdout (per-schema outcome and effective tolerance, the catalog outcome, `drift: { onDrift, policy? }`); human text moves to stderr. When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown table.

## The engine, as a library export

The command validates with ajv in strict mode — SchemaStore's own gate — registering the keyword families `@effected/schemastore` declares and the standard `ajv-formats` vocabulary (formats only, never the `formatMaximum` family), one fresh instance per document. The same layer is this package's one export, for a program composing the pipeline directly:

```ts
import { SchemaFile, SchemaPipeline } from "@effected/schemastore";
import { AjvValidator } from "@effected/schemastore-cli";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const AppLayer = Layer.mergeAll(SchemaFile.layer, AjvValidator.layer).pipe(Layer.provide(NodeServices.layer));

const program = SchemaPipeline.run(targets).pipe(Effect.provide(AppLayer));
```

Findings come back as values; the error channel carries `SchemaValidatorError` only when the engine fails as a mechanism.

## Exit codes

| code | meaning |
| ---- | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error` (one line per drifting schema: `$id`, change, current and next version), a gate failure, a missing or mis-identified frozen version, or — for `check` — anything `build` would write or an orphaned catalog file (which `build` never deletes: remove it by hand, or restore a `catalog` block) |
| 2 | config not found, failed to load, or failed `defineConfig` validation |
| 3 | infrastructure failure |
| 64 | usage error |

## License

MIT
