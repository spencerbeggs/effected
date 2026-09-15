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
  - id: config
    resource: ../../packages/schemastore/src/SchemastoreConfig.ts
  - id: runner
    resource: ../../packages/schemastore-cli/src/Runner.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T16:39:01Z
  body_sha256: f28550f704acee14aa98b7856dfe6a1e42720ab79adeec5d6875704534e543f3
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

Tier: **none — a companion package**, like `pnpm-plugin-effect`. It runs
under `Command.Environment`, loads consumer TypeScript through `jiti`,
and touches the real filesystem — which would make a *library* integrated
tier — but tier measures what an importer pays, and nothing can import
this package: its published surface is the bin and `./package.json`. The
[companion package](../glossary/companion-package.md) glossary rules,
and the `pnpm-plugin-effect` precedent (a companion with no tier) is the
one this follows rather than arguing a running-code companion into a
tier.

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

The module is loaded through `jiti` created against the **config
file's own path** (`createJiti(configPath, …)`), so its relative
specifiers and its `effect` / `@effected/schemastore` imports resolve
from the consumer's tree, never from the CLI's.

The module's default export is a `defineConfig(...)` value, keyed by
schema name. `defineConfig` lives in `@effected/schemastore` (module
`SchemastoreConfig`), is pure, and validates the whole input before
assembling it, so a malformed file fails typed at load rather than with a
`TypeError` deep in the pipeline. The loader also re-checks the shapes a
forged brand could carry past `defineConfig` — a malformed schema target,
or a `frozen` entry missing `version`/`path`/`url` — and fails them as
`ConfigLoadError` (exit `2`) before any path is resolved:

```ts
import { defineConfig } from "@effected/schemastore";
import { OkfitConfig } from "./src/config-schema.js";

export default defineConfig({
  outputDir: "schemas",
  baseUrl: "schemastore",
  schemas: {
    okfit: {
      schema: OkfitConfig,
      versions: ["1.0", "1.1"],
      published: true,
      catalog: { description: "okfit configuration", fileMatch: ["okfit.toml", ".okfit.toml"] },
    },
  },
});
```

Self-hosted, the same entry takes
`baseUrl: "https://raw.githubusercontent.com/o/r/main/schemas"` and
derives `schemas/1.1/okfit-1.1.json` (the `"versioned"` layout) instead
of the flat SchemaStore file.

- `schemas` — a record keyed by file base name; the key IS the schema's
  `name`, and every derived `path`, `$id` and catalog URL is built from
  it via one `relativeFile(name, version, layout)` — there is no `$id`
  override by design. The key must be a simple file base name (no
  separators, no whitespace).[^config]
- `versions` — every label this schema advertises; omit for an
  unversioned schema. `current` (default: the highest under
  `SchemaVersioning.Order`) is the one label generated at this entry's
  `path`/`$id`; every other label becomes a **frozen** file — one that
  already exists on disk, advertised by the catalog and verified by the
  CLI before anything is generated, never regenerated. A schema that
  advertises a frozen label with no file on disk fails the build typed
  with `FrozenVersionMissingError` — nothing is written for any
  schema.[^runner] `defineConfig` rejects two spellings of one version
  under one name (`1.2` and `1.2.0` are the same version — see the
  grammar below).
- `published` — whether a consumer already depends on this document at
  this label, forwarded to `SchemaTarget`. Defaults to `false`. The
  pipeline does NOT read `published`: `SchemaPipeline`'s own
  `block-versioned` contract guard is switched off
  (`contractChanges: "allow"`), and the CLI's `Runner` runs
  `SchemaPipeline.check` and applies `DriftPolicy.classify` over each
  result itself.[^pipeline]
- `baseUrl` — either the literal `"schemastore"`, which expands `$id` to
  `https://json.schemastore.org/<file>` and the catalog URL to
  `https://www.schemastore.org/<file>` (two hosts, verified against
  `clangd.json` and `agripparc-1.4.json`), and forces the `"flat"`
  layout; or an `https://` URL used as one base for both. Falls back to
  the top-level default; an entry with neither is rejected.
- `layout` — how a versioned document's path/URL nests relative to its
  base: `"flat"` or `"versioned"`. Defaults to `"versioned"` for a custom
  `baseUrl`; rejected outright under `baseUrl: "schemastore"`, which
  serves only the flat layout.
