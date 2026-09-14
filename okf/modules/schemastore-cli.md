---
type: Module
title: "@effected/schemastore-cli"
description: "A bin-only companion to @effected/schemastore: loads a schemastore.config.ts, builds or checks every declared schema and catalog entry under a per-schema published flag and a drift policy, and reports to a terminal, JSON or a GitHub step summary."
status: draft
kind: package
resource: ../../packages/schemastore-cli
layer: L4
tags:
  - dx
  - ci
  - release
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-09-13T00:00:00Z
  - id: release-action-generator
    resource: https://github.com/savvy-web/silk-release-action/blob/main/lib/scripts/generate-schema.ts
  - id: okfit-generator
    resource: https://github.com/spencerbeggs/okfit/blob/main/lib/scripts/generate-schema.ts
  - id: pipeline
    resource: ../../packages/schemastore/src/SchemaPipeline.ts
  - id: versioning
    resource: ../../packages/schemastore/src/SchemaVersioning.ts
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T00:42:15Z
  body_sha256: 92fc91323ed56079d5686d0235c7ee65084283fb29888999fac16bd357ff5a3e
---

# @effected/schemastore-cli

`@effected/schemastore-cli` is the command-line companion to
[`@effected/schemastore`](schemastore.md). The library builds, gates,
classifies and writes SchemaStore-shaped JSON Schema documents; every
consumer then wrote the same two hundred lines around it — flag parsing,
a contract gate, log wording, a drift test — six times over.[^owner] The
CLI ships that plumbing once, as a `bin`, so a consumer's whole schema
setup collapses to one TypeScript config file and two `package.json`
scripts.

It is **not a library**. Its published surface is the `schemastore`
executable and `./package.json`; nothing is importable from it. Every
type a config file needs — `defineConfig`, `SchemaTarget`, the
versioning helpers — is imported from `@effected/schemastore`, which the
CLI declares as a peer. This is what keeps the consumer's config and the
CLI's pipeline on ONE `effect` and ONE `@effected/schemastore` instance:
a `SchemaTarget` constructed in the config must be the same class the
pipeline pattern-matches, and a schema's annotation symbols must be the
ones `Schema.toJsonSchemaDocument` reads. A bundled copy of either would
fail in ways no type-check catches.

The pair releases together: a changesets **fixed** group holds
`@effected/schemastore` and `@effected/schemastore-cli` at one version,
and the CLI's peer range on the library is that exact version.

Tier: **integrated** — it runs under `Command.Environment`, loads
consumer TypeScript through `jiti`, and touches the real filesystem.

## Motivation: the six generators

The repositories that consume `@effected/schemastore` each own a
`lib/scripts/generate-schema.ts`.[^release-action-generator][^okfit-generator]
Stripped of comments they are the same program: a `targets` array; a
`--check`/`--dry-run` flag that calls `SchemaPipeline.check`; a
`--force`/`--allow-contract-change` flag that swaps the contract policy
to `"allow"`; a per-result log line; a `SchemaContractChangeError`
handler that names the next version; and a hand-rolled write of the
catalog entry. Each also carries a `__test__/generate-schema.test.ts`
that imports `targets` and asserts `SchemaPipeline.check` finds nothing
to write — a drift test that is really a CI gate wearing a test runner.

The variation between them is exactly the config the CLI takes: which
schemas, which are published, what the catalog entry says, and how much
drift a build tolerates. Everything else is the CLI.

## The config contract

The CLI loads a config module — `schemastore.config.ts` (also `.mts`,
`.js`, `.mjs`) found by walking upward from the working directory, or the
file named by the optional positional argument. The positional form is
what repositories with a `lib/scripts/` convention use; the discovery
form serves everyone else.

The module's default export is a `defineConfig(...)` value. `defineConfig`
lives in `@effected/schemastore` (module `SchemastoreConfig`), is pure,
and is identity-with-validation over a `Schema.Struct`, so a malformed
file fails typed at load rather than with a `TypeError` deep in the
pipeline:

