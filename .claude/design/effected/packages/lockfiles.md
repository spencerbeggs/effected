---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - glob.md
  - workspaces.md
---

# @effected/lockfiles design

## Overview

Target design for `@effected/lockfiles`, the **ninth** package migration (step 2 of [migration-playbook.md](../migration-playbook.md)) and a **pure-tier** package. Lockfiles is lockfile parsing as pure string→model decoding: the four package-manager lockfile parsers (bun `bun.lock` JSONC, npm `package-lock.json` v2/v3, pnpm `pnpm-lock.yaml`, yarn Berry `yarn.lock`), the unified `Lockfile` model they all normalize into, and pure integrity checking of that model against workspace manifests. It is extracted from `workspaces-effect` (v2.0.1) per the [workspaces review](../../reviews/workspaces.md) §5, which judged the seam clean **after two pre-repairs**; both are made structural here rather than patched.

Its consumer is [`@effected/workspaces`](workspaces.md) — **now merged** — whose `LockfileReader` service (root find + PM detect + file read + dispatch) stays there and consumes this package. Like `@effected/glob`, lockfiles landed before its consumer existed; it is on the [release gate](../releases.md#the-gate) because `workspaces` reads lockfiles and `vitest-agent` consumes workspaces transitively.

## Tier and dependencies

**Pure tier.** No services, no layers, no IO, no `R` anywhere. A lockfile parser that reached for the filesystem would be boundary tier — the inventory's standing caveat — so the IO stays out by construction: every entrypoint takes `content: string`, and the one operation that used to do IO (integrity's manifest reads) now takes manifests as input.

Peer closure per the config-file-jsonc precedent: `peerDependencies` are `effect` (`catalog:effect`) plus the three pure-to-pure `workspace:*` edges — `@effected/jsonc` (bun's JSONC), `@effected/yaml` (pnpm and yarn Berry are YAML) and `@effected/semver` (integrity's range satisfaction) — each mirrored in `devDependencies`. Zero external runtime dependencies; the text-parsing engines arrive through the sibling packages, so unlike glob and toml there is nothing to vendor.

## The two seam repairs (the headline work)

The v3 seam was dirty in exactly two places, both named by the review; the redesign makes each a structural property of the API instead of a reader-side patch.

### 1. pnpm importer-path→name resolution becomes an explicit second stage

v3's pnpm parser emits workspace packages named by importer *path* with version `"0.0.0"`, and `LockfileReaderLive` then re-reads every `package.json` and rebuilds packages and dependency edges with real names — normalization split across parser and reader, "half a normalization" if extracted as-is.

Here the two-stage model is explicit and both stages are pure:

- `Lockfile.parse` emits the honest importer-path-keyed model (pnpm) or the already-name-resolved model (npm, yarn, bun — their lockfiles carry real names).
- `lockfile.withImporterNames(names: ReadonlyMap<string, string>)` — a total, pure instance method — rewrites workspace package names **and** the `from`/`to` ends of workspace dependency edges from an importer-path→name map. Entries not in the map keep their path name; non-pnpm lockfiles are unaffected (no workspace `relativePath` matches). The manifest IO that builds the map is workspaces' job.

### 2. Integrity checking becomes total and pure

v3's `checkLockfileIntegrity(lockfileData, root, fs, path)` read every workspace `package.json` itself — the only IO in the extraction scope, and the only reason `LockfileIntegrityError` existed. The redesign inverts the dependency: `LockfileIntegrity.check(lockfile, manifests)` takes the manifests as values and returns the report **infallibly** — a plain function, no Effect, no error channel. `LockfileIntegrityError` is deleted, not ported. Unparseable ranges/versions and `workspace:`/`link:`/`file:` specifiers are skipped exactly as in v3 (constraint checking is best-effort by design), so totality costs no behavior.

The manifest input is a minimal structural schema, `WorkspaceManifest` (`name` plus the four optional dependency records) — deliberately *not* `@effected/package-json`'s types, which live in an integrated-tier package this one must not depend on. Structural typing lets workspaces pass values derived from either.

## Module layout

Module-per-concept, with the value classes as leaf modules so the parser internals and the `Lockfile` dispatcher can both import them without cycles (`noImportCycles`; the glob `types.ts` precedent):

