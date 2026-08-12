---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 96
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - jsonc.md
  - yaml.md
  - semver.md
  - npm.md
  - workspaces.md
---

# @effected/lockfiles design

## Overview

`@effected/lockfiles` is lockfile parsing as pure string→model decoding. It holds the four package-manager lockfile parsers — bun's JSONC, npm's v2/v3 JSON, pnpm's YAML and yarn Berry's YAML — the unified `Lockfile` model they all normalize into, and pure integrity checking of that model against workspace manifests.

Its consumer is [`@effected/workspaces`](workspaces.md), whose `LockfileReader` service does the root find, package-manager detection and file read, then calls into this package. It is on the [release gate](../releases.md#the-gate) because workspaces reads lockfiles and downstream tooling consumes workspaces transitively.

## Tier and dependencies

**Pure tier.** No services, no layers, no IO, no `R` anywhere. A lockfile parser that reached for the filesystem would be boundary tier, so the IO stays out **by construction**: every entrypoint takes content as a string, and integrity checking takes manifests as input rather than reading them.

Peers are `effect` plus four pure-to-pure `workspace:^` edges — [jsonc](jsonc.md) for bun, [yaml](yaml.md) for pnpm and yarn Berry, [semver](semver.md) for integrity's range satisfaction, and [npm](npm.md) for the shared specifier, dependency-field and integrity-hash vocabulary. Each is mirrored by a plain `workspace:*` devDependency; the two specifiers deliberately differ so a published patch floats.

Zero external runtime dependencies — the text-parsing engines arrive through the sibling packages, so unlike glob and toml **there is nothing to vendor here**.

## The two seam properties

Two responsibilities that a naive extraction would split across parser and reader are structural properties of this API instead.

### pnpm importer-path→name resolution is an explicit second stage

pnpm lockfiles name workspace packages by importer *path*, with a placeholder version; the real names live in the `package.json` files. Both stages of the resolution are pure and explicit:

- `Lockfile.parse` emits the honest importer-path-keyed model for pnpm, and the already-name-resolved model for the other three, whose lockfiles carry real names.
- `withImporterNames(names)` — a total, pure instance method — rewrites workspace package names **and both ends** of workspace dependency edges from an importer-path→name map. Entries not in the map keep their path name, and non-pnpm lockfiles are unaffected.

The manifest IO that builds the map is the consumer's job, not this package's.

### Integrity checking is total and pure

`LockfileIntegrity.compare(lockfile, manifests)` takes the manifests as values and returns the report **infallibly** — a plain function, no `Effect`, no error channel. Unparseable ranges and versions, and the `workspace:`/`link:`/`file:` specifiers, are skipped, because constraint checking is best-effort by design; totality therefore costs no behavior.

It is named `compare`, not `check`, because every v4 `Schema.Class` already carries a reserved `static check(...)` for attaching schema checks — a naming constraint every domain static in the kit must dodge.

The manifest input is a **minimal structural schema** of its own, deliberately *not* [package-json](package-json.md)'s types: those live in a heavier boundary-tier package this pure one stays decoupled from, and structural typing lets a consumer pass values derived from either.

Integrity keeps **every** resolved version per name, so a constraint is satisfied when *any* parseable resolved version matches — never dependent on lockfile entry order — and an unsatisfied row reports all candidates.

## Module layout

Module-per-concept, with the value classes as leaf modules so the parser internals and the `Lockfile` dispatcher can both import them without closing a cycle. The format literal set lives in its own module alongside the filename functions in both directions, since filename knowledge is lockfile domain.

The per-format **raw schemas stay private** under `internal/`: they are permissive validation scaffolding, not API. Each internal transform returns a raw failure record, and the public parse error — with the format attached — is materialized by the dispatcher, which keeps the error class in the public module without an import cycle back into the internals.

## The model

`Lockfile` is a `Schema.Class` carrying the format, the lockfile version, the resolved packages, the workspace dependency edges, the importers and an optional per-format extension. See `src/Lockfile.ts` for the full shape.

`Lockfile.parse` is the package's **only fallible boundary**. Everything else is total: the importer-name rewrite, name and importer lookup (both backed by lazily built private indexes outside the schema — the array fields stay for serialization and iteration), the workspace-packages getter and integrity comparison.

Three vocabulary decisions point outward rather than re-declaring shapes: a resolved package's integrity is [npm](npm.md#the-vocabulary-modules)'s branded hash — an unparseable checksum is dropped rather than thrown, and the brand's yarn cache-key form is what keeps yarn Berry's checksums from silently vanishing; the dependency-type fields use npm's shared field literal; and the pnpm extension exports its catalog record type so workspaces types against it instead of re-declaring the shape.

The filename functions distinguish **detection vocabulary from parse routing**: one format can be written under several filenames (a shrinkwrap, a binary variant), so the plural form lists them primary-first while the reverse lookup answers for the primary names only. Workspace-config extras are a consumer's cache policy and stay out.

### The parse error

One error class, carrying the format, a `stage` literal distinguishing a text-level parse failure from a schema-shape failure, and a structured cause preserving the underlying engine error. Malformed input is a recoverable typed failure, **never a defect**.

It carries **no path field** — parse takes content, not a path, and the caller that did the IO owns the path context. The read error lives in workspaces with the reader service.

## Document framing: a lockfile is a YAML *stream*

A lockfile is not always one YAML document. pnpm writes its lockfile as **two YAML documents** when the workspace uses config dependencies: an "env" preamble, then the lockfile. This repo's own lockfile is that shape.

Both documents declare the same top-level keys, so the preamble **validates cleanly** against the pnpm schema — a single-document parse *succeeds* and returns a `Lockfile` with one package and no workspace importers, reporting an apparently empty workspace. That silent success is the defect this rule closes.

**The framing rule is deterministic, not a heuristic.** pnpm's own writer composes the file as env-prefix followed by the main document, so the preamble is always a *prefix*, never a suffix: **the lockfile is the LAST document, by the writer's contract.** No structural rule would work — both documents carry the same keys, so "the document with importers wins" picks the preamble just as happily. Position is the only sound discriminator. `src/internal/documents.ts` owns this, selecting over the parsed stream by position, which additionally keeps readable a normalized single-document lockfile carrying a leading marker that a byte-sniffing rule would misread as env-only.

The other three parsers were **checked, not assumed**. yarn shares the YAML shape but defines no document framing, so a multi-document yarn lockfile fails typed rather than being silently truncated to its first document — where the format states no rule, this package refuses to guess. npm and bun never share the hazard, because a second top-level value is a syntax error in both engines; the suite pins that rather than assuming it.

The framing error carries the format, the document count and a reason, and **no cause** — the text parsed fine, so there is no foreign throwable to wrap.

The invariant: **an unlocatable lockfile fails typed; it can never return an empty `Lockfile`.** The transferable lesson, mutation-checked in the suite: a parser that succeeds on the wrong input is worse than one that fails, and "empty result" is the most dangerous success shape because it is indistinguishable from a legitimate empty answer.

## Importers

The importers field records each workspace importer's *declared* dependencies — the data a before/after lockfile diff needs, which is what its driving consumer ([silk-update-action](../consumers/silk-update-action.md)) parses two texts through the pure boundary to compare. Two leaf value classes back it.

**`ImporterDependency`** holds one declared dependency. Its specifier is [npm](npm.md#dependencyspecifier)'s branded specifier via that package's string codec, so a decoded value is tag-matchable while **encoding round-trips the exact original string** — the brownfield guarantee. Its version is **pnpm-only**, because pnpm records a specifier-and-version pair per importer dependency while bun and npm record resolved versions on package entries, so consumers there join by name against the packages array.

That version is always the **plain** version: pnpm's peer-disambiguation context is split off into a separate optional field holding the raw parenthesized chain, and `link:`/`file:` resolutions pass through verbatim. The split has **one implementation** in `internal/shared.ts`, shared with the pnpm package-key parser, so the two cannot disagree about where a version ends.

**`LockfileImporter`** holds the root-relative importer path — the same keys the consumer's own importer map uses — plus the dependencies.

Three behaviors are contract, not incident: pnpm, bun and npm populate importers off a shared dependency-sections table; **yarn always yields an empty array**, documented behavior since yarn records no importers; and the importer-name rewrite deliberately **does not touch importers**, because they stay keyed by path, which is the join key. Construction uses conditional spreads for the optional fields, since v4's validating constructors throw on an explicit `undefined` for an optional key.

The specifier taxonomy comes from npm rather than package-json because npm is the pure vocabulary package built to be shared. See the [npm vocabulary registry](npm.md#vocabulary-registry) for what this package keeps and discards from each lockfile format.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply, and this package's position is unusually good: **it adds no new text-parsing engine and no new recursion surface.** Text parsing is delegated to already-hardened siblings, with npm's native parse wrapped so its throw on hostile input lands in the typed channel. The transforms are single-pass iterations over flat records.

What the transforms still owe:

- **Prototype-pollution discipline.** Lockfile keys are attacker-adjacent strings. Key-bearing intermediates stay `Map`s and `Set`s, records are built with own-property semantics rather than manual assignment, and the hostility suite proves a dunder key neither pollutes nor crashes.
- **Total string surgery.** The `name@version` splitters, yarn's descriptor extractors and the dependency cleaners stay total — malformed keys are *skipped* or fail validation, never throw. Rows that would construct a non-empty string from an empty one are skipped, since v4's validating construction would otherwise turn malformed input into a defect at construction time.
- **Scope honesty.** Yarn support is **Berry only**. Classic v1 content is not YAML; whether it happens to parse or not, it must exit through the typed parse error and never mis-normalize. A fixture pins this.

## Observability

Pure-tier house rule: a named `Effect.fn` span on the single public fallible boundary and nothing else. The total methods are span-free. Operational logging belongs to the consumer's reader, which owns the IO story. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. No platform packages, no mock layers, no `TestClock`. Four families:

1. **Per-format fixture tests** across each manager's lockfile versions, asserted against the unified model — package identification, integrity, workspace dependency edges and extension payloads.
2. **Seam-property tests** — the importer-name rewrite renames pnpm workspace packages and rewrites both edge ends while leaving unmapped entries, non-pnpm lockfiles and importers untouched; integrity comparison covers the valid, missing, extra, unsatisfied and skipped cases, fed by in-memory manifests, so **there is no IO anywhere in the suite**.
3. **A hostility suite** — malformed text and wrong shape each landing on their own stage, yarn classic content, dunder and hostile `name@version` keys, plus nesting bombs proving the delegated engines' typed failures surface through this package's error. The document-framing tests are **mutation-checked**: reverting the framing rule or disabling a guard turns them red.
4. **Codec round-trips** via `it.effect.prop` over derived arbitraries, asserting encode-decode identity, since the model is API for serialization consumers.

## Build and scaffold

Per [package-setup.md](../package-setup.md): scaffolded from a pure sibling, model paths under `website/lib/models/lockfiles`. The model and error classes are class factories, so `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Because it has workspace peers, the package needs a `prepare` script so turbo's upstream-build ordering applies.

## Consumer contract

[`@effected/workspaces`](workspaces.md)' `LockfileReader` finds the root, detects the package manager, reads the file — its read error stays there — and calls `Lockfile.parse` **directly**, because document framing is this package's job, not the reader's. For pnpm it then reads the workspace manifests and applies the importer-name rewrite; integrity is manifest IO plus the comparison; resolved-version lookup is the name index.

Workspaces defines its **own** package-manager literal rather than aliasing this package's format literal. The two are structurally identical and assign freely, but they are different concepts — which manager drives this workspace, versus which lockfile grammar to parse — and a separate name avoids colliding with [package-json](package-json.md)'s package-manager class in a consumer's imports.

## Known limitations

- **The importer-name map carries names only.** pnpm workspace packages keep their placeholder version after the rewrite. If a consumer needs real versions in the model, the map value can widen to carry one.
- **Bun's package-tuple shape is under-documented upstream**, so integrity is read from an assumed tuple position. The permissive reading is kept, pinned by a fixture from a current bun release.
