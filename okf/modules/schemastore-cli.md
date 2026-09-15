---
type: Module
title: "@effected/schemastore-cli"
description: "The companion command to @effected/schemastore: loads a schemastore.config.ts, builds or checks every declared schema and catalog entry under a per-schema published flag and a drift policy, and reports to a terminal, JSON or a GitHub step summary; also the home of AjvValidator, the one shipped SchemaValidator engine."
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
  - id: ajv-validator
    resource: ../../packages/schemastore-cli/src/AjvValidator.ts
  - id: cli-package-json
    resource: ../../packages/schemastore-cli/package.json
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

It is **not a library**, though it has one export. Its published
surface is the `schemastore` executable, `./package.json` and a single
`.` entry exporting `AjvValidator` — the one shipped `SchemaValidator`
engine, which the command composes at its edge and which exists as an
export so a program driving `SchemaPipeline` itself can compose the
same engine the command runs; nothing is hidden.[^ajv-validator][^cli-package-json]
Every type a config file needs — `defineConfig`, `SchemaTarget`, the
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
tier — but tier measures what an importer pays, and the one thing an
importer can reach, `AjvValidator`, is a layer over the library's own
contract rather than a surface of its own: the command is the canonical
use, the export a courtesy. The
[companion package](../glossary/companion-package.md) glossary rules,
and the `pnpm-plugin-effect` precedent (a companion with no tier) is the
one this follows rather than arguing a running-code companion into a
tier.

## AjvValidator: the engine lives here

`AjvValidator.layer` is the `SchemaValidator` implementation the library
shipped as `SchemaValidator.layer` until 2026-09-15, moved rather than
rewritten: ajv strict mode over the Draft-07 meta-schema, every
declared `KeywordFamilies` keyword found in the document registered
before compiling (so the engine cannot reject what `DocumentLint`
allows — one predicate, two verdicts), the standard `ajv-formats`
vocabulary and only the vocabulary (`addFormats(ajv, { keywords: false })`),
a fresh instance per call so shared `$id`s never collide, findings as
`ValidationFinding` values and mechanism failures as
`SchemaValidatorError`.[^ajv-validator] `cli/execute.ts` composes it
where it composed the library's layer, and the CLI's own tests own the
engine suite (`__test__/ajv-validator.test.ts`).

It lives here so `ajv` is a cost only the command pays: the library keeps
the contract and its doubles, and an application that imports
`@effected/schemastore` at runtime — for `HostedSchema` — never installs
or bundles an engine. The reasoning is
[the engine lives in the CLI](../decisions/schemastore-engine-lives-in-the-cli.md);
the registration rules it inherits are
[ajv ships closed](../decisions/schemastore-ajv-ships-closed.md).

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
or a `frozen` entry missing `version`/`path`/`$id`/`url` — and fails them
as `ConfigLoadError` (exit `2`) before any path is resolved:

```ts
import { defineConfig } from "@effected/schemastore";
import { OkfitConfig } from "./src/config-schema.js";

export default defineConfig({
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

A first-run config declares a single label like the one above; a second
label is appended to `versions` only once the first is published and its
file already exists on disk — see "The lifecycle" in the
`building-schemastore-schemas` skill's `drift-and-versioning.md` reference.

Self-hosted, the same entry takes
`baseUrl: "https://raw.githubusercontent.com/o/r/main/schemas"` and
derives `schemas/1.1/okfit-1.1.json` (the `"versioned"` layout) instead
of the flat SchemaStore file. An application that already holds a
`HostedSchema` (to derive its own `$schema` URL from) hands the same value
in as `hosted: OutputSchema` instead of spelling `baseUrl`/`versions`/
`current`/`layout`, keyed by `OutputSchema.name` — see
[hosted identity](schemastore.md#hosted-identity-one-value-for-schema-and-id).

- `schemas` — a record keyed by file base name; the key IS the schema's
  `name`, and every derived `path`, `$id` and catalog URL is built from
  it via one `HostedSchema` (`idFor`/`urlFor`/`fileNameFor`) — there is no `$id`
  override by design. The key must be a simple file base name (no
  separators, no whitespace).[^config]
- `versions` — every label this schema advertises; omit for an
  unversioned schema. `current` (default: the highest under
  `SchemaVersioning.Order`) is the one label generated at this entry's
  `path`/`$id`; every other label becomes a **frozen** file — one that
  already exists on disk, advertised by the catalog and verified by the
  CLI before anything is generated, never regenerated. A schema that
  advertises a frozen label with no file on disk fails the build typed
  with `FrozenVersionMissingError`, and one whose file is there but does
  not declare the derived `$id` fails `FrozenVersionIdMismatchError` —
  nothing is written for any schema either way.[^runner] `defineConfig` rejects two spellings of one version
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
  the top-level default; an entry with neither is rejected. Ignored
  (and rejected if spelled) on an entry that carries `hosted`.
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
  default, which itself defaults to `"semantic"` (`DriftPolicy.defaults.policy`).
- `outputDir` — top-level only, one destination per config; every
  derived `path` is written under it.
- `onDrift` — run-wide, top-level only, never overridable per schema.
  Defaults to `"error"` (`DriftPolicy.defaults.onDrift`). Command-line
  flags override the effective policy for one run.
- `catalogPath` — where the single catalog file is written. Defaults to
  `<outputDir>/catalog.json`.
- Relative `outputDir`, `catalogPath`, and every derived schema/frozen
  `path` resolve against the **config file's directory**, never the
  working directory — a root-level
  `schemastore build packages/x/schemastore.config.ts` and a
  `pnpm --filter x schema:build` must write identical files. Absolute
  paths pass through, so an existing `resolve(REPO_ROOT, …)` `outputDir`
  keeps working.
- `hosted` — a `HostedSchema` the application already holds. It supplies
  `baseUrl`, `versions`, `current` and `layout`, which must then not be
  spelled beside it, and its `name` must equal the entry's key; the
  config-level `baseUrl` default is ignored for such an entry.
- `defineConfig` decodes the input with one `Schema.Struct` per level
  (`errors: "all"`, `onExcessProperty: "error"`), so a typo'd key is
  named and rejected rather than dropped and every issue on an entry is
  reported at once, then applies the cross-field rules; every failure is
  a plain `Error` prefixed `defineConfig:` naming the offending schema —
  `defineConfig: schema "okfit" Expected string at ["baseUrl"]` — never a
  raw `TypeError`. The hosting and version rules (an empty `versions`
  array, an invalid/duplicate label, `current` without `versions` or not
  among them, `layout` under `"schemastore"`, a `baseUrl` that is neither
  `"schemastore"` nor `https://`) are `HostedSchema`'s and surface under
  the same prefix; the rest — an empty `schemas` record, a key that fails
  the simple-name rule, a `hosted` mismatch, a missing `catalog` under
  `"schemastore"`, a duplicate output path after lexical normalisation —
  stay in `defineConfig`. The CLI wraps the throw into `ConfigLoadError`
  (exit `2`).

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

- Before anything is generated, `Runner` walks every advertised frozen
  version: a label with no file on disk fails typed with
  `FrozenVersionMissingError` (reported first), and a file that is there
  is read and must declare the `$id` its `FrozenVersion` entry derives —
  a different `$id`, none, or text that does not parse fails typed with
  `FrozenVersionIdMismatchError`, carrying
  `mismatched: [{ name, version, path, expected, actual?, reason }]` with
  `reason` one of `"mismatch"`, `"absent"` or `"unparseable"`. Either way
  nothing is written for any schema (exit `1`): a catalog must never
  point a frozen label at a 404, and a `baseUrl` change is a re-publish
  event for every frozen label, not a silent re-advertisement — the frozen
  file is the one document the derivation does not own, so it is the one
  place `$id` and the advertised URL can still disagree.[^runner]
