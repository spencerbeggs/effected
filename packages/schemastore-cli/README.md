# @effected/schemastore-cli

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The `schemastore` command: build and check SchemaStore-shaped JSON Schema documents from a `schemastore.config.ts`, and validate a payload against a published document. It is the companion to [`@effected/schemastore`](https://www.npmjs.com/package/@effected/schemastore), which owns the pipeline and every type a config needs; this package ships the plumbing every consumer used to write by hand — the config loader, the drift policy, the frozen-label checks, the catalog file, exit codes, a GitHub step summary — once, as a `bin`. It is also where the validation engines live: `AjvValidator` (documents) and `AjvInstanceValidator` (payloads), both ajv in strict mode over one shared setup, composed by the commands and exported for a program that drives the pipeline or validates payloads itself, so the library stays free of ajv.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `^4.0.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
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
  // This config's identity: its catalog slice is catalogs/<name>.json.
  name: "silk-release-action",
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

A schema published to SchemaStore itself uses `HostedSchema.schemastore` and declares its catalog entry; the command assembles every entry into the config's catalog slice and the merged `catalog.json`:

```ts
export default defineConfig({
  name: "okfit",
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
- `name` (required, top-level) is the config's identity: a simple file base name, distinct among configs sharing a `catalogDir` — case-insensitively, since on a case-insensitive volume `docs` and `Docs` are one slice file that each build overwrites. When `<name>.json` is absent from the listing but the volume resolves it to a file differing only in case (a case-insensitive volume), that file is claimed as the config's slice and flagged on its report line; on a case-sensitive volume the file is another slice, so a case-only rename leftover blocks the merge until it is deleted, like any rename leftover.
- `catalog` is required under SchemaStore hosting and optional under a custom host. Every entry the config declares lands in ONE slice file, `<catalogDir>/<name>.json` (`catalogDir` defaults to `<outputDir>/catalogs`), and the command maintains the merged `catalog.json` in `catalogDir`'s parent — `<outputDir>/catalog.json` by default — as the union of every slice there, sorted by `url`. Several configs can therefore share one `outputDir`: each rewrites only its own slice, and whichever builds last writes the identical merged file, so `check` is green for all of them. `catalogDir` holds slices only: `defineConfig` rejects one that is `outputDir`, that is the merged catalog's own path, or that a derived document sits in. Every config that shares a merged catalog must share the same `catalogDir` — sibling directories merging into one `catalog.json` overwrite each other, and no single config can see it.
- A typo'd key anywhere in the config is named and rejected, never ignored, and every issue on an entry is reported at once.

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json]
```

- Before anything is generated, every frozen label is verified — present on disk, and self-identified by the derived `$id`.
- `build` generates every schema, runs the gates (the structural lint and ajv strict mode), applies the drift policy, and writes what passes — content-compared, so an unchanged file is untouched — plus the config's catalog slice when any entry declares one, and the merged catalog over every slice.
- `check` is the identical walk with no writes: it reports what `build` would do under the same flags and exits the same way, and also fails (exit `1`) whenever a build would write anything — a stale or missing document is fixed by running `schemastore build` and committing the result. A catalog slice left behind after the config's last `catalog` block was removed is reported `orphaned` and fails `check` the same way, but `build` never deletes it — and the merged catalog keeps advertising its entries until it is gone: delete the file by hand, or restore a `catalog` block; a merged `catalog.json` with no slice left is orphaned the same way. So is a document left behind under an old derived name — an `appendVersion` flip or a `layout` change moved its path, and nothing claims the old file any more: both commands probe the sibling shapes (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`, `<v>/<name>-<v>.json`) of every label the config still declares and report each one that exists as an orphaned document, failed by `check`, never deleted by `build`. Nothing else in `outputDir` is looked at, so sharing it with another config, a deploy folder, or the repository root is safe (unless two configs derive the same schema name and version under different layouts into it); a `name` change or a dropped label leaves a file the command cannot know about — delete those by hand. A catalog URL or entry name advertised more than once across the slices, or a slice that cannot be read or is not a catalog entry array (an undeclared key included), blocks the merged catalog: both commands fail (exit `1`) naming the URL or name and its slices or the invalid slice, and the merged file is left as it is until the configs or slices are fixed.
- `validate` answers the question the publication story exists for: does THIS payload conform to the published document it names? The reference is the `--schema` flag or the payload's own `$schema`, resolved file-first and then against every identity a config schema derives (a target `$id`, a frozen version's `$id`/`url`, the catalog `url`) — CI validates an action's output against the committed document with no third-party tool and no network fetch. The payload's `$schema` self-reference is the pointer naming the document: it is stripped before validating only when the resolved document does not declare `$schema` as a root property, since a generated document's `additionalProperties: false` would otherwise reject the very self-reference that names it. A document that does declare `$schema` — the `HostedSchema` pattern above, where the source struct carries `$schema: Schema.Literal(...)` and the generated document requires and const-constrains the key — validates the payload verbatim. A non-conforming payload fails (exit `1`) with one finding per problem, each carrying the JSON pointer into the instance and the keyword; `--format=json` writes one report document to stdout and moves the human lines to stderr.
- `--drift` and `--on-drift` override the config for one run; `--force` is sugar for `--drift=allow` (combined with a different explicit `--drift` it is a usage error).
- `--format=json` emits one JSON document on stdout (per-schema outcome and effective tolerance, the catalog slice and merged-catalog outcomes, the `orphaned` document paths when any, `drift: { onDrift, policy? }`); human text moves to stderr. When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown table.

