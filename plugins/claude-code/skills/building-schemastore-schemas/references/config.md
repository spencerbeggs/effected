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

The default export is a `defineConfig(...)` value: a required config
`name`, and the schemas keyed by schema name.
`defineConfig` is pure — no IO, no Effect — and validates the whole input,
derives every `$id`/`path`/catalog URL from ONE layout, fills drift
defaults, assembles every catalog entry, and brands the result so the
loader recognises it. A malformed config fails typed at load (exit `2`)
rather than as a `TypeError` deep in the pipeline.

```ts
import { defineConfig } from "@effected/schemastore";
import { OkfitConfig } from "./src/config-schema.js";

export default defineConfig({
  name: "okfit",
  outputDir: "schemas",
  baseUrl: "schemastore",
  schemas: {
    okfit: {
      schema: OkfitConfig,
      versions: ["1.0"],
      published: true,
      catalog: { description: "okfit configuration", fileMatch: ["okfit.toml", ".okfit.toml"] },
    },
  },
});
```

A first-run config declares a single label. A second label is appended to
`versions` only once the first is published and its file already exists on
disk — see "The lifecycle" in `drift-and-versioning.md`; naming an extra
label before its file exists fails the build with
`FrozenVersionMissingError`.

Self-hosted, the same entry takes
`baseUrl: "https://raw.githubusercontent.com/o/r/main/schemas"` and derives
`schemas/1.1/okfit-1.1.json` (the `"versioned"` layout) instead of the flat
SchemaStore file.

When the application also writes `$schema` into its own output, do not
re-derive that URL in `src/`. Build the identity once with `HostedSchema`
and hand the same value to both sides:

```ts
// src/schema/output.ts
import { HostedSchema } from "@effected/schemastore";
import { Schema } from "effect";

export const OutputSchema = HostedSchema.github({
  repo: "o/r", path: "schemas", name: "okfit", versions: ["1.0", "1.1"],
});
export const Output = Schema.Struct({ $schema: Schema.Literal(OutputSchema.$id) });

// schemastore.config.ts
schemas: { [OutputSchema.name]: { schema: Output, hosted: OutputSchema } }
```

`HostedSchema.github({ repo, branch = "main", path?, appendVersion?, ... })`,
`HostedSchema.schemastore({ name, ... })` and
`HostedSchema.custom({ baseUrl: string | URL, ... })` each validate the
identity and throw a plain `Error` naming the reason; `$id`, `url` and
`fileName` answer the current document, `idFor`/`urlFor`/`fileNameFor` any
advertised version.

### `schemas` — a record keyed by file base name

The key IS the schema's `name` — every derived `path`, `$id` and catalog
URL is built from it, `outputDir`, `baseUrl` and `layout` through ONE
`HostedSchema`, so they cannot disagree with each other. A typo'd key
anywhere in the config is named and rejected, never ignored. **There is no `$id` override.** The key must be a simple file base
name: non-empty, no separators, no whitespace.

| Field | Required | Meaning |
| --- | --- | --- |
| `schema` | yes | the Effect Schema the document is generated from |
| `hosted` | no | a `HostedSchema`; supplies `baseUrl`, `versions`, `current` and `layout`, which must then not be spelled here, and its `name` must equal the key |
| `versions` | no | every version label this schema advertises; omit for an unversioned schema. An empty array is rejected. Two labels that compare equal under `SchemaVersioning.Order` (`"1.2"` and `"1.2.0"`) are rejected as one version spelled twice |
| `current` | no, requires `versions` | which label is generated at this entry's `path`/`$id`; the rest become frozen files. Defaults to the newest label |
| `published` | no, default `false` | whether a consumer already depends on this document at this label |
| `baseUrl` | with a top-level default | `"schemastore"` (expands `$id` to `json.schemastore.org`, the catalog URL to `www.schemastore.org`, forces the `"flat"` layout) or an `https://` URL used as one base for both |
| `layout` | no | `"flat"` or `"versioned"`; defaults to `"versioned"` for a custom `baseUrl`, rejected under `baseUrl: "schemastore"` |
| `appendVersion` | no, default `true` | whether a versioned file carries the `-<version>` suffix; `false` gives `<version>/<name>.json` and requires the `"versioned"` layout. Owned by `hosted` when given |
| `drift` | no | overrides the config's top-level `drift` for this schema |
| `catalog` | required under `baseUrl: "schemastore"` | `{ description, fileMatch }` — the catalog entry to assemble for this schema |
| `jsonSchema` | no | core's `ToJsonSchemaOptions`, forwarded to generation for this target only; objects are closed by default, `{ onExcessProperty: "ignore" }` reopens this one document |
| `rootAnnotations` | no | forwarded to the target |

Every OTHER advertised version besides `current` becomes a **frozen**
file — one that already exists on disk, advertised by the catalog and
verified by the CLI before anything is generated, never regenerated. A
schema that advertises a frozen label with no file on disk fails the
build typed with `FrozenVersionMissingError`, and nothing is written for
any schema.

`defineConfig` rejects two spellings of one version under one name: `1.2`
and `1.2.0` are the same version (missing components read as `0` for
ordering), so declaring both is an error rather than two files.

