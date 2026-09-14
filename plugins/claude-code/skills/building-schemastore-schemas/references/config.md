# The config file

`schemastore.config.ts` is the whole schema setup of a repository: which
Effect Schemas become documents, which of those are published, what the
SchemaStore catalog entry says, and how much drift a build tolerates. The
CLI finds it by walking upward from the working directory (`.ts`, `.mts`,
`.js`, `.mjs` are all recognised), or takes an explicit path as the
positional argument — the form repositories with a `lib/scripts/` convention
use.

The module is loaded through `jiti` created against the config file's own
path, so its relative specifiers and its `effect` / `@effected/schemastore`
imports resolve from the consumer's tree, never from the CLI's. That is what
keeps the config and the pipeline on one `effect` and one
`@effected/schemastore` instance: the `SchemaTarget` you construct must be the
class the pipeline matches, and the annotation symbols on your schema must be
the ones core's `Schema.toJsonSchemaDocument` reads. Install
`@effected/schemastore` and `@effected/schemastore-cli` at the same version —
they release together as a fixed pair, and the CLI's peer range on the
library is exact.

## `defineConfig`

The default export is a `defineConfig(...)` value. `defineConfig` is pure —
no IO, no Effect — and identity-with-validation over its input: it validates
the schema list, decodes the catalog and drift blocks, fills drift defaults,
assembles every catalog entry, and brands the result so the loader recognises
it. A malformed config fails typed at load (exit `2`) rather than as a
`TypeError` deep in the pipeline.

```ts
import { defineConfig, SchemaTarget } from "@effected/schemastore";
import { ReleaseOutput, SCHEMA_URL } from "./src/schema/release-output.js";

export default defineConfig({
  schemas: [
    SchemaTarget.make({
      schema: ReleaseOutput,
      $id: SCHEMA_URL,
      name: "silk-release-action",
      version: "5.0.0",
      path: "schemas/silk-release-action-5.0.0.json",
      published: true,
      jsonSchema: { onExcessProperty: "error" },
    }),
  ],
  catalog: [
    {
      name: "silk-release-action",
      description: "Structured output of the silk-release GitHub Action",
      fileMatch: ["silk-release-output.json"],
      baseUrl: "https://raw.githubusercontent.com/savvy-web/silk-release-action/main/schemas",
      path: "schemas/catalog-entry.json",
    },
  ],
  drift: { policy: "semantic", onDrift: "error" },
});
```

### `schemas` — at least one `SchemaTarget`

`SchemaTarget.make` takes:

| Field | Required | Meaning |
| --- | --- | --- |
| `schema` | yes | the Effect Schema the document is generated from |
| `$id` | yes | the canonical URL the document declares; non-empty |
| `path` | yes | where the document is written; non-empty, relative to the config file's directory |
| `name` | with `version` | the catalog/file base name; versioned naming is `<name>-<version>.json`, so a version without a name is a compile error (overload pair) and a runtime throw for untyped callers |
| `version` | for a versioned document | a `SchemaVersion` or a plain string label (`"5.0.0"`, `"1.2"`, `"2"`); an invalid label throws naming it |
| `published` | no, default `false` | whether a consumer already depends on this document at this label |
| `jsonSchema` | no | core's `ToJsonSchemaOptions`, forwarded to generation for this target only |

Omit `version` for an unversioned document (a single plain-named file). The
pipeline never reads `published`; the CLI does. Its generation options live
on the target, not on the pipeline, so each document is self-describing.

`defineConfig` rejects two spellings of one version under one name: `1.2`
and `1.2.0` are the same version (missing components read as `0` for
ordering), so declaring both is an error rather than two files.

### `catalog` — zero or more entries

Each entry carries the SchemaStore `catalog.json` fields — `name`,
`description`, `fileMatch`, `baseUrl` — plus `path`, where the assembled
entry is written. `name` must match at least one **versioned** schema, or
`defineConfig` throws.

Two fields are **derived**, never written by hand:

- `versions` — from every versioned schema of that `name`, published or not.
  The entry is what gets submitted to become published, so a draft label has
  to be in it before its flag flips.
- `url` and each `versions` value — as `<baseUrl>/<name>-<version>.json`,
  through `SchemaVersioning.schemaUrl`.

That derivation fixes the file layout: each versioned schema's `path` must
sit **directly under the directory `baseUrl` names**, and its `$id` must be
**that exact URL**. The CLI does not cross-check `$id` against the derived
URL, so a mismatch ships a catalog entry whose `versions` point at files that
do not exist. The convention is therefore a flat layout:

```text
schemas/
  catalog-entry.json
  my-tool-1.0.json
  my-tool-1.1.json
```

with `baseUrl: "https://…/main/schemas"` and each `$id` equal to
`https://…/main/schemas/my-tool-1.1.json`. A `schemas/<version>/` subdirectory
is not that convention: its `$id` sits under the subdirectory while the
derived URL does not, and the catalog entry 404s.

`fileMatch` is written through as given. SchemaStore reviewers reject generic
patterns (`*.json`, `config.toml`) and ask for complex globs to be expanded
into simple ones; `CatalogEntry.lintFileMatch(patterns)` answers those
findings as values, so a test can assert on them before a reviewer does.

### `drift` — the default policy for published schemas

`{ policy: "strict" | "semantic" | "allow", onDrift: "error" | "warn" }`,
both optional, defaulting to `{ policy: "semantic", onDrift: "error" }`
(`DriftPolicy.defaults`). Flags override it for one run; the report names the
effective policy and whether it came from `config` or `flag`.

## Path resolution

Relative `path` values, on schemas and catalog entries alike, resolve
against the **config file's directory**, never the working directory. A
root-level `schemastore build packages/x/schemastore.config.ts` and a
`pnpm --filter x schema:build` must write identical files. Absolute paths pass
through unchanged, so an existing `resolve(REPO_ROOT, …)` keeps working.

## Reading a config back in code

`isSchemastoreConfig(value)` recognises a `defineConfig` result — the check
the loader runs on a module's default export. A test that wants the same
targets the CLI sees imports the config module and reads `.schemas` and
`.catalog` (each catalog item is `{ config, entry }`, the declared block and
the assembled `CatalogEntry`).