## The engines, as library exports

The commands validate with ajv in strict mode — SchemaStore's own gate — registering the keyword families `@effected/schemastore` declares and the standard `ajv-formats` vocabulary (formats only, never the `formatMaximum` family), one fresh instance per document, through one shared setup both engines use so a document the `check` gate admits always compiles in the instance engine too. The two engine layers are this package's only exports, for a program composing the pipeline or validating payloads directly:

```ts
import { SchemaFile, SchemaPipeline } from "@effected/schemastore";
import { AjvValidator } from "@effected/schemastore-cli";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const AppLayer = Layer.mergeAll(SchemaFile.layer, AjvValidator.layer).pipe(Layer.provide(NodeServices.layer));

const program = SchemaPipeline.run(targets).pipe(Effect.provide(AppLayer));
```

```ts
import { InstanceValidator } from "@effected/schemastore";
import { AjvInstanceValidator } from "@effected/schemastore-cli";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const validator = yield* InstanceValidator;
  return yield* validator.validate(document, payload);
}).pipe(Effect.provide(AjvInstanceValidator.layer));
```

Findings come back as values — `ValidationFinding` pointers into the document for `AjvValidator`, `InstanceFinding` pointers into the payload for `AjvInstanceValidator`; the error channel carries `SchemaValidatorError` / `InstanceValidatorError` only when an engine fails as a mechanism.

## Exit codes

A failure is reported on stderr in the `@effected/cli` standard form: a status line naming the error and its message, the message's further lines, and, when the failure happened inside one of the command's spans, an `in: …` line naming them (a missing config, raised before any span, prints none). It is painted at a terminal, plain for an agent, and written for the log under GitHub Actions. Read the exit code, not the line's shape.

| code | meaning |
| ---- | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error` (one line per drifting schema: `$id`, change, current and next version), a gate failure, a missing or mis-identified frozen version, a merged catalog blocked by a URL or name advertised twice or an invalid slice, — for `check` — anything `build` would write or an output nothing claims (an orphaned catalog slice or merged catalog, or an orphaned document at a sibling shape of a derived path), or — for `validate` — a payload that does not conform to the resolved document (one finding per problem, pointer and keyword each) |
| 2 | config not found, failed to load, failed `defineConfig` validation, a `catalogDir` that is a file or cannot be listed (checked before anything is written), or — for `validate` — a payload that cannot be read or parsed, or a `--schema`/`$schema` reference that is neither an existing file nor an identity any config schema derives, or names a document that cannot be read or parsed |
| 3 | infrastructure failure (for `validate`, an engine mechanism failure — a document the instance engine cannot compile — included) |
| 64 | usage error (for `validate`, a payload with no `$schema` and no `--schema` given, included); `--wizard` is the kit's prompt-gated flag, so a run that is not interactive (a pipe, CI, an agent) leaves it out of help and rejects it at `64` (it was accepted at `0` before the command moved onto `CliRuntime.main`) |

## License

MIT