### `name` — the config's identity

`name` is required and top-level: a simple file base name (no separators,
no whitespace), the base name of the catalog slice this config owns.
Configs whose catalogs share a directory — several `schemastore.config.ts`
files writing into one `outputDir` — must carry names distinct
**case-insensitively**: on a case-insensitive volume (macOS) `docs` and
`Docs` are one slice file, and each build silently overwrites the other.
When `<name>.json` is not listed but the volume resolves it to the one
file whose name matches only by case (a case-insensitive volume), the
config claims that file and its slice line says
`claimed <path> by case-folded match for "<name>"`. On a case-sensitive
volume nothing is claimed: that file is another slice, so a case-only
rename leftover blocks the merged catalog until you delete it, like any
rename leftover. Omitting it
fails with `defineConfig: name is required — the base name of this config's
catalog slice (<catalogDir>/<name>.json)`.

### `catalog` — one slice per config, one merged catalog

Each schema's `catalog` block carries `description` and `fileMatch`;
`name`, `url` and `versions` are **derived** from the schema's own key,
`baseUrl`, `layout` and `versions` — never written by hand, so a version
bump on a schema and its catalog entry cannot disagree. Every schema's
assembled entry lands in the config's **slice**, `<catalogDir>/<name>.json`
— a bare catalog entry array, never one file per schema, rewritten
wholesale so a removed schema's entry drops out. `catalogDir` defaults to
`<outputDir>/catalogs`.

The command also maintains the **merged** `catalog.json` in `catalogDir`'s
parent — `<outputDir>/catalog.json` by default, the URL a host serves —
as the union of every slice in `catalogDir`, sorted by `url`. The running
config's own slice is replaced by the entries it computes now (when it
declares any), so every config sharing the directory produces the
identical merged file and `check` is green for all of them once each has
built. A config that drops its last `catalog` block leaves its slice
orphaned: `check` fails on it, and the merged catalog keeps advertising
its entries until the slice is deleted by hand. Two slices
advertising one `url`, or a slice that is not a catalog entry array,
blocks the merged file (`CatalogMergeError`, exit `1`) until a config or
slice is fixed.

`catalogDir` holds slices only — every `*.json` file directly in it is
read as one — so `defineConfig` rejects a `catalogDir` that is
`outputDir`, that is the merged catalog's own path, or that a derived
document sits in. Keep hand-written files out of it. A slice that cannot
be read, or that carries a key a catalog entry does not declare, blocks
the merge like an unparseable one.

**Every config that shares a merged catalog must share the same
`catalogDir`, under names unique case-insensitively.** Two sibling directories (`schemas/catalogs` and
`schemas/more`) both merge into `schemas/catalog.json`, each from its own
slice set, and overwrite each other; no single config can see the other
directory, so nothing reports it.

That derivation fixes the file layout under a custom `baseUrl`: each
versioned schema's `path` sits directly under the directory `baseUrl`
names, and its `$id` is that exact URL by construction (there is no
override to drift from it). The convention is therefore a flat layout:

```text
schemas/
  catalog.json
  catalogs/
    my-tool.json
  my-tool-1.0.json
  my-tool-1.1.json
```

with `baseUrl: "https://…/main/schemas"` and each `$id` equal to
`https://…/main/schemas/my-tool-1.1.json`. Set `layout: "versioned"` (the
default for a custom `baseUrl`) to nest each version under its own
directory instead.

`fileMatch` is written through as given. SchemaStore reviewers reject generic
patterns (`*.json`, `config.toml`) and ask for complex globs to be expanded
into simple ones; `CatalogEntry.lintFileMatch(patterns)` answers those
findings as values, so a test can assert on them before a reviewer does.

### `drift` and `onDrift` — the default policy for published schemas

`drift` (`"strict" | "semantic" | "allow"`) is a top-level default an entry
may override; `onDrift` (`"error" | "warn"`) is top-level and run-wide,
never overridable per schema. Together they default to
`{ policy: "semantic", onDrift: "error" }` (`DriftPolicy.defaults`).
`--drift` overrides every schema's own tolerance for one run; `--on-drift`
overrides the config's top-level `onDrift`. The report gives every schema
its own effective `policy` regardless; a report-level `policy` field
appears only when a flag forced one tolerance over every schema's own.

## Path resolution

Relative `outputDir`, `catalogDir`, and every derived schema/frozen `path`
resolve against the **config file's directory**, never the working
directory. A root-level `schemastore build packages/x/schemastore.config.ts`
and a `pnpm --filter x schema:build` must write identical files. Absolute
paths pass through unchanged, so an existing `resolve(REPO_ROOT, …)`
`outputDir` keeps working.

## Reading a config back in code

`isSchemastoreConfig(value)` recognises a `defineConfig` result — the check
the loader runs on a module's default export. A test that wants the same
targets the CLI sees imports the config module and reads `.schemas`, an
array of `ResolvedSchema` (`{ name, target, frozen, drift, catalog? }`).
`SchemaTarget.make` survives unchanged as the library-level primitive for a
caller driving `SchemaPipeline` directly; `defineConfig` lowers each config
entry onto it.