- `catalog` — the catalog entry to assemble for this schema (`name` must
  match at least one versioned schema is no longer a separate rule — the
  key IS the name). Required under `baseUrl: "schemastore"` (hosting
  there means being in its catalog); optional under a custom host, with
  an empty `fileMatch` rejected. Every schema's declared `catalog` entry
  lands in **one file** at `catalogPath` — never one file per
  schema.[^runner]
- `drift` — this schema's tolerance, overriding the config's top-level
  default.
- `outputDir` — top-level only, one destination per config; every
  derived `path` is written under it.
- `onDrift` — run-wide, top-level only, never overridable per schema.
  Defaults to `{ policy: "semantic", onDrift: "error" }`
  (`DriftPolicy.defaults`). Command-line flags override the effective
  policy for one run.
- `catalogPath` — where the single catalog file is written. Defaults to
  `<outputDir>/catalog.json`.
- Relative `outputDir`, `catalogPath`, and every derived schema/frozen
  `path` resolve against the **config file's directory**, never the
  working directory — a root-level
  `schemastore build packages/x/schemastore.config.ts` and a
  `pnpm --filter x schema:build` must write identical files. Absolute
  paths pass through, so an existing `resolve(REPO_ROOT, …)` `outputDir`
  keeps working.
- `defineConfig` validates the whole input up front and throws a plain
  `Error` prefixed `defineConfig:` naming the offending schema — never a
  raw `TypeError` — on every malformed input: an empty `schemas` record;
  a missing/empty `outputDir`; a schema key that fails the simple-name
  rule; an empty `versions` array or an invalid/duplicate label; `current`
  given without `versions`, or naming one not among them; `layout` under
  `"schemastore"`; a missing `catalog` under `"schemastore"`, or one with
  an empty `fileMatch`; an invalid `drift` or top-level `onDrift`; and an
  output path (a target, a frozen file or the catalog path) declared
  twice, compared after lexical normalisation. The CLI wraps the throw
  into `ConfigLoadError` (exit `2`).

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
  leave a repository half-bumped); exit `1` with `DriftError`, which
  carries `drifted: [{ $id, change, version?, nextVersion? }]` (one entry
  per schema whose verdict is `drift`; `count` is derived from it) and
  renders one line per schema — `$id`, its change class, `at published
  <version>` and `→ suggest <nextVersion>` when known — followed by the
  two ways out: bump the version in the config, or `--force`.
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

- Before anything is generated, `Runner` checks every advertised frozen
  version for existence: a schema whose `frozen` names a label with no
  file on disk fails typed with `FrozenVersionMissingError` and nothing
  is written for any schema (exit `1`) — a catalog must never point a
  frozen label at a 404.[^runner]
- `build` generates, gates, applies the drift table, writes what passes
  (content-compared, so unchanged files are untouched) and writes the
  single `catalog.json` the same way: `Runner` reads the existing file
  once (`NotFound` → absent, so a build creates it) and compares the
  parsed content with the library's `CanonicalJson.equals`, so key order
  is a serialization detail and unparseable text is simply different and
  gets repaired. Every schema's declared `catalog` entry lands in that
  one file at `config.catalogPath` — never one file per schema.
- `check` is the identical walk with **no writes**: it reports what
  `build` would do under the same flags and exits under the same
  conditions — and, because it is the CI drift gate, it ALSO exits `1`
  whenever a build would write anything: a committed schema or catalog
  entry that differs from what the config generates, or one that is
  missing, is stale, and the message says to run `schemastore build` and
  commit the result (`StaleError`, evaluated after the gate and drift
  verdicts). It retires the six drift tests. Never-writes is one predicate, not a separate code path: both modes
  share one `SchemaFile`, and `Runner` gates every write — schemas and
  catalog entries alike — on a single `writing` predicate
  (`mode === "build" && !refused`), pinned by the "check never writes"
  tests. Because `check` reports what `build` would do, it also reports
  `held` for the clean siblings of a gate failure or a refused drift,
  exactly as a build would.
- `--force` is sugar for `--drift=allow` — and nothing more: combined
  with an explicit `--drift` other than `allow` it is a contradiction,
  refused before the config loads as `ConflictingFlagsError` at exit
  `64` (a usage error, not a run outcome) rather than silently resolving
  to `allow`.
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
| 1 | drift under `onDrift: error`, a gate failure, a missing frozen version (`FrozenVersionMissingError`), or — for `check` — any document `build` would write |
| 2 | config not found, failed to load, or failed `SchemastoreConfig` validation |
| 3 | infrastructure failure (`CliRuntime.reportFailures` fallback) |
| 64 | usage error — `ShowHelp` carrying parse errors, or `--force` combined with an explicit non-`allow` `--drift` (`ConflictingFlagsError`) |