```text
packages/lockfiles/
  src/
    LockfileFormat.ts       # Literals("bun","npm","pnpm","yarn"), filenameFor, fromFilename
    ResolvedPackage.ts      # ResolvedPackage class
    WorkspaceDependency.ts  # WorkspaceDependency class + DependencyType literal
    PnpmExtension.ts        # PnpmExtension class + PnpmCatalogs type
    BunExtension.ts         # BunExtension class
    Lockfile.ts             # Lockfile class, static parse dispatcher, withImporterNames,
                            # packagesNamed, LockfileParseError
    LockfileIntegrity.ts    # LockfileIntegrity class + static check + WorkspaceManifest
    index.ts                # public surface, re-exports only
    internal/
      shared.ts             # extractWorkspaceDeps, isWorkspaceSpecifier, WorkspaceEntry
      bun.ts npm.ts pnpm.ts yarn.ts   # per-format raw schemas + transforms (private)
  __test__/
    fixtures/               # ported from workspaces-effect (pnpm v1–v3, npm v1–v2,
                            # yarn v1–v2, bun v1–v3)
    ...
```

The per-format **raw schemas stay private** in `internal/` — the review's option taken deliberately: the raw shapes are permissive validation scaffolding, not API. Each `internal/<format>.ts` exports one transform, `parse<Format>(content) → Effect<fields, LockfileParseError>`, returning the field bundle `Lockfile.parse` constructs from; internals import only the leaf model modules, never `Lockfile.ts`.

## Public surface

### Lockfile

`class Lockfile extends Schema.Class<Lockfile>("Lockfile")` — v3's `LockfileData`, renamed per the review, with `packageManager` renamed to `format` (this package models lockfiles, not package managers) and `pmSpecific` renamed to `extension`:

- `format: LockfileFormat`, `lockfileVersion: string`, `packages: ReadonlyArray<ResolvedPackage>`, `workspaceDependencies: ReadonlyArray<WorkspaceDependency>`, `extension?: PnpmExtension | BunExtension` (optionalKey).
- `Lockfile.parse(content, { format }): Effect<Lockfile, LockfileParseError | LockfileFramingError>` — the package's only fallible boundary, wrapped in `Effect.fn("Lockfile.parse")`, dispatching to the internal per-format transform. (The `LockfileFramingError` arm was added by [#58](#document-framing-a-lockfile-is-a-yaml-stream); the original design had `LockfileParseError` alone.)
- `withImporterNames(names)` — seam repair 1, above.
- `packagesNamed(name): ReadonlyArray<ResolvedPackage>` — the multi-version lookup that replaces v3's `Request`/`RequestResolver` machinery (deleted per the review: a request cache over an already-memoized `Map.get` had nothing to deduplicate). Backed by a lazily built `#private` name index outside the schema — the `WorkspaceStateSnapshot` precedent.
- `workspacePackages: ReadonlyArray<ResolvedPackage>` getter (`isWorkspace` filter, computed).