```ts
import { defineConfig, SchemaTarget } from "@effected/schemastore";
import { ReleaseOutput, SCHEMA_URL } from "./src/schema/release-output.js";

export default defineConfig({
 schemas: [
  SchemaTarget.make({
   schema: ReleaseOutput,
   $id: SCHEMA_URL,
   name: "silk-release-action",
   version: "5.0",
   path: "schemas/5.0/silk-release-action-5.0.json",
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

- `schemas` — at least one `SchemaTarget`. `SchemaTarget` gains one
  optional field, `published` (default `false`), carried on the target so
  `SchemaPipeline`'s contract guard can read it.[^pipeline]
- `catalog` — zero or more entries. `name` must match at least one
  versioned schema; `versions` is **derived** from every versioned schema
  of that name, published or not — the entry is what gets submitted to
  become published, so the draft label has to be in it before its flag
  flips.[^owner] `defineConfig` assembles the entry through
  `CatalogEntry.assemble`, so a version bump on a schema and its catalog
  entry cannot disagree.
- `drift` — the default policy for published schemas; defaults to
  `{ policy: "semantic", onDrift: "error" }`. Command-line flags override
  it for one run.
- Relative `path` values, on schemas and catalog entries alike, resolve
  against the **config file's directory**, never the working directory —
  a root-level `schemastore build packages/x/schemastore.config.ts` and a
  `pnpm --filter x schema:build` must write identical files. Absolute
  paths pass through, so existing `resolve(REPO_ROOT, …)` values keep
  working.
- `defineConfig` rejects two spellings of one version under one name
  (`1.2` and `1.2.0` are the same version — see the grammar below).

## Drift

`SchemaPipeline` already classifies each target's change as `none`,
`created`, `annotations` (documentation-only keywords) or `contract`
(anything a validator asserts or a tool writes into an instance) — the
owner's "decorative" and "semantic" drift.[^pipeline] The CLI adds the
lifecycle dimension the library lacked: whether anyone depends on the
label yet.

| published | policy | `none` / `created` | `annotations` | `contract` |
| ----------- | ------------ | -------------------- | --------------- | ---------------------- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | **drift** |
| `true` | `strict` | write | **drift** | **drift** |

`onDrift` then decides what **drift** means:

- `error` — nothing is written for ANY schema (a partial write would
  leave a repository half-bumped); exit `1`; the message names each
  drifting schema, its change class, the `nextVersion` the pipeline
  computed, and the two ways out: bump the version in the config, or
  `--force`.
- `warn` — write anyway, exit `0`, one warning per drifting schema. This
  is the posture for an automated dependency-bump workflow, where the
  bump should land and the summary should shout.

Two rules are fixed here so the code never relitigates them:

1. An **unpublished** schema is never drift. A `contract` change at a
   pinned but unpublished version rewrites the file in place — the
   iterate-until-you-submit case.
2. **Gate failures are not drift.** Lint warnings and ajv strict-mode
   findings fail both commands regardless of `onDrift`; a document the
   editors cannot load has no warn-and-write mode.

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=…] [--on-drift=…] [--force] [--format=human|json]
```

- `build` generates, gates, applies the drift table, writes what passes
  (content-compared, so unchanged files are untouched) and writes each
  catalog entry the same way.
- `check` is the identical walk with **no writes**: it reports what
  `build` would do under the same flags and exits under the same
  conditions. It is the CI gate, and it retires the six drift tests.
  Never-writes is structural, not a threaded flag: `check` runs with a
  `SchemaFile` whose `write` fails typed.
- `--force` is sugar for `--drift=allow`.
- `--format=json` emits one document on stdout — config path, per-schema
  `{ $id, path, version, published, change, outcome, findings, nextVersion? }`,
  per-catalog-entry outcome, and the effective drift policy with its
  source (`config` or `flag`). Human text moves to stderr in this mode so
  stdout stays parseable.
- A bare `schemastore` or `--help` prints help and exits `0`; a no-match
  must not fail.

Exit codes:

| code | meaning |
| ------ | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error`, or a gate failure |
| 2 | config not found, failed to load, or failed `SchemastoreConfig` validation |
| 3 | infrastructure failure (`CliRuntime.reportFailures` fallback) |
| 64 | usage error — `ShowHelp` carrying parse errors |

## Reporting

- **Human** (default): one line per schema — `written (contract)`,
  `unchanged`, `would write (annotations)`, `DRIFT contract at published
  1.2 → suggest 1.3` — with advisory findings indented beneath, one line
  per catalog entry, and a summary line. Warnings and errors go through
  `CliLogger` on stderr.
- **JSON**: the document above, stable key order.
- **GitHub step summary**: when `GITHUB_STEP_SUMMARY` is set, both
  commands append a markdown table (schema · version · published · change
  · outcome) and the drift verdict. This is a short append in the CLI, not
  a dependency on `@effected/github-actions`, whose weight is wrong for a
  bin that appends one file. A failure to write the summary is logged and
  never fatal.

## Version grammar

`SchemaVersion` widens from a mandatory three-component SemVer to
`major`, `major.minor` or `major.minor.patch`, optional prerelease,
`+build` still rejected.[^versioning] SchemaStore's own corpus is mostly
two-part (`agripparc-1.2.json`) and the owner wants all three spellings
available.[^owner] The label is preserved verbatim — it is the file name
and the URL — and missing components read as `0` for ordering, so `1`,
`1.0` and `1.0.0` are one version.

`SchemaVersioning.next` preserves component count and suggests a
**minor** bump on a `contract` change (`1` → `2`, `1.2` → `1.3`,
`1.2.0` → `1.3.0`; `0` → `1`). `DocumentDiff` cannot tell an added
optional property from a removed required one, so the suggestion's job is
to be strictly greater and conspicuous; minor matches how SchemaStore
schemas actually move, and the author bumps major by hand when they know
the change is breaking.

The one cost of admitting bare-major labels is the reason they were
originally refused: an integer-like object key enumerates ahead of every
dotted key in JavaScript regardless of insertion order, so a catalog
entry's `versions` map serializes `"2"` before `"1.5"`. SchemaStore reads
that map by key, not by position, so the effect is cosmetic; it is
recorded as a Gotcha rather than fought.

## Package shape

- `packages/schemastore-cli`: `bin: { schemastore: "./src/bin.ts" }`,
  `exports` limited to `./package.json`, no `index.ts`, no api-extractor
  model and no website page — the documentation is `--help`, the README,
  and the library's page.
- `dependencies`: `jiti`, `@effect/platform-node`, `@effected/cli`.
  `peerDependencies`: `effect`, `@effected/schemastore` (exact fixed
  version).
- A consumer installs `@effected/schemastore`, `@effected/schemastore-cli`
  and `effect` as devDependencies and adds
  `"schema:build": "schemastore build lib/scripts/schemastore.config.ts"`
  and `"schema:check": "schemastore check …"`; the turbo `build` task
  depends on `schema:build`.
- `catalog:check` flags the new package as a membership gap on first
  release; the `PnpmConfigPlugin(...)` catalog literal is extended by hand.

## Relationship to the library's earlier decisions

[No bin — the library is not a CLI](../decisions/schemastore-no-bin.md)
still holds for `@effected/schemastore`; its argument that pipeline
inputs are TypeScript values is what the config file satisfies. The
companion is where the bin lives. [No shipped templates
directory](../decisions/schemastore-no-shipped-templates-directory.md)
becomes moot: there is no longer a canonical generator script to copy.

## Testing

- Library: property tests over 1/2/3-component labels (verbatim
  round-trip, numeric ordering with missing components as `0`, the
  rejections), a table for `next` per component count, `defineConfig`
  rejections, and one pipeline test per cell of the drift table that
  changes an outcome.
- CLI: tests drive `Command.run` in-process over `@effected/memfs`, never
  a child process — seeded config plus prior outputs, then assertions on
  the volume (what was written; that `check` wrote nothing), captured
  output and exit code. Cases: discovery up the tree, positional
  override, not found → `2`; flag-over-config precedence; `--force`
  warning; `onDrift: warn` writes and exits `0`; gate failure exits `1`
  under either `onDrift`; `--format=json` parses with nothing else on
  stdout; step summary appended when set, logged-not-fatal when
  unwritable.
- The jiti edge — a config whose `./x.js` specifiers resolve to `.ts`
  sources, on the consumer's own `effect` instance — is one real-filesystem
  integration test over a fixture directory, plus a scratchpad probe
  before release. Acceptance is the release-action generator collapsing
  to a config file with its drift test retired.

[^owner]: The owner's design conversation of 2026-09-13: the six duplicated generators, the `defineConfig`/`schemas`/`catalog`/`drift` shape, `published` per schema, `build` + `check`, catalog versions including unpublished labels, and the widened version grammar with a minor-bump suggestion.
[^release-action-generator]: `lib/scripts/generate-schema.ts` in silk-release-action — the fullest of the six, with `--check`, `--allow-contract-change`, and the `SchemaContractChangeError` handler the CLI absorbs.
[^okfit-generator]: `lib/scripts/generate-schema.ts` in okfit — the `CATALOGUED = false` constant that `published` replaces, and the hand-written catalog-entry write the `catalog` block replaces.
[^pipeline]: `SchemaPipeline.run` / `SchemaPipeline.check`, `ContractChangePolicy`, and the `change`, `blocked`, `contractBlocked`, `wouldWrite` result fields.
[^versioning]: `SchemaVersioning` — the strict three-component grammar and its stated reasons, and `next`'s current major-bump rule.
