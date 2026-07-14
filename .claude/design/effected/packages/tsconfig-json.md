---
status: current
module: effected
category: architecture
created: 2026-07-13
updated: 2026-07-13
last-synced: 2026-07-13
completeness: 95
related:
  - ../roadmap.md
  - ../effect-standards.md
  - ../package-setup.md
  - ../migration-playbook.md
  - ../releases.md
  - ../package-inventory.md
  - jsonc.md
  - walker.md
  - config-file.md
  - ts-vfs.md
---

# @effected/tsconfig-json design

## Overview

Design and as-built record for `@effected/tsconfig-json`, the **one new gate package** from [roadmap.md §3](../roadmap.md#3-effectedtsconfig-json) and the first package designed after the migration program completed — a new invention scoped by consumer surveys, not a port of an existing `*-effect` repo. It got a full playbook cycle per [migration-playbook.md](../migration-playbook.md): design doc first, then build. The design was settled and approved in a brainstorming session on 2026-07-13 and **implemented the same day on `feat/tsconfig-json`** — full test suite green, zero-warning `dist/prod/issues.json`. This doc records decisions with their reasoning, not proposals; where implementation refined the design, the refinement is recorded as a decision in the relevant section, replacing the deferrals the pre-implementation draft carried.

The package reads, decodes, validates, resolves and constructs `tsconfig.json` files: string-level schemas for the document shape, full `extends`-chain resolution matching tsc semantics, nearest-tsconfig upward discovery, a data-owned codec between string option values and TypeScript's numeric enums, and a portable-tsconfig filter for virtual-TS environments. It exists to unblock the two surveyed consumers ([evidence base](#evidence-base-and-consumers)) and to enforce the repo's TypeScript posture: the version-coupled parts of tsconfig knowledge become plain data owned here, so no `@effected/*` package ever imports `typescript` (see [the TypeScript 5→6→7 posture](../roadmap.md#cross-cutting-the-typescript-567-posture)).

It is on the `0.1.0` release gate — the [gate proof](../roadmap.md#4-the-gate-proof) ports rspress-plugin-api-extractor against it — so [releases.md](../releases.md) and [package-inventory.md](../package-inventory.md) update when this package lands, per playbook step 7.

## One package, not two

A split into a pure `@effected/tsconfig` (schemas, validation, construction) plus a boundary `@effected/tsconfig-json` (IO) was considered and **rejected**. Four reasons, recorded so the split is not re-litigated:

- **[R3](../effect-standards.md#dependency-policy) already delivers the split's benefit.** Boundary tier does not propagate — a schema-only consumer of a boundary package pays no install cost for the IO surface, because `FileSystem`/`Path` are `effect` core in v4 and the package carries zero external runtime dependencies.
- **The [no-barrel](../effect-standards.md#no-barrel-re-exports) module-per-concept discipline already gives bundle isolation.** A consumer importing only the schema modules never references the loader modules, so their graphs tree-shake away — the same property [config-file measured](config-file.md#as-built-the-tree-shaking-property-is-measured-not-assumed) for its codecs. Package boundaries are not the unit of bundle isolation here; modules are.
- **The pure package could not even be jsonc-free.** String→document decoding belongs with the schemas (the house `FromString` static per [schema standards](../effect-standards.md#schema-standards)), and every tsconfig is JSONC, so the "pure" half would carry the `@effected/jsonc` edge anyway — the split would separate nothing cleanly.
- **Precedent runs toward consolidation.** `package-json` is one package spanning schemas and file IO; [the config-file consolidation](config-file.md#the-consolidation-2026-07-11) dissolved three adapter packages back into one; the runtimes/CLI split existed only to quarantine tier-3 `@effect/platform-node` and is being dissolved by roadmap workstream 1. No such quarantine motive exists here.

The two-layer instinct survives as **internal architecture**: pure schema and codec modules that never import `FileSystem`, and separate loader, resolver and discovery modules that do. See [module layout](#module-layout).

## Tier and dependencies

**Boundary tier** under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy). The package's own surface does file IO (loading, extends resolution, discovery) exclusively through `effect`-core `FileSystem`/`Path`, arriving via the `R` channel; `PlatformError` flows through on IO operations, per the boundary standard.

- `peerDependencies`: `effect` (`catalog:effect`) plus two `workspace:*` edges — `@effected/jsonc` (the JSONC decode engine) and `@effected/walker` (upward traversal for discovery and node_modules resolution). Both mirrored in `devDependencies`, per the walker/config-file precedent.
- `dependencies`: **none.** Zero external runtime dependencies ([R1](../effect-standards.md#dependency-policy)); both `@effected/*` edges are what R1 explicitly permits. `jsonc` is pure tier and `walker` is boundary tier, so the tier stays boundary by R3.
- **Hard rule: zero `typescript` imports anywhere, including type imports.** The TS-version-coupled enum mappings are owned as plain data (see [the numeric-enum codec](#the-numeric-enum-codec-data-not-typescript)); anything shaped like `ts.CompilerOptions` is typed structurally.

**No services, no layers.** The package exposes effectful statics that require `FileSystem`/`Path` in `R` — the [walker posture](walker.md#wiring-services-via-r-not-parameters) — discharged once by the consumer's platform layer at the edge. There is no per-consumer state or configuration that would earn a `Context.Service`.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept), one concept per file, every public name a file name, no barrels beyond `index.ts`. The internal two-layer split from [the one-package decision](#one-package-not-two) is visible in the as-built tree:

```text
packages/tsconfig-json/
  src/
    index.ts              # public surface, re-exports only
    TsconfigJson.ts       # the document schema + TsconfigJsonFromString + TsconfigParseError
    CompilerOptions.ts    # string-level option schemas, literal unions + passthrough
    ResolvedTsconfig.ts   # the pure extends-merge engine: absolutize / merge / substituteConfigDir
    TsEnumCodec.ts        # string↔numeric enum mappings as data (pure)
    PortableTsconfig.ts   # the portable filter (pure)
    TsconfigLoader.ts     # load by path + extends-chain resolution (IO) + TsconfigExtendsError
    TsconfigDiscovery.ts  # nearest-tsconfig upward search over walker (IO)
    internal/
      extendsTarget.ts    # extends-target resolution + hardened exports-map subset (IO, not exported)
  __test__/
```

Two as-built decisions refined the planned shape:

- **The extends-target resolver is one internal module, not part of the public surface.** `internal/extendsTarget.ts` owns both target forms — relative/rooted resolution and bare-specifier node_modules lookup, including a hardened subset of package.json `exports`-map resolution (dunder-key guards, `Object.create(null)` substitution, depth caps) — because target resolution is an implementation seam of the loader, not a concept a consumer names. A hostile manifest is absorbed to "no resolution for that candidate", never a defect. See the module header in `src/internal/extendsTarget.ts`.
- **The document codec's public name is `TsconfigJsonFromString`, a bare module-level const.** The house dotted-static `FromString` idiom assumes a `Schema.Class` with a static slot; `TsconfigJson` is a `Schema.StructWithRest` **value** (chosen for the passthrough rest row), which has no static slot, so the idiom was inapplicable. The codec is a sibling export whose name carries the module prefix, keeping it unambiguous on the flat entrypoint. It is bound once at module top level because `Jsonc.schema` derives fresh caches per call.

The first five source modules never import `FileSystem` — construction, validation, decoding of already-parsed objects, merging, enum conversion and the portable filter are all pure (`ResolvedTsconfig` takes an injected `join` rather than the `Path` service). Only the loader, discovery and internal target-resolver modules touch the `R` channel.

## Schema design: string-level, JSONC-always, forward-tolerant

The document schema models the **raw file shape**: `compilerOptions`, `extends` (string or string array), `files`, `include`, `exclude`, `references`, `watchOptions`, `typeAcquisition`, `compileOnSave`, `$schema`. The field inventory was checked precisely against `typescript@6.0.3` × the canonical schemastore definition (<https://www.schemastore.org/tsconfig.json>) at implementation time — this doc fixes the design rules; `src/TsconfigJson.ts` and `src/CompilerOptions.ts` are authoritative for the field-by-field listing.

- **Enum-valued options stay string-level literal unions** — `target: "es2023"`, `module: "nodenext"`, `moduleResolution: "bundler"`, likewise `jsx`, `moduleDetection`, `newLine` and the rest — case-insensitive on decode, the way tsc accepts them. This eliminates the numeric→string roundtrip that @savvy-web/bundler's tsconfig-resolver.ts currently performs; its enum maps move into this package as data.
- **TS ≥ 6 only.** Dead and removed options (`charset`, `out`, `suppressImplicitAnyIndexErrors` and their kin) get no typed fields — but they are not decode errors either; they ride the passthrough.
- **Forward- and backward-tolerant.** Unknown `compilerOptions` keys are preserved through decode via a passthrough record alongside the typed fields, never rejected; known keys validate strictly; unknown keys survive re-encode. Rationale: TypeScript adds options every minor release, and a schema pinned at publish time must not break on a newer consumer's tsconfig.
- **Every parse is JSONC.** The string→document codec (the house `FromString` static per [schema standards](../effect-standards.md#schema-standards)) decodes through [@effected/jsonc](jsonc.md) unconditionally — tsconfig.json files are JSONC regardless of the `.json` name. No JSON-strict path exists.
- **Construction and validation are pure.** `make` and decode of already-parsed objects need no IO and live in the pure schema modules.

## Extends resolution and merge semantics

The loader reads a tsconfig by path via `FileSystem`, decodes it as JSONC and resolves the full `extends` chain **matching tsc semantics**:

- Relative targets resolve against the extending file's directory.
- Array `extends` (TS 5+) is supported, later entries winning.
- Package-name targets resolve via plain upward node_modules **file** resolution over [@effected/walker](walker.md), including the implicit `/tsconfig.json` suffix and the package.json `"tsconfig"` field. This is file and module-path resolution, not compiler machinery — the whole reason the capability can live in a zero-`typescript` package.

The exact tsc lookup rules were verified against the installed `typescript@6.0.3` source, with the line citations embedded in the test suite and in the source module headers, so drift from tsc is a failing test rather than a latent bug. Implementation review surfaced six parity behaviors the design had not enumerated, each adopted as a decision because the surveyed consumers feed this package real-world configs that exercise them:

- **A malformed or non-object package.json coerces to `{}`** and falls through to the `<pkg>/tsconfig.json` probe — tsc's `readJson` does exactly this, so a hostile manifest must degrade a candidate, not decide it.
- **There is no package.json presence gate.** A manifest-less package directory still resolves via its `tsconfig.json`, because tsc probes it whether or not the manifest exists.
- **The ancestor walk continues past present-but-unresolved candidates.** An `exports` map that fails to resolve blocks only that package's same-package fallbacks; it never shadows a farther ancestor's copy — tsc's ancestor walk stops only on a defined result.
- **A falsy `"tsconfig"` manifest field falls through** to the `<pkg>/tsconfig.json` probe rather than failing the candidate.
- **Wildcard selection in exports maps is longest-prefix**, not first-in-order — among matching `*` patterns the longest base prefix wins, per Node/tsc pattern selection.
- **Slashes are normalized once**, on the spec, and the normalized name is what resolves throughout — matching tsc's single-normalization convention.

**Merge semantics are encoded explicitly**, not left to prose: `compilerOptions` merge per-key with the derived config winning; `files`/`include`/`exclude` replace wholesale; relative paths in a base config are re-rooted relative to the base file; `references` are never inherited. The result is a **resolved-config type distinct from the document type**, carrying `configPath` and `extendedPaths` (in resolution order) — the metadata both surveyed consumers need and previously reconstructed by hand. One fidelity note recorded from implementation: **re-rooting composes per-step without collapsing `..` segments**, byte-identical to tsc's `combinePaths` behavior — a two-level chain yields `../../…` prefixes exactly as tsc emits them, so consumers comparing against tsc output see identical strings. See `src/ResolvedTsconfig.ts` for the full engine.

**Hardening.** Extends resolution is a recursive walk over untrusted files, so the [hardening invariants](../effect-standards.md#input-hardening-standards) apply: an extends-depth guard and cycle detection, both failing as typed errors — malformed input fails through the typed error channel, never a defect.

**The file-only FileSystem contract** (decided at implementation, documented in the `src/TsconfigLoader.ts` header): target probes use core `FileSystem.exists`, which on a real filesystem is true for a directory, whereas tsc's `host.fileExists` is file-only. A relative extends target naming a real directory therefore resolves the directory verbatim and the subsequent `readFileString` fails with a typed `PlatformError` — where tsc would retry the `.json`-appended sibling. The divergence is accepted: it satisfies the hardening invariant (typed failure, never a defect), the in-memory fixture filesystem cannot exercise it (file-only by construction), and the alternative stat-and-isFile probe would rewrite the tsc-cited target engine and its fixtures for a case no supported test can reach.

## Discovery

Nearest-tsconfig upward search over [@effected/walker](walker.md), with the filename parameterized — `tsconfig.json` by default, `tsconfig.build.json` or any other name by argument — returning `Option`. Like every walker-based scan, absence is `Option.none()`, not an error.

## The numeric-enum codec: data, not typescript

One pure module owns the version-coupled string↔numeric mappings **as plain data**: `ScriptTarget`, `ModuleKind` (including the 101/102 `node18`/`node20` gaps that not all TypeScript versions export), `ModuleResolutionKind`, `JsxEmit`, `ModuleDetectionKind`, `NewLineKind`, plus the lib-reference normalizer (`lib.esnext.d.ts` ↔ `esnext`).

- The **encode** direction feeds [@effected/ts-vfs's TsEnvironment](ts-vfs.md#tsenvironment--the-typescriptvfs-seam): output shaped like `ts.CompilerOptions` but typed structurally, with no `typescript` type import.
- The **decode** direction absorbs numeric configs coming out of TS APIs during consumers' transition off direct config-API usage.

This module is the concrete mechanism behind the roadmap's rule that this package "owns the version-coupled enum mappings as data" — when TypeScript adds an enum member, the change here is a data edit and a test fixture, not a dependency bump.

Two as-built decisions on the whole-object helpers:

- **`decodeCompilerOptions` returns `Record<string, unknown>`, not `CompilerOptions.Type`** — passthrough-honest. A numeric value with no table entry (a future TS enum member) is left as-is rather than errored, and an unmappable passthrough number would violate the narrower type's contract, so the wider return type is the truthful one. Callers wanting the validated shape decode through the schema afterwards.
- **The `lib` encode direction emits the file-name form** (`lib.esnext.d.ts`), not the short name. Verified against the installed `typescript@6.0.3` (`pathForLibFile` joins each `options.lib` entry onto the lib directory as a literal file name) and `@typescript/vfs@1.6.4`: [ts-vfs's TsEnvironment](ts-vfs.md#tsenvironment--the-typescriptvfs-seam) hands the options straight through `createVirtualTypeScriptEnvironment` to `ts.createProgram`, so consumers get the one form the real compiler resolves — a short name would resolve to a nonexistent path at the Program level, the layer with no tolerance for the wrong form. The decode direction and `normalizeLibReference` emit the short form.

## Portable tsconfig

An approved scope addition beyond the roadmap's four bullets: a small pure module providing the **portable tsconfig** filter, generalized from bundler's tsconfig-resolver.ts. It takes a resolved config and produces a self-contained, machine-independent one: `compilerOptions` only, emit/path/file-selection options excluded, `composite: false` and `noEmit: true` forced, `$schema` stamped (`https://json.schemastore.org/tsconfig`).

With string-level schemas this is a pure filter over a resolved config — no enum conversion step. It is generic to any virtual-TS or Twoslash environment; both external consumers would otherwise reimplement it independently, which is what earned it a place in v1.

As built, the filter is an **allow-list generalized from the bundler's preserved lists, never a deny-list**: only classified keys reach the output, and unknown options — including every unknown/future passthrough key the schemas preserve for forward tolerance — are **dropped by design**. A portable config is deliberately a strict subset of what the source config said; growing it is an explicit, reviewed addition to the allow-list, never an accident of "we didn't exclude it." One recorded divergence from the prior art: **`newLine` is excluded** — it is pure emit formatting with no bearing on type-checking, and inert anyway under the always-forced `noEmit: true`. See `src/PortableTsconfig.ts` for the classification rationale on the judgment-call groups.

## Error handling

Typed errors owned by their modules per house style ([error handling standards](../effect-standards.md#error-handling-standards), `Schema.TaggedErrorClass`). The as-built taxonomy, settled under the restrained-granularity rule (one tag per genuinely distinct recovery path):

- **`TsconfigParseError`** (`path`, `cause: Defect`) in `TsconfigJson.ts` — a document that failed to parse or decode. `path` is the file path when the failure is file-bound and `""` when decoding an in-memory string; the loader wraps file-bound decode failures, the codec module only declares the error.
- **`TsconfigExtendsError`** (`path`, `target`, `reason`, `chain`) in `TsconfigLoader.ts` — a chain that could not be resolved. The design sketched distinct tags for missing target, cycle and depth; as built those collapsed into **one tag with a `reason` literal** (`not-found` | `cycle` | `depth` | `empty`) because the four modes share a recovery path — fix the chain — so separate tags would be granularity without a distinct handler. `chain` carries the full resolution chain of normalized absolute paths for diagnostics.
- **`PlatformError` flows through untranslated** on IO per the boundary standard — the package neither absorbs nor rewraps filesystem failures it cannot interpret.

## Testing

Per the [testing standards](../effect-standards.md#testing-standards): `@effect/vitest`, `it.effect`, `assert.*` (never `expect`), tests in `packages/tsconfig-json/__test__/`.

- **Fixture trees with real extends chains** — relative targets, array extends, node_modules package targets including the implicit `/tsconfig.json` and package.json `"tsconfig"` forms — asserting the merge semantics and the `extendedPaths` ordering.
- **Data-driven tsc-parity tests** for the extends lookup rules, recorded from the TypeScript-source verification.
- **Hostile inputs** — cycles, deep chains, malformed JSONC, dunder keys — each failing with its typed error, never a defect.
- **Round-trip properties on the document schema**, including unknown-key preservation through decode and re-encode.

## Evidence base and consumers

From [roadmap.md §3](../roadmap.md#3-effectedtsconfig-json) and a fresh survey on 2026-07-13:

- **rspress-plugin-api-extractor** (`plugin/src/tsconfig-parser.ts`) — loads a tsconfig by path, resolves extends, extracts a `compilerOptions` subset, needs the `extendedPaths` metadata and feeds numeric `ts.CompilerOptions` to `@typescript/vfs` via ts-vfs's TsEnvironment. This is the [gate-proof](../roadmap.md#4-the-gate-proof) consumer.
- **@savvy-web/bundler** (tsdown-plugins `src/meta/tsconfig-resolver.ts`) — the same load-and-resolve, followed by the numeric→portable-string conversion that this package's string-level schemas eliminate outright.
- **@effected/ts-vfs** — TsEnvironment consumes numeric `ts.CompilerOptions`, the [enum codec](#the-numeric-enum-codec-data-not-typescript)'s encode target.

**Out of scope:** the bundler's `dts/` AST walkers and the api-extractor plugin's Twoslash type-checking keep direct `typescript` — the sanctioned island until the TS 7.1 JS API exists, per [the TypeScript posture](../roadmap.md#cross-cutting-the-typescript-567-posture). This package resolves and shapes configuration; it never runs a compiler.

## Build and scaffolding

Scaffolded per [package-setup.md](../package-setup.md) — copied from an existing boundary package, `src/index.ts` stubbed before the first install, lockfile diff checked. All standard gates passed at implementation: `tsc --noEmit`, `turbo build:prod` with a zero-warning `dist/prod/issues.json`, biome and markdownlint clean, the full test suite green.