`LockfileFormat` owns the filename knowledge both directions: `filenameFor(format)` (v3's `lockfileNameFor`, moved here — it is lockfile domain, not detection) and `fromFilename(name): Option<LockfileFormat>`.

`ResolvedPackage` and `WorkspaceDependency` port shape-for-shape (v4 spellings: `optionalKey` for `integrity`/`relativePath`, the v4 default mechanism for `dependencies` defaulting to `{}`). `DependencyType` (v3's private `DepType`) is exported — both `WorkspaceDependency.depType` and integrity's `unsatisfiedConstraints[].depType` use it, and consumers branch on it. `PnpmExtension`/`BunExtension` keep their `_tag` discriminants and fields; `PnpmExtension.ts` also exports the `PnpmCatalogs` record type (`Record<string, Record<string, string | { specifier; version }>>`) so `CatalogSet.fromLockfileCatalogs` in workspaces types against it instead of re-declaring the shape ([review §5](../../reviews/workspaces.md)).

### LockfileParseError

One error class per the errors-near-domain rule, `Schema.TaggedErrorClass("LockfileParseError")`:

- **Shape:** `format: LockfileFormat`, `stage: Literals("syntax", "validation")` (text-level parse failure vs. schema-shape failure), `cause: Schema.Defect` preserving the underlying jsonc/yaml/JSON/Schema error — the structure-preserving-errors house rule; v3's `cause: unknown` and its detail-destroying `mapError` collapses are not carried forward.
- **Kind:** recoverable typed failure — malformed input is never a defect (the hardening invariant).
- **Audience:** calling code (stable `_tag`, `format`/`stage` to branch on) and the end user (message names the format and stage); v3's `lockfilePath` field is dropped — parse takes content, not a path, and the caller that did the IO owns the path context.

`LockfileReadError` (IO) stays in workspaces with the `LockfileReader` service. `LockfileIntegrityError` is deleted (seam repair 2).

## Document framing: a lockfile is a YAML *stream*

**Added post-merge by [PR #58](#as-built-2026-07-10), which is a design change and not merely a fix.** The original design assumed a lockfile is one YAML document. It is not.

pnpm 11 writes `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies`: a config-dependencies ("env") preamble, then the lockfile. This repo's own lockfile is that shape. Both documents declare `lockfileVersion`, `importers` and `packages`, so the preamble *validates cleanly* against the pnpm schema — a single-document parse **succeeded** and returned a `Lockfile` with one package, no workspace importers and no catalogs. It did not fail. It reported an apparently empty workspace, which any consumer reads as "this monorepo has no packages" rather than "parsing went wrong". The `@effected/workspaces` self-discovery integration test is what caught it.

**The framing rule is deterministic, not a heuristic**, and finding that rule is the point of the section. It comes from pnpm's own reader/writer: `writeEnvLockfile` composes the file as env-prefix followed by the main document, so the preamble is always a *prefix*, never a suffix, and `extractMainDocument` reads back everything after the first separator. **The lockfile is therefore the LAST document, by the writer's contract.** `src/internal/documents.ts` owns this.

It matters that **no structural rule would have worked.** Both documents carry the same keys, so a "document with importers wins" heuristic — the first cut, in the workspaces reader — picks the preamble just as happily. Position is the only sound discriminator. Selection is done over the *parsed stream* by position rather than by byte-sniffing a leading separator the way pnpm does: same outcome for every file pnpm writes, and it additionally keeps readable a normalized single-document lockfile that happens to carry a leading marker, which pnpm's own byte rule would misread as env-only.

**Silence was the real defect**, so an unlocatable lockfile now fails typed and can never return an empty `Lockfile`. `LockfileFramingError` carries typed fields (`format`, `documents`, `reason`) and **no `cause`** — the text parsed fine, so there is no foreign throwable to wrap. Its `reason` is one of `noLockfileDocument` (the stream carries no lockfile document, including the env-only lockfile pnpm really does write, which pnpm itself reads as "no lockfile"), `noImporters` (the located document declares no importers, so it describes no workspace — pnpm always records at least the root) or `unexpectedDocuments` (multi-document input to a format that defines no framing).

The other three parsers were **checked, not assumed**. yarn shared the assumption — `yarn.lock` is YAML and also went through a single-document parse — and yarn defines no document framing, so rather than invent a rule, a multi-document `yarn.lock` now fails typed instead of being silently truncated to its first document: **where the format states no rule, we refuse to guess.** npm and bun never shared it, because a second top-level value is a syntax error in both `JSON.parse` and `Jsonc.parse`; the suite pins that rather than assuming it.

### LockfileIntegrity

`class LockfileIntegrity extends Schema.Class<...>("LockfileIntegrity")` — `valid`, `missingWorkspaces`, `extraWorkspaces`, `unsatisfiedConstraints` (struct rows carrying `DependencyType`), ported shape-for-shape — plus `static check(lockfile: Lockfile, manifests: ReadonlyArray<WorkspaceManifest>): LockfileIntegrity`, the total pure function of seam repair 2. Range satisfaction goes through `@effected/semver` (`Range.parse`, `SemVer.parse`, `range.test`); parse failures on either side skip the row, as in v3.

## Hardening

[hardening-a-parser-port](../effect-standards.md#input-hardening-standards) applies, and this package's position is unusually good: **it adds no new text-parsing engine and no new recursion surface.** Text parsing is delegated — bun to `@effected/jsonc`, pnpm/yarn to `@effected/yaml`, both already hardened (depth caps, alias budgets, typed failures); npm to native `JSON.parse` inside `Effect.try` (native parser, no JS stack surface; its throw on hostile input — including V8's `RangeError` on pathological depth — lands in the typed channel as `stage: "syntax"`). The transforms themselves are single-pass iterations over flat records.

What the transforms still owe:

- **Prototype-pollution discipline.** Lockfile keys are attacker-adjacent strings (`__proto__`, `constructor`) used as collection keys. Key-bearing intermediates stay `Map`s (as in v3); decoded `Schema.Record` fields are produced by schema decode, not manual assignment; the hostility suite proves a `__proto__` importer/package key neither pollutes nor crashes.
- **Total string surgery.** The `name@version` splitters (`lastIndexOf("@")` in bun/pnpm), yarn's descriptor extractors (`@npm:`/`@workspace:`/`@patch:`, compound keys) and `cleanYarnDeps` must stay total — malformed keys are *skipped* (v3 behavior, kept) or fail validation, never throw.
- **Scope honesty.** Yarn support is **Berry only**, as in v3. Classic (v1) `yarn.lock` is not YAML; whether it happens to YAML-parse or not, it must exit through `LockfileParseError`, never mis-normalize — a fixture pins this.

## Observability

Pure-tier house rule: a named `Effect.fn` span on the public fallible boundary — `Lockfile.parse` — and nothing else. `LockfileIntegrity.check`, `withImporterNames` and `packagesNamed` are total and span-free. v3's per-parser `Effect.logDebug` calls and span-per-format do not port; the operational logging belongs to workspaces' `LockfileReader`, which owns the IO story. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. No platform packages, no mock layers, no TestClock (nothing reads the clock). Families:

1. **Per-format fixture tests.** The ported fixture corpus (pnpm v1–v3, npm v1–v2, yarn v1–v2, bun v1–v3) asserted against the unified model: package counts, workspace identification, integrity hashes, workspace dependency edges, extension payloads (pnpm catalogs/overrides/settings, bun catalog/trustedDependencies).
2. **Seam repair tests.** `withImporterNames` renames pnpm workspace packages and rewrites both edge ends, leaves unmapped and non-pnpm entries untouched; `LockfileIntegrity.check` covers valid / missing / extra / unsatisfied / workspace-specifier skip / unparseable skip, fed by in-memory manifests (no IO anywhere in the suite).
3. **Hostility suite.** Malformed text per format → `stage: "syntax"`; well-formed text with the wrong shape → `stage: "validation"`; yarn classic v1 content; `__proto__`/`constructor` keys in importers, packages, dependency maps; hostile `name@version` keys (`@`, `@scope/`, no `@`); deep-nesting bombs proving the delegated engines' typed failures surface through `LockfileParseError` rather than defects.
4. **Codec round-trips.** `it.effect.prop` over `Schema.toArbitrary`-derived `Lockfile`/`ResolvedPackage` values, encode∘decode identity — the model is API for serialization consumers (workspaces snapshots), so the codec is contract, not incidental.

## Build and scaffold

Per [package-setup.md](../package-setup.md): copy a pure sibling (config-file-jsonc is the closest peer-shape match) into `packages/lockfiles`, model paths `../../website/lib/models/lockfiles`, `repository.directory: packages/lockfiles`. The model classes and `LockfileParseError` are class factories, so `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Because it has `workspace:*` peers, the package needs the same `prepare`/build ordering the config-file adapters use (turbo `^build:dev` covers it).

## Consumer impact: the workspaces port (landed)

[`@effected/workspaces`](workspaces.md) merged, and its `LockfileReader` re-expressed exactly as predicted: find root, detect PM, read file (`LockfileReadError` stays there), `Lockfile.parse` — then for pnpm, read the workspace manifests it already knows how to read and apply `withImporterNames`; integrity becomes manifest IO plus `LockfileIntegrity.compare`; `resolvedVersion` becomes `packagesNamed(name)[0]` with no request cache; `CatalogSet.fromLockfileCatalogs` types against `PnpmCatalogs`.

The one open question resolved differently than either option offered: workspaces defines its **own** `PackageManagerName` literal rather than aliasing `LockfileFormat` or mapping at the boundary. The two are structurally identical and assign freely — which is what `LockfileReader` relies on — but they are different concepts (which manager drives this workspace, versus which lockfile grammar to parse), and a separate name also avoids colliding with `@effected/package-json`'s `PackageManager` in a consumer's import list.

`LockfileReader` calls `Lockfile.parse` **directly**: document framing is this package's job, not the reader's (see [Document framing](#document-framing-a-lockfile-is-a-yaml-stream)).

## Open items

- **Importer-name map carries names only.** pnpm workspace packages keep version `"0.0.0"` after `withImporterNames` (v3 parity — the reader never fixed versions either). If the workspaces port wants real versions in the model, the map value can widen to `{ name, version? }` then; not speculated now.
- **v4 spellings to verify at port time** (evidence ladder, not memory): `Schema.Literals` for the format/stage unions, the v4 default mechanism replacing `optionalWith(default)`, `Schema.toArbitrary` on classes with `#private` fields, and `@effected/semver`'s `Range.parse`/`SemVer.parse` error types for the skip-on-failure integrity path.
- **Bun package-tuple shape** is under-documented upstream (integrity assumed at tuple index 3). The permissive v3 reading is kept; a fixture from a current bun release pins it.

## As built (2026-07-10)

The port landed with 59 tests (per-format fixture family 12, seam repairs 13, hostility 24, codec round-trips 5, LockfileFormat 5) and a zero-warning `dist/prod/issues.json` whose suppressed bucket holds exactly the eight synthesized `_base` symbols. Deviations from the design above:

1. **`LockfileIntegrity.check` shipped as `LockfileIntegrity.compare`.** Every v4 `Schema.Class` factory already carries a `static check(...checks)` for attaching schema checks; declaring an incompatible domain static is a TS2417 error. The reserved factory statics (`check`, `make`, `makeOption`, `makeEffect`, `extend`, `annotate`, `annotateKey`, `rebuild`, `pipe`, `fields`, `identifier`, `ast`) are a naming constraint future designs must dodge up front.
2. **Internal transforms fail with a raw `ParseFailure { stage, cause }` record**, not `LockfileParseError` — the design's internal signature contradicted its own noImportCycles layout (the error class lives in `Lockfile.ts`, which imports the internals). The facade materializes the public error with `format` attached; the public contract is as designed.
3. **Empty-name skip guards beyond v3.** Rows that would construct `NonEmptyString` from `""` (nameless npm/bun entries, `""` pnpm importers, `""`-named bun workspaces) are skipped: under v4's validating construction a straight port would throw at `make`, turning malformed input into a defect. v3 carried this as a latent bug.
4. **Bun tuples read slightly stricter than v3**: non-string `tuple[0]` is skipped and non-string `tuple[3]` omitted rather than `String()`-coerced, so no fabricated `[object Object]` names or integrity values. Total-skip semantics preserved.
5. **The `dependencies` default** composes `withDecodingDefaultKey` + `withConstructorDefault` — v4 splits v3's `optionalWith(default)` into decode-side and constructor-side mechanisms, and parity needs both.
6. **`filenameFor`/`fromFilename` are module functions** beside the `LockfileFormat` schema const (a Literals const cannot carry statics), matching the module-layout sketch literally.
7. **Yarn `__metadata.version` validates as string-or-number** (Berry writes numbers; v3 cast it unvalidated). Entry `version` stays string-only as in v3.
8. **Integrity handles multi-version resolution (PR #38 review).** v3 (and the port as first shipped) indexed resolved versions in a last-wins `Map`, so with `foo@1.5.0` and `foo@2.0.0` the verdict depended on lockfile entry order. `LockfileIntegrity.compare` now keeps every resolved version per name: a constraint is satisfied when *any* parseable resolved version matches, and an unsatisfied row reports all candidates comma-joined in `resolved`. The same review cycle fixed the pnpm peer-suffix key split (first `(` starts the suffix), aligned npm's two workspace-name passes (`wsEntry`-first in both), and de-vacuous-ified the npm `__proto__` dependency-map hostility test (a literal `__proto__:` key never survives `JSON.stringify`; it is now built as a real own property and asserted through the parse).

Port-time probes worth keeping: v4 `Schema.Record` decode preserves a `__proto__` key as an own property — the pnpm hostility test pins that a `__proto__` importer becomes a package literally named `__proto__` with `Object.prototype` unpolluted — and `Schema.decodeUnknownExit` (sync, Exit-returning) is the right tool for total skip-on-parse-failure paths like integrity's semver checks, avoiding any Effect run inside a plain function.

### Post-merge: the multi-document fix (PR #58, 2026-07-11)

The one change to the shipped design, found by the `@effected/workspaces` migration and detailed in [Document framing](#document-framing-a-lockfile-is-a-yaml-stream) above. `src/internal/documents.ts` is new, `LockfileFramingError` is new, and `Lockfile.parse`'s error channel widens to `LockfileParseError | LockfileFramingError`.

**74 tests, up from 59** — 13 new, plus the two that arrived with the #38 review round. They cover the two-document case (asserting the preamble's config-dependency package is *absent* from the model, where it had previously been the only package present), single-document no-regression, the env-only / empty / no-importers typed failures, the yarn multi-document refusal, and the npm/bun framing posture.

**Mutation-checked twice**, which is the part worth imitating: reverting the framing rule to take the first document turns 5 tests red, and separately disabling the `noImporters` guard and the yarn guard turns their 2 tests red. A test for a silent-degradation bug that has not been watched failing is not evidence of anything — the original bug's whole nature was that it returned a plausible, successfully-parsed answer.

The transferable lesson: **a parser that succeeds on the wrong input is worse than one that fails**, and "empty result" is the most dangerous success shape there is, because it is indistinguishable from a legitimate empty answer. When a format's own writer defines an invariant (here, preamble-is-a-prefix), take the invariant; when it defines none (yarn), fail rather than guess.
