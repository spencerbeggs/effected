---
type: Module
title: "@effected/schemastore-cli"
description: "The companion command to @effected/schemastore: loads a schemastore.config.ts, builds or checks every declared schema and catalog entry under a per-schema published flag and a drift policy, validates a payload against a published document, and reports to a terminal, JSON or a GitHub step summary; also the home of the kit's two shipped engines, AjvValidator (SchemaValidator) and AjvInstanceValidator (InstanceValidator)."
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
  - id: ajv-instance-validator
    resource: ../../packages/schemastore-cli/src/AjvInstanceValidator.ts
  - id: cli-package-json
    resource: ../../packages/schemastore-cli/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-10-03T16:26:35Z
  body_sha256: 29b639d2f1a4134cb561f8a92960ca7ea7a9812587fd915adb447b753c1a6d00
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

It is **not a library**, though it has one entry. Its published
surface is the `schemastore` executable, `./package.json` and a single
`.` entry exporting **only engine layers over the library's contracts** —
`AjvValidator`, the one shipped `SchemaValidator` engine, and
`AjvInstanceValidator`, the one shipped `InstanceValidator` engine —
which the commands compose at their edges and which exist as exports so
a program driving `SchemaPipeline` or validating payloads itself can
compose the same engines the commands run; nothing is
hidden.[^ajv-validator][^ajv-instance-validator][^cli-package-json]
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
importer can reach — `AjvValidator` and `AjvInstanceValidator` — is an
engine layer over the library's own
contract rather than a surface of its own: the commands are the canonical
use, the exports a courtesy. The
[companion package](../glossary/companion-package.md) glossary rules,
and the `pnpm-plugin-effect` precedent (a companion with no tier) is the
one this follows rather than arguing a running-code companion into a
tier.

## The engines live here

