---
type: Interface
title: "The effected schema commands: build, check and validate"
description: "The contract of effected schema build, check and validate: the config file they load, the drift table and onDrift policy, the flags, the exit codes, the version-mismatch refusal, the catalog slices and merged catalog, and the human, JSON, CI and step-summary reports; the MCP tools return the same verdicts as data."
status: draft
kind: cli
resource: ../../packages/cli/src/commands/schema
tags:
  - dx
  - ci
  - release
sources:
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-04-effected-schema-design.md
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-04T00:00:00Z
  - id: runner
    resource: ../../packages/engine/src/schema/Runner.ts
  - id: schema-run
    resource: ../../packages/engine/src/schema/SchemaRun.ts
  - id: execute
    resource: ../../packages/cli/src/commands/schema/execute.ts
  - id: pipeline
    resource: ../../packages/schemastore/src/SchemaPipeline.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: 51439ce904e44038
---

# The effected schema commands: build, check and validate

`effected schema` is the command-line half of
[`@effected/schemastore`](../modules/schemastore.md): it loads a
`schemastore.config.ts`, builds or checks every schema and catalog entry the
config declares under a per-schema `published` flag and a drift policy, and
validates a payload against a published document. It is a command of the
[effected tool](../decisions/one-tool-beside-the-libraries.md): the flags and exit
codes live in [`@effected/cli`](../modules/cli.md), the logic in
[`@effected/engine`](../modules/engine.md)'s `./schema` subpath, and the
[`effected-mcp`](../modules/mcp.md) tools answer the same verdicts as data
([why it moved here](../decisions/schema-commands-live-in-the-tool.md)).[^design]

```text
effected schema build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json] [--ignore-version-mismatch]
effected schema check [config] [--drift=…] [--on-drift=…] [--force] [--format=human|json] [--ignore-version-mismatch]
effected schema validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json] [--ignore-version-mismatch]
```

## The config contract

The commands load a config module, `schemastore.config.ts` (also `.mts`, `.js`,
`.mjs`), found by walking upward from the working directory, or the file named
by the optional positional argument. Within one directory the order is the one
just listed, so `.ts` beats `.mjs`. Whichever way it is found, a missing config
is `NoConfigError` at exit `2`, and its message names the file names looked for,
the directories searched and an example using a path.