- `build` generates, gates, applies the drift table, writes what passes
  (content-compared, so unchanged files are untouched) and writes the
  single `catalog.json` the same way: `Runner` reads the existing file
  once (`NotFound` → absent, so a build creates it) and compares the
  parsed content with the library's `CanonicalJson.equals`, so key order
  is a serialization detail and unparseable text is simply different and
  gets repaired. Every schema's declared `catalog` entry lands in that
  one file at `config.catalogPath` — never one file per schema. When no
  schema declares a catalog but a file still sits at `catalogPath` (the
  last `catalog` block was removed), the report carries
  `catalog: { path, entries: 0, outcome: "orphaned" }` — stale (exit `1`)
  under `check`, reported but **never deleted** under `build`, since the
  CLI may not have written it; the human line reads
  `orphaned catalog <path> (no schema declares a catalog)`. The report
  omits `catalog` only when there is no such file either.
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
- `--format=json` emits one document on stdout — `mode`, `configPath`,
  `drift: { onDrift, policy? }` (`policy` present only when a flag forced
  one tolerance over every schema's own, never a `source` field),
  per-schema `{ $id, path, name, version?, published, change, verdict,
  policy, outcome, nextVersion?, frozen?, findings }`, one optional
  `catalog: { path, entries, outcome }` for the single catalog file
  (`outcome` is `written`, `unchanged`, `would-write`, `held` or
  `orphaned`), and
  `drifted`/`gateFailed`/`wrote`. Human text moves to stderr in this mode
  so stdout stays parseable.
- A bare `schemastore` or `--help` prints help and exits `0`; a no-match
  must not fail.

Exit codes:

| code | meaning |
| ------ | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error`, a gate failure, a missing frozen version (`FrozenVersionMissingError`), a frozen file without its derived `$id` (`FrozenVersionIdMismatchError`), or — for `check` — any document `build` would write or an orphaned catalog file |
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
  contract change carries no `nextVersion` at all (the label is not
  pinned, and already declares its own instability) and renders no
  suggestion. Warnings and errors go through
  `CliLogger` on stderr; the logger is built with `stderrFrom: "All"` so
  a `--format=json` stdout stays parseable.
- **JSON**: the document above, stable key order.
- **GitHub step summary**: `GITHUB_STEP_SUMMARY` is read through Effect
  `Config` (`Config.String(...).pipe(Config.option)` under the default
  `fromEnv` provider — tests substitute `ConfigProvider.fromMap`), never
  `process.env`; `__PACKAGE_VERSION__` stays the bundler's compile-time
  substitution.[^owner] When it is set, both commands append a markdown table (schema · version · frozen · published
  · change · outcome) and the drift verdict. This is a short append in the CLI, not
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

- `packages/schemastore-cli`: `bin: { schemastore: "./src/bin.ts" }`
  and `exports` of exactly `.` (`src/index.ts`, re-exporting
  `AjvValidator` and nothing else) plus `./package.json`. The one entry
  earns a declaration bundle and an api-extractor model like any other
  kit package (`savvy.build.ts` sets
  `localPaths: ["../../website/lib/models/schemastore-cli"]`); the
  command's documentation is still `--help`, the README and the
  library's page.[^cli-package-json]
- `dependencies`: `jiti`, `@effect/platform-node`, `@effected/cli`,
  `ajv`, `ajv-formats`. `peerDependencies`: `effect`,
  `@effected/schemastore` (exact fixed version).
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
[^config]: `SchemastoreConfig.ts` — `defineConfig`, `SchemastoreConfigInput`, `SchemaEntryInput` (including `hosted`), `ResolvedSchema`, `FrozenVersion` (`version`/`path`/`$id`/`url`); the keyed-by-name shape, the per-level `Schema.Struct` decode, and the delegation of hosting and version rules to `HostedSchema`.
[^ajv-validator]: `packages/schemastore-cli/src/AjvValidator.ts` — `AjvValidator.layer`: strict mode, `KeywordFamilies` registration, `addFormats(ajv, { keywords: false })`, a fresh `Ajv` per call.
[^cli-package-json]: `packages/schemastore-cli/package.json` — the `.` export to `src/index.ts`, `ajv` and `ajv-formats` as regular dependencies, `effect` and `@effected/schemastore` as peers.
[^runner]: `packages/schemastore-cli/src/Runner.ts` — `FrozenVersionMissingError`, `FrozenVersionIdMismatchError`, the frozen pre-flight (existence, then declared `$id`) that runs before generation, the single-`catalog.json` write, and the `orphaned` `CatalogReport` outcome.