`AjvValidator.layer` is the `SchemaValidator` implementation the library
shipped as `SchemaValidator.layer` until 2026-09-15, moved rather than
rewritten: ajv strict mode over the Draft-07 meta-schema, every
declared `KeywordFamilies` keyword found in the document registered
before compiling (so the engine cannot reject what `DocumentLint`
allows — one predicate, two verdicts), the standard `ajv-formats`
vocabulary and only the vocabulary (`addFormats(ajv, { keywords: false })`),
a fresh instance per call so shared `$id`s never collide, findings as
`ValidationFinding` values and mechanism failures as
`SchemaValidatorError`.[^ajv-validator] The plugin is bound with one
hop, `ajvFormats.default`, which is correct in both module worlds and
not a workaround — see
[ajv-formats' default import is not callable](../gotchas/ajv-formats-default-import-is-not-callable.md).
`cli/execute.ts` composes it
where it composed the library's layer, and the CLI's own tests own the
engine suite (`__test__/ajv-validator.test.ts`).

`AjvInstanceValidator.layer` is the second engine, for the payload half
of the story: the same setup pointed at an instance instead of the
meta-schema, answering `InstanceFinding` values — ajv's `instancePath`
preserved as the pointer into the INSTANCE, `allErrors` reporting every
problem — when a payload fails a document, and `InstanceValidatorError`
when the engine cannot compile the document at all. The subjects differ,
so the same throw means different things: for `AjvValidator` the document
IS the subject and a compile failure is a finding; for
`AjvInstanceValidator` the subject is the instance, and a document that
yields no verdict is a mechanism failure — the document's own gate is
`SchemaValidator`'s job, run by `check` before anything is published.
Both engines build through ONE shared setup, `internal/ajv.ts`
`makeAjv`, so a document the `check` gate admits always compiles in the
instance engine too and the two verdicts cannot drift.
`cli/commands/validate.ts` composes it, and its suite is
`__test__/ajv-instance-validator.test.ts`.[^ajv-instance-validator]

It lives here so `ajv` is a cost only the command pays: the library keeps
the contracts and their doubles, and an application that imports
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
  lands in **one slice file** for the whole config,
  `<catalogDir>/<name>.json` — never one file per schema — and the CLI
  maintains the merged `catalog.json` over every slice (see
  [the catalog](#the-catalog-slices-and-the-merged-file)).[^runner]
- `drift` — this schema's tolerance, overriding the config's top-level
  default, which itself defaults to `"semantic"` (`DriftPolicy.defaults.policy`).
- `outputDir` — top-level only, one destination per config; every
  derived `path` is written under it.
- `onDrift` — run-wide, top-level only, never overridable per schema.
  Defaults to `"error"` (`DriftPolicy.defaults.onDrift`). Command-line
  flags override the effective policy for one run.
- `name` — top-level, **required**: the config's identity, the base name
  of the catalog slice it owns. A simple file base name under the same
  rule as a schema key. Configs sharing a `catalogDir` carry names that
  are distinct **case-insensitively**: on a case-insensitive volume
  (macOS APFS) `docs` and `Docs` name one slice file and overwrite each
  other, with both builds exiting `0` — a bare-array slice records no
  owner, so it cannot be detected in general. When a config claims a file
  that matches its name only case-insensitively — which it does only when
  the volume itself resolves `<name>.json` to that file — the slice line
  says so (`claimed <path> by case-folded match for "<name>"`; JSON and
  the step summary carry `caseFoldedMatch`). A missing `name` fails with `defineConfig: name is required —
  the base name of this config's catalog slice (<catalogDir>/<name>.json)`
  rather than the bare decode message, since a `.js` config gets no
  compile-time hint.
- `catalogDir` — the directory of catalog slices. Defaults to
  `<outputDir>/catalogs`, so the merged catalog lands at
  `<outputDir>/catalog.json`. Every `*.json` file directly in it is read
  as a slice, so `defineConfig` rejects a `catalogDir` that is `outputDir`,
  that is the merged catalog's own path (`schemas/catalog.json`), or that
  a derived document sits directly in (the loader re-checks all three on
  resolved paths, as `ConfigLoadError`, exit `2`). **Every config sharing
  a merged catalog must share the same `catalogDir`**: sibling
  directories (`schemas/catalogs`, `schemas/more`) both merge into
  `schemas/catalog.json` from different slice sets and overwrite each
  other, which no single config can detect; and their `name`s must be
  unique case-insensitively.
- Relative `outputDir`, `catalogDir`, and every derived schema/frozen
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
  the simple-name rule, a config `name` that fails it, a `hosted`
  mismatch, a missing `catalog` under `"schemastore"`, a `catalogDir`
  that is `outputDir` or holds a derived document, a duplicate output path
  (the slice and the merged catalog included) after lexical
  normalisation — stay in `defineConfig`. The CLI wraps the throw into `ConfigLoadError`
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
schemastore validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json]
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
  config's catalog slice and the merged catalog the same way — see
  [the catalog](#the-catalog-slices-and-the-merged-file) below. Each
  catalog file is read once (`NotFound` → absent, so a build creates it)
  and compared by parsed content with the library's
  `CanonicalJson.equals`, so key order is a serialization detail and
  unparseable text is simply different and gets repaired. Both modes
  also probe the sibling shapes of every derived path —
  `SchemaVersioning.fileName` has exactly four per name and label
  (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`,
  `<v>/<name>-<v>.json`) — for every label the config still declares,
  and report each FILE that exists and that no target, frozen version,
  catalog slice, or merged catalog claims in `orphaned`: the document an `appendVersion`
  flip or a `layout` change left behind under its old name (for a
  `published` label, the advertised URL keeps serving the stale document
  with no report — the same shape an orphaned catalog slice closes). Stale
  (exit `1`) under `check`, reported but **never deleted** under `build`;
  the human line reads `orphaned document <path> (no target, frozen
  version, or catalog entry claims it — delete it by hand; build never
  will)`. Nothing else on disk is read — `outputDir` is never listed, because it
  may be shared with another config, a deploy folder, or the repository
  root, where a neighbour's document cannot be told from a leftover; the
  cost is that a `name` change or a dropped label leaves a file the
  command cannot know about (the old name is unknowable). A directory
  wearing a derived name is not a document and is never reported.
- `check` is the identical walk with **no writes**: it reports what
  `build` would do under the same flags and exits under the same
  conditions — and, because it is the CI drift gate, it ALSO exits `1`
  whenever a build would write anything: a committed schema or catalog
  entry that differs from what the config generates, or one that is
  missing, is stale, and the message says to run `schemastore build` and
  commit the result (`StaleError`, evaluated after the gate and drift
  verdicts). Orphaned outputs count toward the same `StaleError` but are
  carried separately in its `orphaned` field, so the final line names
  the remedy a build cannot supply: `N orphaned output(s) must be deleted
  by hand; build never will.` It retires the six drift tests. Never-writes is one predicate, not a separate code path: both modes
  share one `SchemaFile`, and `Runner` gates every write — schemas and
  catalog entries alike — on a single `writing` predicate
  (`mode === "build" && !refused`), pinned by the "check never writes"
  tests. Because `check` reports what `build` would do, it also reports
  `held` for the clean siblings of a gate failure or a refused drift,
  exactly as a build would.
- A merged catalog that cannot be assembled — a catalog URL or entry
  name advertised more than once, or a slice that is not a catalog entry
  array — fails both modes with `CatalogMergeError` (exit `1`, evaluated
  after the gate and drift verdicts and before `StaleError`), naming every
  conflicting URL or name with its slices and every invalid slice. `build` still writes the
  schemas and its own slice; only the merged file is left as it is.
- `--force` is sugar for `--drift=allow` — and nothing more: combined
  with an explicit `--drift` other than `allow` it is a contradiction,
  refused before the config loads as `ConflictingFlagsError` at exit
  `64` (a usage error, not a run outcome) rather than silently resolving
  to `allow`.
- `validate` answers the question the publication story exists for: does
  THIS payload conform to the published document it names? The reference
  is `--schema` or the payload's own `$schema`, resolved file-first and
  then against every identity a config schema derives — a target `$id`, a
  frozen version's `$id`/`url`, the catalog `url` — so CI validates an
  action's output against the committed document with no third-party tool
  and no network fetch. A payload that cannot be read or parsed fails
  `PayloadError` at exit `2`; a reference that is neither an existing file
  nor a derived identity, or names a document that cannot be read or
  parsed, fails `SchemaResolutionError` at exit `2`; a payload naming
  nothing with no `--schema` given is `MissingSchemaRefError` at exit
  `64`. The payload's `$schema` self-reference is the pointer naming the
  document, not contract data: it is stripped before validating ONLY when
  the resolved document does not declare `$schema` as a root property — a
  generated document sets `additionalProperties: false`, which would
  otherwise reject the very self-reference that names it. A document that
  DOES declare `$schema` (the `HostedSchema` pattern, whose source struct
  carries `$schema: Schema.Literal(OutputSchema.$id)`, so the key is
  required and const-constrained) validates the payload verbatim and
  enforces its own constraint on the key. A non-conforming payload fails
  `ValidationFailedError` at exit `1`, one finding per problem carrying
  the JSON pointer into the instance and the keyword; an engine mechanism
  failure (`InstanceValidatorError`) flows unmarked to the runtime's exit
  `3`. `--format=json` writes one report document to stdout and moves the
  human lines to stderr, exactly as `build`/`check` do.
- `--format=json` emits one document on stdout — `mode`, `configPath`,
  `drift: { onDrift, policy? }` (`policy` present only when a flag forced
  one tolerance over every schema's own, never a `source` field),
  per-schema `{ $id, path, name, version?, published, change, verdict,
  policy, outcome, nextVersion?, frozen?, findings }`, one optional
  `catalog: { slice?, merged? }` — `slice: { path, entries, outcome,
  caseFoldedMatch? }`
  (`outcome` is `written`, `unchanged`, `would-write`, `held` or
  `orphaned`) and `merged: { path, entries, outcome, slices, conflicts?,
  invalid? }` (`outcome` adds `blocked`; `conflicts` —
  `[{ kind: "url", url, slices } | { kind: "name", name, slices }]` — and
  `invalid` — `[{ path, reason }]` — appear only
  when non-empty) — one
  optional `orphaned: string[]` (the unclaimed-document
  paths, in config order), and
  `drifted`/`gateFailed`/`wrote`. Human text moves to stderr in this mode
  so stdout stays parseable.
- A bare `schemastore` or `--help` prints help and exits `0`; a no-match
  must not fail.

Exit codes:

| code | meaning |
| ------ | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error`, a gate failure, a missing frozen version (`FrozenVersionMissingError`), a frozen file without its derived `$id` (`FrozenVersionIdMismatchError`), a merged catalog blocked by a URL or name conflict or an invalid slice (`CatalogMergeError`), — for `check` — any document `build` would write (a catalog slice or the merged catalog included), an orphaned slice or merged catalog, or an orphaned document at a sibling shape of a derived path, or — for `validate` — a payload that does not conform to the resolved document (`ValidationFailedError`, one finding per problem, pointer and keyword each) |
| 2 | config not found, failed to load, failed `SchemastoreConfig` validation, a `catalogDir` that is a file or cannot be listed (`CatalogDirError`, raised before anything is written), or — for `validate` — a payload that cannot be read or parsed (`PayloadError`) or a schema reference that resolves to no readable document (`SchemaResolutionError`) |
| 3 | infrastructure failure (`CliRuntime.main`'s `exitCode` fallback; for `validate`, an engine mechanism failure — `InstanceValidatorError`, a document the instance engine cannot compile — flows here unmarked) |
| 64 | usage error — `ShowHelp` carrying parse errors, `--force` combined with an explicit non-`allow` `--drift` (`ConflictingFlagsError`), or — for `validate` — a payload with no `$schema` and no `--schema` given (`MissingSchemaRefError`); `--wizard` on a run that is not interactive, since `CliEnv.layer` (from `main`'s `env`) installs `CliPrompt.gateWizard`, which drops the flag from that run's help and rejects it (it exited `0` under the old bespoke `reportFailures` wiring) |

The failure report is the kit's standard one: `main.ts` runs the program under `CliRuntime.main` with `exitCode: 3`, the
program's `loggerLayer`, and `env: { appModule: import.meta.url }`. A failure prints on stderr as a status line naming the
error and its message (`✗ DriftError: 1 published schema(s) drifted; nothing was written.`), the message's further lines,
and, when the failure happened inside a span (a missing config, raised before any, prints none), an `in:` trail of the command's own spans, the kit's left out (which `appModule` keeps true once the command is
installed under `node_modules/@effected/`). It replaced a bespoke `reportFailures` render that printed `error.message`
alone, so the error-tag prefix (`DriftError:`), the status glyph, the colour for a person, the GitHub log form under Actions and the
`in:` line (only for a failure raised inside a span) are the visible differences; the exit codes did not change, except that `--wizard` on a non-interactive run is now a usage error at `64` and absent from that run's help.

## The catalog: slices and the merged file

Several `schemastore.config.ts` files may share one `outputDir` — a
monorepo publishing into a shared deploy folder — and so one catalog.
Each config therefore owns a **slice**, and the merged catalog is
derived from every slice:

- **The slice** is `<catalogDir>/<name>.json`: a bare SchemaStore
  catalog entry array of every entry the config declares, canonical
  JSON, content-compared, and rewritten wholesale — so a removed
  schema's entry drops out of it. A config that declares no entry writes
  no slice; one still on disk is `orphaned` (stale under `check`, never
  deleted by `build`) and is still merged, so the merged catalog keeps
  advertising its entries until it is deleted by hand.
- **The merged catalog** is `catalog.json` in `catalogDir`'s parent
  (`<outputDir>/catalog.json` under the default `catalogDir`, the same
  URL a host serves): the union of every `*.json` slice in `catalogDir`,
  sorted by entry `url` in code-unit order, canonical JSON,
  content-compared. When the running config declares entries, its slice
  is **replaced by the entries it computes now**, never read from disk,
  so `check` compares against what a build would produce; when it
  declares none, its on-disk slice (an orphan) is merged **as-is**,
  exactly as every other config sees it. The merge is a pure function of
  disk plus the running config's non-empty fresh entries, so whichever
  config builds last writes the identical file — `check` is green for all
  of them at once, and an orphaned slice is the single thing its owner's
  `check` reports.[^runner]
- `catalogDir` is the ownership record, and the one directory the CLI
  lists: every `*.json` file directly in it is one config's slice by
  construction (anything else there — a README, a subdirectory — is
  ignored). It is listed before anything is generated: absent is fine, but
  a `catalogDir` that is a file or cannot be listed fails
  `CatalogDirError` (exit `2`) with nothing written. The running config's
  own slice on disk is an **exact** `<name>.json` match. Only when there is
  none, and exactly one listed file case-folds to that name, does the
  Runner ask the **volume**, never the name: it `stat`s the exact
  `<catalogDir>/<name>.json`. A case-insensitive volume resolves that path
  to the one folded file, so the file is claimed as its own (reported as
  `caseFoldedMatch`) — a leftover `docs.json` is the file `Docs.json`
  names and never conflicts with the entries replacing it. A
  case-sensitive volume answers `NotFound`, so nothing is claimed: the
  variant is another config's slice, merged like any other. A case-only
  rename leftover there blocks the merge on the **first** build, as any
  rename leftover does, and every later build gives the same outcome;
  configs `docs` and `Docs` keep two slices that every config merges
  alike, and neither ever claims the other's. Several files folding alike
  claim nothing. Another config's slice that vanished
  between listing and reading is skipped. `outputDir` is still never listed
  ([decision](../decisions/output-dir-is-never-exclusively-owned.md)).
- **Two slices advertising one `url` is a conflict, and so is one entry
  `name` advertised twice** — `CatalogConflict` is the tagged union
  `{ kind: "url", url, slices } | { kind: "name", name, slices }`, URL
  conflicts first, each kind sorted by value in code-unit order. A name is
  counted only over the entries the merge advertises: an entry that lost
  its URL to another slice is reported once, as the URL conflict, and a
  foreign slice advertising one name twice is listed twice. A catalog
  display name (`catalog.name`) is decoupled from the key, so it no longer
  inherits the key's uniqueness; `defineConfig` enforces it within one
  config and the merge across configs. And **a slice that
  cannot be read (a dangling symlink, a permission failure), is not JSON,
  or is not a catalog entry array — one carrying a key a catalog entry
  does not declare included, since the decode rejects excess keys rather
  than stripping them — is invalid**, and each invalid slice carries its
  reason: `unreadable: <reason>` (`a dangling symlink`, `PermissionDenied`),
  `not JSON`, or the decode's own issues, one semicolon-separated clause each
  (`Expected array` for a document that is not an array; `Expected no
  excess property at [0]["extra"]` names every key outside
  `CatalogEntry`). Neither is
  merged silently or dropped: which entry a host serves would otherwise
  depend on which config built last. The merged report's outcome is
  `blocked`, the merged file is left as it is, and both modes fail
  `CatalogMergeError` (exit `1`) — the fix is an edit to the configs or
  the slices, never a rebuild.
- With no slice left (no slice file in `catalogDir` and no entry in the
  running config) but a merged file on disk, the merged catalog is
  `orphaned` — reported, never deleted. Deleting the last orphaned slice
  by hand is what leads there.
- `RunReport.catalog` is `{ slice?, merged? }` — `CatalogSliceReport`
  `{ path, entries, outcome, caseFoldedMatch? }` and `MergedCatalogReport`
  `{ path, entries, outcome, slices, conflicts, invalid }` — and is
  absent only when there is neither a slice nor a merged catalog to
  report.

## Reporting

- **Human** (default): one line per schema — `written (contract)`,
  `unchanged`, `would write (annotations)`, `DRIFT contract at published
  1.2 → suggest 1.3`, and `held (drift elsewhere)` or `held (gate failed
  elsewhere)` for a schema that passed but was not (or, under `check`,
  would not be) written because a sibling refused the run — with
  advisory findings indented beneath, one
  line for the catalog slice (`written catalog slice <path> (N entries)`),
  one for the merged catalog (`written catalog <path> (N entries from K
  slice(s))`; a blocked merge renders `CATALOG BLOCKED <path>` with one
  indented line per conflicting URL or name — `url <u> advertised by …`,
  `name <n> advertised by …` — and per invalid slice), one line per
  orphaned document, and a
  summary line whose `drift` count is
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
  · change · outcome), a catalog table (slice and merged rows: file ·
  entries · outcome, plus a problem table for a blocked merge), and the
  drift verdict. This is a short append in the CLI, not
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
  and `exports` of exactly `.` (`src/index.ts`, re-exporting only engine
  layers over the library's contracts — `AjvValidator` and
  `AjvInstanceValidator` — and nothing else) plus `./package.json`. The one entry
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
  unwritable; `validate` over a seeded volume — a conforming payload
  exits `0` against its `$schema` identity, a non-conforming one exits
  `1` with pointer-and-keyword findings, a document declaring `$schema`
  validates the payload verbatim (the `HostedSchema` pattern), an
  unresolvable reference exits `2`, a payload naming nothing exits `64`,
  and the `instanceValidator` seam replaces the engine.
- Two `effect/cli` notes the tests pin: a `Flag.Boolean` must
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
[^ajv-validator]: `packages/schemastore-cli/src/AjvValidator.ts` — `AjvValidator.layer`: strict mode, `KeywordFamilies` registration, `addFormats(ajv, { keywords: false })`, a fresh `Ajv` per call — all through the shared `internal/ajv.ts` `makeAjv`.
[^ajv-instance-validator]: `packages/schemastore-cli/src/AjvInstanceValidator.ts` — `AjvInstanceValidator.layer`: the same shared `makeAjv` pointed at an instance, findings as `InstanceFinding` values, compile failures as `InstanceValidatorError`.
[^cli-package-json]: `packages/schemastore-cli/package.json` — the `.` export to `src/index.ts`, `ajv` and `ajv-formats` as regular dependencies, `effect` and `@effected/schemastore` as peers.
[^runner]: `packages/schemastore-cli/src/Runner.ts` — `FrozenVersionMissingError`, `FrozenVersionIdMismatchError`, the frozen pre-flight (existence, then declared `$id`) that runs before generation, the catalog slice and merged-catalog writes, the `orphaned` and `blocked` catalog outcomes, and the sibling-shape probe that reports unclaimed leftover documents in `RunReport.orphaned`.