The module is loaded through `jiti` created against the **config file's own
path**, so its relative specifiers and its `effect` / `@effected/schemastore`
imports resolve from the consumer's tree, never from the tool's. The default
export is a `defineConfig(...)` value from `@effected/schemastore`, which the
carrier re-exports as `defineSchemastore`, so a config can import it from
`@effected/plugin` (the carrier's root stays cheap to import: it reaches no front
end, no ajv and no Ink). The fields, the hosting and version rules and the
`HostedSchema` shorthand are
[the library's](../modules/schemastore.md#the-config-contract-defineconfig-drift-and-published);
what the commands add is below.

```ts
import { defineSchemastore } from "@effected/plugin";
import { OkfitConfig } from "./src/config-schema.js";

export default defineSchemastore({
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

- The loader re-checks the shapes a forged brand could carry past
  `defineConfig` by decoding the export against one Schema struct of every field
  the pipeline and the drift policy dereference, and reports every issue at once
  as `ConfigLoadError` (exit `2`) before any path is resolved. The decode only
  validates; the module's own export, brand intact, is what loads.
- Relative `outputDir`, `catalogDir` and every derived schema or frozen `path`
  resolve against the **config file's directory**, never the working directory,
  so `effected schema build packages/x/schemastore.config.ts` from the root and a
  filtered package script write identical files. Absolute paths pass through.
- `name` is the config's identity and the base name of the catalog slice it owns.
  `catalogDir` defaults to `<outputDir>/catalogs`, so the merged catalog lands at
  `<outputDir>/catalog.json`. Every config sharing a merged catalog must share
  one `catalogDir`, and their `name`s must be distinct **case-insensitively**: on
  a case-insensitive volume `docs` and `Docs` name one slice file and overwrite
  each other with both builds exiting `0`, which a bare-array slice cannot
  detect. A `catalogDir` that is `outputDir`, the merged catalog's own path, or a
  directory a derived document sits directly in is rejected, by `defineConfig`
  and again by the loader on resolved paths.
- `onDrift` is run-wide and top-level only; `drift` is a top-level default each
  schema may override; command-line flags override the effective policy for one
  run.
- The config is evaluated afresh on every call, along with the TypeScript and
  JSON it imports; what that cannot reach is
  [a limitation of the long-lived server](../limitations/mcp-config-reload-cache.md).

## Drift

`SchemaPipeline` classifies each target's change as `none`, `created`,
`annotations` (documentation-only keywords) or `contract` (anything a validator
asserts or a tool writes into an instance).[^pipeline] The commands add the
lifecycle dimension the library lacks: whether anyone depends on the label yet.
`SchemaPipeline`'s own `block-versioned` guard is switched off
(`contractChanges: "allow"`), and the `Runner` applies `DriftPolicy.classify`
over each `check` result itself.

| published | policy | `none` / `created` | `annotations` | `contract` |
| ----------- | ------------ | -------------------- | --------------- | ---------------------- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | **drift** |
| `true` | `strict` | write | **drift** | **drift** |

`onDrift` then decides what **drift** means:

- `error` (the default): nothing is written for ANY schema, because a partial
  write would leave a repository half-bumped; exit `1` with `DriftError`, which
  carries `drifted: [{ $id, change, version?, nextVersion? }]` and renders one
  line per schema, then the two ways out: bump the version in the config, or
  `--force`.
- `warn`: write anyway, exit `0`, one warning per drifting schema. This is the
  posture for an automated dependency-bump workflow, where the bump should land
  and the summary should shout.

Two rules never move: an **unpublished** schema is never drift (a `contract`
change at a pinned but unpublished version rewrites the file in place), and
**gate failures are not drift**: lint warnings and ajv strict-mode findings fail
both commands regardless of `onDrift`, because a document the editors cannot
load has no warn-and-write mode.

## Commands

- Before anything is generated, the `Runner` walks every advertised frozen
  version. A label with no file on disk fails typed with
  `FrozenVersionMissingError` (reported first). A file that is there is read and
  must declare the `$id` its `FrozenVersion` entry derives; a different `$id`,
  none, or text that does not parse fails `FrozenVersionIdMismatchError`,
  carrying `mismatched: [{ name, version, path, expected, actual?, reason }]`
  with `reason` one of `"mismatch"`, `"absent"` or `"unparseable"`. Either way
  nothing is written for any schema (exit `1`): a catalog must never point a
  frozen label at a 404, and a `baseUrl` change is a re-publish event for every
  frozen label.[^runner]
- `build` generates, gates, applies the drift table, writes what passes
  (content-compared, so unchanged files are untouched) and writes the config's
  catalog slice and the merged catalog the same way. Each catalog file is read
  once (`NotFound` means absent, so a build creates it) and compared by parsed
  content with the library's `CanonicalJson.equals`, so key order is a
  serialization detail and unparseable text is simply different and gets
  repaired. Both modes also probe the sibling shapes of every derived path
  (`SchemaVersioning.fileName` has exactly four per name and label) for every
  label the config still declares, and report each FILE that exists and that no
  target, frozen version, catalog slice or merged catalog claims as `orphaned`:
  the document an `appendVersion` flip or a `layout` change left behind. Stale
  under `check`, reported but **never deleted** under `build`. Nothing else on
  disk is read: `outputDir` is never listed, because it may be shared with
  another config or the repository root ([why](../decisions/output-dir-is-never-exclusively-owned.md)).
- `check` is the identical walk with **no writes**, and because it is the CI
  drift gate it ALSO exits `1` whenever a build would write anything: a committed
  schema or catalog entry that differs from what the config generates, or is
  missing, is stale, and the message says to run `effected schema build` and
  commit the result (`StaleError`, evaluated after the gate and drift verdicts).
  Orphaned outputs count toward the same `StaleError` but are carried in its
  `orphaned` field, so the final line names the remedy a build cannot supply.
  Never-writes is one predicate, not a separate code path: both modes share one
  `SchemaFile`, and `Runner` gates every write on a single `writing` predicate
  (`mode === "build" && !refused`). Because `check` reports what `build` would
  do, it also reports `held` for the clean siblings of a gate failure or a refused
  drift.
- A merged catalog that cannot be assembled, a catalog URL or entry name
  advertised more than once or a slice that is not a catalog entry array, fails
  both modes with `CatalogMergeError` (exit `1`, after the gate and drift
  verdicts and before `StaleError`), naming every conflicting URL or name with its
  slices and every invalid slice. `build` still writes the schemas and its own
  slice; only the merged file is left as it is.
- `--force` is sugar for `--drift=allow` and nothing more: beside an explicit
  `--drift` other than `allow` it is a contradiction, refused before the config
  loads as `ConflictingFlagsError` at exit `64`. It prints a warning that a
  published document may be rewritten in place, which breaks every consumer
  pinned to its URL.
- `validate` answers whether THIS payload conforms to the published document it
  names. The reference is `--schema` or the payload's own `$schema`, resolved
  file-first and then against every identity a config schema derives (a target
  `$id`, a frozen version's `$id` or `url`, the catalog `url`), so CI validates an
  action's output against the committed document with no third-party tool and no
  network fetch. The payload's `$schema` self-reference is the pointer naming the
  document, not contract data: it is stripped before validating ONLY when the
  resolved document does not declare `$schema` as a root property. A document
  that DOES declare it (the `HostedSchema` pattern) validates the payload
  verbatim and enforces its own constraint on the key. Each finding carries the
  JSON pointer into the instance, the keyword, and, when the pointer resolves,
  the payload's `file`, `line` and `column`; an unresolvable pointer points at the
  nearest existing parent.
- A bare `effected schema` or `--help` prints help and exits `0`.

### Exit codes

| code | meaning |
| ------ | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error`, a gate failure, a missing frozen version (`FrozenVersionMissingError`), a frozen file without its derived `$id` (`FrozenVersionIdMismatchError`), a blocked merged catalog (`CatalogMergeError`), for `check` any document `build` would write (a catalog slice or the merged catalog included), an orphaned slice or merged catalog, or an orphaned document, or for `validate` a payload that does not conform (`ValidationFailedError`, one finding per problem) |
| 2 | the run could not start: config not found (`NoConfigError`) or failed to load or validate (`ConfigLoadError`), a `catalogDir` that is a file or cannot be listed (`CatalogDirError`), a version mismatch the run refused (`VersionMismatchError`), or for `validate` a payload that cannot be read or parsed (`PayloadError`) or a schema reference that resolves to no readable document (`SchemaResolutionError`) |
| 3 | infrastructure failure (`CliRuntime.main`'s `exitCode` fallback; for `validate`, an engine mechanism failure such as a document the instance engine cannot compile flows here unmarked) |
| 64 | usage error: `ShowHelp` carrying parse errors, `--force` with an explicit non-`allow` `--drift` (`ConflictingFlagsError`), a `validate` payload naming no `$schema` with no `--schema` given (`MissingSchemaRefError`), or `--wizard` on a run that is not interactive |

Exit `1` means it ran and found a problem; exit `2` means it could not run. The
MCP tools have no exit codes: the same verdicts arrive as the result's `verdict`.
A failure prints on stderr as the kit's standard report (a status line naming the
error and its message, then an `in:` trail of spans when the failure happened
inside one).

### The version-mismatch check

Before anything is generated, the engine compares the `@effected/schemastore`
version stamped on the config and on each schema's hosted identity with the
version the tool was built against. A mismatch fails `VersionMismatchError` at
exit `2`, naming both versions and how to align them. `--ignore-version-mismatch`
prints a loud warning and proceeds; the MCP tools take no flag and run anyway,
carrying the warning in the result. The reasoning and its limits are
[a Decision](../decisions/schema-version-mismatch-check.md).

## Output layout and the repository's formatter

Every file written is the library's canonical layout, tab-indented, with every
array element and object member on its own line; there is no indent or layout
option. Writes and `check` compare parsed content, so a formatter that reflows a
generated file never causes a rewrite or a stale report, but a freshly written
file is in the canonical layout and a CI job that lints after `schema build` can
fail. The wiring that closes it, and what a space-indented repository does
instead, is
[the indentation limitation](../limitations/schema-output-indentation.md); the
consumer-facing wiring lives in the `building-schemastore-schemas` skill's
`ci-gate.md`.

## The catalog: slices and the merged file

Several `schemastore.config.ts` files may share one `outputDir`, so one catalog.
Each config therefore owns a **slice**, and the merged catalog is derived from
every slice:

- **The slice** is `<catalogDir>/<name>.json`: a bare SchemaStore catalog entry
  array of every entry the config declares, canonical JSON, content-compared and
  rewritten wholesale, so a removed schema's entry drops out of it. A config that
  declares no entry writes no slice; one still on disk is `orphaned` (stale under
  `check`, never deleted by `build`) and is still merged until it is deleted by
  hand.
- **The merged catalog** is `catalog.json` in `catalogDir`'s parent: the union of
  every `*.json` slice in `catalogDir`, sorted by entry `url` in code-unit order,
  canonical JSON, content-compared. When the running config declares entries its
  slice is **replaced by the entries it computes now**, never read from disk, so
  `check` compares against what a build would produce; when it declares none, its
  on-disk slice is merged as-is. The merge is a pure function of disk plus the
  running config's fresh entries, so whichever config builds last writes the
  identical file and `check` is green for all of them at once.
- `catalogDir` is the ownership record and the one directory listed: every
  `*.json` file directly in it is one config's slice by construction, and
  anything else there is ignored. It is listed before anything is generated:
  absent is fine, but a `catalogDir` that is a file or cannot be listed fails
  `CatalogDirError` with nothing written. The running config's own slice on disk
  is an exact `<name>.json` match; only when there is none and exactly one listed
  file case-folds to that name does the `Runner` ask the **volume** (it `stat`s
  the exact path), and a case-insensitive volume claims the file as the config's
  own, reported as `caseFoldedMatch`.
- **Two slices advertising one `url` is a conflict, and so is one entry `name`
  advertised twice.** `CatalogConflict` is the tagged union
  `{ kind: "url", url, slices } | { kind: "name", name, slices }`. A slice that
  cannot be read, is not JSON, or is not a catalog entry array (a key a catalog
  entry does not declare included) is invalid, carrying its reason. Neither is
  merged silently or dropped, because which entry a host serves would otherwise
  depend on which config built last: the merged report is `blocked`, the file is
  left as it is, and both modes fail `CatalogMergeError`. The fix is an edit to the
  configs or slices, never a rebuild.
- With no slice left but a merged file on disk, the merged catalog is
  `orphaned`: reported, never deleted.

## Reporting

`RunReport` and its neighbours are `Schema` classes in the engine; the
`--format=json` document and the MCP result are encodings of the same classes, so
they cannot drift. A run reports per schema `{ $id, path, name, version?,
published, change, verdict, policy, outcome, nextVersion?, frozen?, findings }`,
plus `catalog: { slice?, merged? }`, `orphaned`, and the run's
`drifted`/`gateFailed`/`wrote`. A document whose content differs also carries its
line diff, the hunks and the same hunks as git-style unified text, with both sides
in the canonical layout so a space-formatted repository does not see every line
changed. A `check` or `build` that refused a write carries the generated text, so
the diff exists for a document that was not written.

- **Human** (default for a person and for CI): one line per schema (`written
  (contract)`, `unchanged`, `would write (annotations)`, `DRIFT contract at
  published 1.2 → suggest 1.3`, `held (drift elsewhere)`), advisory findings
  beneath, one line per catalog file, one per orphaned document, each changed
  document's coloured diff capped per schema with a `… N more lines` tail, and a
  summary line whose `drift` count is verdict-based. At an interactive terminal a
  live view shows one row per schema turning into its verdict; Ink and React load
  only then, never for an agent, CI or piped run.
- **JSON**: `--format=json`, which is the default under `--agent`, writes one
  document to stdout and moves the human lines to stderr, so stdout stays
  parseable. The MCP result always carries the full diff.
- **GitHub step summary**: `GITHUB_STEP_SUMMARY` is read through Effect `Config`,
  never `process.env`. When set, `build` and `check` append a markdown table
  (schema, version, frozen, published, change, outcome), a catalog table and the
  drift verdict, with a fenced `diff` block for a changed document. The append is
  the CLI's and never the engine's, so a read-only `schema_check` over MCP inside
  an Actions step cannot write it. A failure to write the summary is logged and
  never fatal.

## The MCP tools

`schema_check`, `schema_build` and `schema_validate` take the flags as
parameters (`config`, `drift`, `onDrift`, `force`; `payload` and `schema` for
validate) and answer the same verdicts as a declared result schema. Drift,
staleness and a failed validation are ordinary results; only a config that cannot
be found or loaded, a path outside the workspace root, or a run that could not
finish is a refusal. What binds the server is the
[mcp Module](../modules/mcp.md).

[^design]: `docs/superpowers/specs/2026-11-04-effected-schema-design.md`: the command, the config import, the shared result classes, the line diff, the audiences and the version check.
[^runner]: `packages/engine/src/schema/Runner.ts`: the frozen pre-flight (existence, then declared `$id`) that runs before generation, the catalog slice and merged-catalog writes, the `orphaned` and `blocked` outcomes, and the sibling-shape probe.
[^pipeline]: `packages/schemastore/src/SchemaPipeline.ts`: `SchemaPipeline.run` and `check`, `ContractChangePolicy`, and the `change`, `blocked`, `wouldWrite`, `generated` and `existing` result fields. The pipeline never reads `published`.