## Reporting

- **Human** (default): one line per schema — `written (contract)`,
  `unchanged`, `would write (annotations)`, `DRIFT contract at published
  1.2 → suggest 1.3`, and `held (drift elsewhere)` or `held (gate failed
  elsewhere)` for a schema that passed but was not (or, under `check`,
  would not be) written because a sibling refused the run — with
  advisory findings indented beneath, one
  line for the single catalog file, and a summary line whose `drift` count is
  verdict-based — the number of schemas classified `drift`, independent
  of `written`/`unchanged`, so under `onDrift: warn` a drifting schema
  is both written and counted as drift and the four counts need not sum
  to the schema total. A prerelease label's
  contract change has `nextVersion === version` (the label is not
  pinned) and renders no suggestion. Warnings and errors go through
  `CliLogger` on stderr; the logger is built with `stderrFrom: "All"` so
  a `--format=json` stdout stays parseable.
- **JSON**: the document above, stable key order.
- **GitHub step summary**: `GITHUB_STEP_SUMMARY` is read through Effect
  `Config` (`Config.String(...).pipe(Config.option)` under the default
  `fromEnv` provider — tests substitute `ConfigProvider.fromMap`), never
  `process.env`; `__PACKAGE_VERSION__` stays the bundler's compile-time
  substitution.[^owner] When it is set, both commands append a markdown table (schema · version · published · change
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
  and the library's page. The bundler runs with `emitDts: false` — the
  prod meta pass refuses a package with zero entry points — so there is
  no dts pass, no `_base` suppression and no `tsdoc.json`; it is the one
  package that departs from the scaffold convention there.
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
  override, not found → `2`; `check` on a fresh volume exits `1` stale,
  over the exact generated documents exits `0`, with only a stale catalog
  entry exits `1`; flag-over-config precedence; `--force`
  warning; `--force` with `--drift=strict` exits `64` and writes
  nothing; `onDrift: warn` writes and exits `0`; gate failure exits `1`
  under either `onDrift`; `--format=json` parses with nothing else on
  stdout; step summary appended when set, logged-not-fatal when
  unwritable.
- Two `effect/unstable/cli` notes the tests pin: a `Flag.Boolean` must
  carry `withDefault(false)` or its omission is a parse error rather
  than `false`, and `CliLogger` must be given `stderrFrom: "All"` for the
  JSON-mode stdout assertion to hold.
- The jiti edge — a config whose `./x.js` specifiers resolve to `.ts`
  sources, on the consumer's own `effect` instance — is one real-filesystem
  integration test over a fixture directory, plus a scratchpad probe
  before release. Acceptance is the release-action generator collapsing
  to a config file with its drift test retired.

[^owner]: The owner's design conversation of 2026-09-13: the six duplicated generators, the `defineConfig`/`schemas`/`catalog`/`drift` shape, `published` per schema, `build` + `check`, catalog versions including unpublished labels, and the widened version grammar with a minor-bump suggestion.
[^release-action-generator]: `lib/scripts/generate-schema.ts` in silk-release-action — the fullest of the six, with `--check`, `--allow-contract-change`, and the `SchemaContractChangeError` handler the CLI absorbs.
[^okfit-generator]: `lib/scripts/generate-schema.ts` in okfit — the `CATALOGUED = false` constant that `published` replaces, and the hand-written catalog-entry write the `catalog` block replaces.
[^pipeline]: `SchemaPipeline.run` / `SchemaPipeline.check`, `ContractChangePolicy`, and the `change`, `blocked`, `contractBlocked`, `wouldWrite` result fields. The pipeline never reads `published`; the CLI's `Runner` classifies over `check` results with the contract guard set to `"allow"`.
[^versioning]: `SchemaVersioning` — the widened one-to-three-component grammar, `parseResult`, and `next`'s minor-bump rule (identity on a prerelease label).
[^config]: `SchemastoreConfig.ts` — `defineConfig`, `SchemastoreConfigInput`, `SchemaEntryInput`, `ResolvedSchema`, `FrozenVersion`; the keyed-by-name shape, the derivation of `$id`/`path`/catalog URL from one `relativeFile`, and the full validation list.
[^runner]: `packages/schemastore-cli/src/Runner.ts` — `FrozenVersionMissingError`, the frozen-existence check that runs before generation, and the single-`catalog.json` write.
