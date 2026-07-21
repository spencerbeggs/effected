---
status: current
module: effected
category: architecture
created: 2026-07-13
updated: 2026-07-21
last-synced: 2026-07-21
completeness: 95
related:
  - ../roadmap.md
  - ../effect-standards.md
  - ../package-setup.md
  - ../releases.md
  - ../package-inventory.md
  - jsonc.md
  - walker.md
  - config-file.md
  - ts-vfs.md
---

# @effected/tsconfig-json design

## Overview

`@effected/tsconfig-json` reads, decodes, validates, resolves and constructs `tsconfig.json` files: string-level schemas for the document shape, full `extends`-chain resolution matching tsc semantics, nearest-tsconfig upward discovery, a data-owned codec between string option values and TypeScript's numeric enums, and a portable-tsconfig filter for virtual-TS environments. It is a new invention scoped by consumer surveys ([evidence base](#evidence-base-and-consumers)), not a port.

It enforces the repo's TypeScript posture: the version-coupled parts of tsconfig knowledge become plain data owned here, so no `@effected/*` package ever imports `typescript` (see [the TypeScript 5→6→7 posture](../roadmap.md#the-typescript-567-posture)). It is on the `0.1.0` release gate.

## One package, not two

A split into a pure `@effected/tsconfig` (schemas, validation, construction) plus a boundary `@effected/tsconfig-json` (IO) is **rejected**. Four reasons:

- **[R3](../effect-standards.md#dependency-policy) already delivers the split's benefit.** Boundary tier does not propagate — a schema-only consumer pays no install cost for the IO surface, because `FileSystem`/`Path` are `effect` core in v4 and the package carries zero external runtime dependencies.
- **The [no-barrel](../effect-standards.md#no-barrel-re-exports) module-per-concept discipline already gives bundle isolation.** A consumer importing only the schema modules never references the loader modules, so their graphs tree-shake away. Package boundaries are not the unit of bundle isolation here; modules are.
- **The pure package could not even be jsonc-free.** String→document decoding belongs with the schemas (the house `FromString` static), and every tsconfig is JSONC, so the "pure" half would carry the `@effected/jsonc` edge anyway.
- **Precedent runs toward consolidation.** `package-json` is one package spanning schemas and file IO; no quarantine motive (like the runtimes/CLI `@effect/platform-node` split) exists here.

The two-layer instinct survives as **internal architecture**: pure schema and codec modules that never import `FileSystem`, and separate loader, resolver and discovery modules that do.

## Tier and dependencies

**Boundary tier.** The package's own surface does file IO (loading, extends resolution, discovery) exclusively through `effect`-core `FileSystem`/`Path`, arriving via the `R` channel; `PlatformError` flows through on IO operations.

- `peerDependencies`: `effect` plus two `workspace:~` edges — `@effected/jsonc` (the JSONC decode engine) and `@effected/walker` (upward traversal for discovery and node_modules resolution). Both mirrored in `devDependencies`.
- `dependencies`: **none.** Both `@effected/*` edges are what [R1](../effect-standards.md#dependency-policy) permits; `jsonc` is pure tier and `walker` is boundary tier, so the tier stays boundary by R3.
- **Hard rule: zero `typescript` imports anywhere, including type imports.** The TS-version-coupled enum mappings are owned as plain data (see [the numeric-enum codec](#the-numeric-enum-codec-data-not-typescript)); anything shaped like `ts.CompilerOptions` is typed structurally.

**No services, no layers.** The package exposes effectful statics that require `FileSystem`/`Path` in `R` — the [walker posture](walker.md#wiring-services-via-r-not-parameters) — discharged once by the consumer's platform layer at the edge. There is no per-consumer state that would earn a `Context.Service`.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept), one concept per file, every public name a file name, no barrels beyond `index.ts`:

```text
packages/tsconfig-json/
  src/
    index.ts              # public surface, re-exports only
    TsconfigJson.ts       # the document schema + TsconfigJsonFromString + TsconfigParseError
    CompilerOptions.ts    # string-level option schemas, literal unions + passthrough
    ResolvedTsconfig.ts   # the pure extends-merge engine: absolutize / merge / substituteConfigDir
    TsEnumCodec.ts        # string↔numeric enum mappings as data (pure)
    PortableTsconfig.ts   # the portable filter (pure)
    JsxConfig.ts          # jsx compiler option → JSX transform projection (pure)
    TsconfigLoader.ts     # load by path + extends-chain resolution (IO) + TsconfigExtendsError
    TsconfigLoaderSync.ts # the sync facade over consumer-supplied ops
    TsconfigDiscovery.ts  # nearest-tsconfig upward search over walker (IO)
    internal/
      extendsTarget.ts    # extends-target resolution + hardened exports-map subset (IO, not exported)
  __test__/
```

The first six source modules never import `FileSystem` — construction, validation, decoding of already-parsed objects, merging, enum conversion, the portable filter and the JSX projection are all pure (`ResolvedTsconfig` takes an injected `join` rather than the `Path` service). Only the loader, discovery and internal target-resolver modules touch the `R` channel; the sync facade adapts consumer-supplied ops into it.

Two shape choices are worth naming:

- **The extends-target resolver is one internal module.** `internal/extendsTarget.ts` owns both target forms — relative/rooted resolution and bare-specifier node_modules lookup, including a hardened subset of package.json `exports`-map resolution (dunder-key guards, `Object.create(null)` substitution, depth caps) — because target resolution is an implementation seam of the loader, not a concept a consumer names. A hostile manifest is absorbed to "no resolution for that candidate," never a defect.
- **The document codec's public name is `TsconfigJsonFromString`, a bare module-level const.** The house dotted-static `FromString` idiom assumes a `Schema.Class` with a static slot; `TsconfigJson` is a `Schema.StructWithRest` **value** (chosen for the passthrough rest row), which has no static slot. The codec is a sibling export whose name carries the module prefix, bound once at module top level because `Jsonc.schema` derives fresh caches per call.

## Schema design: string-level, JSONC-always, forward-tolerant

The document schema models the **raw file shape**: `compilerOptions`, `extends` (string or string array), `files`, `include`, `exclude`, `references`, `watchOptions`, `typeAcquisition`, `compileOnSave`, `$schema`. `src/TsconfigJson.ts` and `src/CompilerOptions.ts` are authoritative for the field-by-field listing.

- **Enum-valued options stay string-level literal unions** — `target: "es2023"`, `module: "nodenext"`, `moduleResolution: "bundler"`, and the rest — case-insensitive on decode, the way tsc accepts them. This eliminates the numeric→string roundtrip a raw consumer of the TypeScript config API performs.
- **TS ≥ 6 only.** Dead and removed options (`charset`, `out`, `suppressImplicitAnyIndexErrors` and kin) get no typed fields, but they are not decode errors either — they ride the passthrough.
- **Forward- and backward-tolerant.** Unknown `compilerOptions` keys are preserved through decode via a passthrough record, never rejected; known keys validate strictly; unknown keys survive re-encode. TypeScript adds options every minor release, and a schema pinned at publish time must not break on a newer consumer's tsconfig.
- **Every parse is JSONC.** The string→document codec decodes through [@effected/jsonc](jsonc.md) unconditionally — tsconfig files are JSONC regardless of the `.json` name. No JSON-strict path exists.
- **Construction and validation are pure.** `make` and decode of already-parsed objects need no IO and live in the pure schema modules.

## Extends resolution and merge semantics

The loader reads a tsconfig by path via `FileSystem`, decodes it as JSONC and resolves the full `extends` chain **matching tsc semantics**:

- Relative targets resolve against the extending file's directory.
- Array `extends` (TS 5+) is supported, later entries winning.
- Package-name targets resolve via plain upward node_modules **file** resolution over [@effected/walker](walker.md), including the implicit `/tsconfig.json` suffix and the package.json `"tsconfig"` field. This is file and module-path resolution, not compiler machinery — the whole reason the capability can live in a zero-`typescript` package.

The exact tsc lookup rules are verified against the installed `typescript` source, with line citations embedded in the test suite and source module headers, so drift from tsc is a failing test rather than a latent bug. Six parity behaviors the surveyed consumers exercise:

- **A malformed or non-object package.json coerces to `{}`** and falls through to the `<pkg>/tsconfig.json` probe — tsc's `readJson` does exactly this.
- **There is no package.json presence gate.** A manifest-less package directory still resolves via its `tsconfig.json`.
- **The ancestor walk continues past present-but-unresolved candidates.** An `exports` map that fails to resolve blocks only that package's same-package fallbacks; it never shadows a farther ancestor's copy.
- **A falsy `"tsconfig"` manifest field falls through** to the `<pkg>/tsconfig.json` probe.
- **Wildcard selection in exports maps is longest-prefix**, not first-in-order.
- **Slashes are normalized once**, on the spec, and the normalized name resolves throughout.

**Merge semantics are encoded explicitly**: `compilerOptions` merge per-key with the derived config winning; `files`/`include`/`exclude` replace wholesale; relative paths in a base config are re-rooted relative to the base file; `references` are never inherited. The result is a **resolved-config type distinct from the document type**, carrying `configPath` and `extendedPaths` (in resolution order) — the metadata both surveyed consumers need. Re-rooting composes per-step without collapsing `..` segments, byte-identical to tsc's `combinePaths` behavior, so consumers comparing against tsc output see identical strings. See `src/ResolvedTsconfig.ts` for the full engine.

**Hardening.** Extends resolution is a recursive walk over untrusted files, so the [hardening invariants](../effect-standards.md#input-hardening-standards) apply: an extends-depth guard and cycle detection, both failing as typed errors.

**The file-only FileSystem contract** (documented in the `src/TsconfigLoader.ts` header): target probes use core `FileSystem.exists`, which on a real filesystem is true for a directory, whereas tsc's `host.fileExists` is file-only. A relative extends target naming a real directory therefore resolves the directory verbatim and the subsequent `readFileString` fails with a typed `PlatformError` — where tsc would retry the `.json`-appended sibling. The divergence is accepted: it satisfies the hardening invariant, the in-memory fixture filesystem cannot exercise it (file-only by construction), and a stat-and-isFile probe would rewrite the tsc-cited target engine for a case no supported test can reach.

**The query surface** (2026-07-16, dogfood item 8): `TsconfigLoader.compilerOptions(configPath)` is a thin projection of `resolve` down to the merged `compilerOptions` — the common "just give me the effective options" question, so consumers stop hand-parsing tsconfig files with bare `JSON.parse` (which is JSONC-blind and misses everything inherited through `extends`). All three loader entry points — `load`, `resolve`, `compilerOptions` — are uniform `Effect.fn`s with named spans (`TsconfigLoader.load` etc.), per the house observability rule.

## TsconfigLoaderSync — the sync facade

Bundler plugin hooks and config factories are synchronous host APIs, and the kit is async-first; `TsconfigLoaderSync` (2026-07-16, dogfood items 7 and 9) is the escape hatch, in the same mold as `@effected/workspaces`' `WorkspacesSync` ([workspaces.md](workspaces.md#workspacessync--the-escape-hatch)). The design rule it implements: **sync escape hatches take their platform from the caller — the kit never imports `node:*` and never assumes posix.**

- **Consumer-supplied ops, structurally typed.** `TsconfigLoaderSyncOptions` carries a `SyncFileSystem` (`exists` / `readFile`) and a `SyncPath` (`resolve` / `dirname` / `join` / `isAbsolute` / `basename`) — minimal structural interfaces Node's built-ins satisfy verbatim: the `node:fs` functions one-liner each, and `node:path` (including `node:path/win32` explicitly, or a Bun/Deno equivalent) *is* a `SyncPath`. Windows correctness is the consumer passing a win32-appropriate `path` implementation, not anything in this module.
- **Zero logic duplication.** The facade runs the **unchanged** `TsconfigLoader` pipeline: the consumer's ops are adapted into core `FileSystem`/`Path` service **values** provided per call via `Effect.provideService` — never layers, so there is no memoization to poison across calls with different options. A `Path` member the pipeline never calls throws an informative defect if something reaches it.
- **The failure contract is the async pipeline's, thrown.** The pipeline runs under `Effect.runSyncExit`; on failure the `Cause` is unwrapped so the typed error (`TsconfigParseError`, `TsconfigExtendsError`, or a `PlatformError` wrapping what the consumer's `readFile` threw) is thrown **as itself**, and a defect rethrows as-is — a caller never sees a fiber-failure wrapper.

`load`, `resolve` and `compilerOptions` mirror the async trio. This deletes the surveyed consumers' hand-rolled `FileSystem.layerNoop` + `Effect.runSync` facades.

## JsxConfig

A pure module projecting decoded compiler options to the JSX transform a bundler can actually configure (2026-07-16, dogfood item 8's ride-along vocabulary): `JsxConfig.fromCompilerOptions(options) → Option<JsxConfig>`. `react-jsx` / `react-jsxdev` yield the `automatic` runtime with `importSource` from `jsxImportSource`, defaulting to `"react"` exactly as tsc does; `react` yields `classic` (the factory options stay on `CompilerOptions`, where classic consumers read them); `preserve`, `react-native` and an absent `jsx` yield `Option.none()` — JSX is left untransformed, so there is nothing to configure. Combined with `compilerOptions`, this fixes the surveyed consumer's JSONC-blind, extends-blind JSX inference by construction.

## Discovery

Nearest-tsconfig upward search over [@effected/walker](walker.md), with the filename parameterized — `tsconfig.json` by default, `tsconfig.build.json` or any other name by argument — returning `Option`. Absence is `Option.none()`, not an error.

## The numeric-enum codec: data, not typescript

One pure module owns the version-coupled string↔numeric mappings **as plain data**: `ScriptTarget`, `ModuleKind` (including the 101/102 `node18`/`node20` gaps that not all TypeScript versions export), `ModuleResolutionKind`, `JsxEmit`, `ModuleDetectionKind`, `NewLineKind`, plus the lib-reference normalizer (`lib.esnext.d.ts` ↔ `esnext`).

- The **encode** direction feeds an external Twoslash/virtual-TS environment: output shaped like `ts.CompilerOptions` but typed structurally, with no `typescript` type import (see [the typed encode return](#the-typed-encode-return-programmaticcompileroptions)).
- The **decode** direction absorbs numeric configs coming out of TS APIs during consumers' transition off direct config-API usage.

When TypeScript adds an enum member, the change here is a data edit and a test fixture, not a dependency bump. Two whole-object helpers:

- **`decodeCompilerOptions` returns `Record<string, unknown>`, not `CompilerOptions.Type`** — passthrough-honest. A numeric value with no table entry (a future TS enum member) is left as-is rather than errored; callers wanting the validated shape decode through the schema afterwards.
- **The `lib` encode direction emits the file-name form** (`lib.esnext.d.ts`), not the short name — verified against the installed TypeScript (`pathForLibFile` joins each `options.lib` entry onto the lib directory as a literal file name). A virtual-TS environment hands the options straight through to `ts.createProgram`, so consumers get the one form the real compiler resolves. The decode direction and `normalizeLibReference` emit the short form.

### The typed encode return: ProgrammaticCompilerOptions

`encodeCompilerOptions` returns the exported structural types **`ProgrammaticCompilerOptions`** / **`ProgrammaticCompilerOptionsValue`**, not the old `Record<string, unknown>` (2026-07-21, closes [#120](https://github.com/spencerbeggs/effected/issues/120)) — so a consumer handing the result to `@typescript/vfs`'s `createVirtualTypeScriptEnvironment` or to `ts.createProgram` no longer ends the pipeline with a cast. The types are a **verbatim structural transcription of `typescript@6.0.3`'s `CompilerOptionsValue`** (minus the compiler-internal `TsConfigSourceFile`, an AST node unreachable from JSON), cited in TSDoc — the package's **zero-`typescript` rule is preserved**, nothing is imported. The six enum-family keys are typed `number` (optional), sound because a decoded `CompilerOptions.Type` restricts each spelling to the tables' covered literals (verified full coverage), so the "unknown string passes through unencoded" branch is unreachable for well-typed input; `lib` is typed `string[]`.

One **documented internal assertion** lives at `encodeCompilerOptions`'s return, bridging the codec's `unknown`/`readonly` internal record to the tsc-assignable value union — owned once here rather than re-cast at every call site, exactly as `ts.CompilerOptions`'s own index signature makes the identical unproven claim about passthrough values. Runtime behavior is unchanged; only the declared return narrows. `decodeCompilerOptions` is untouched. A compile-time assignability test (`__test__/TsEnumCodec.assignability.test.ts`) pins the result assignable to a **cited structural replica** of `ts.CompilerOptions` (no `typescript` import).

The free assignability targets the **TS6 / `@typescript/vfs` consumer specifically**: `typescript@7.0.2`'s `CompilerOptions` dropped its index signature while keeping nominal enums, so the structural-subset argument is against the TS6 shape the encode target's consumer pins — worth recording as the version-coupled nuance it is.

## Portable tsconfig

A small pure module providing the **portable tsconfig** filter: it takes a resolved config and produces a self-contained, machine-independent one — `compilerOptions` only, emit/path/file-selection options excluded, `composite: false` and `noEmit: true` forced, `$schema` stamped (`https://json.schemastore.org/tsconfig`). It is generic to any virtual-TS or Twoslash environment.

The filter is an **allow-list**, never a deny-list: only classified keys reach the output, and unknown options — including every unknown/future passthrough key the schemas preserve for forward tolerance — are dropped by design. A portable config is deliberately a strict subset; growing it is an explicit, reviewed addition to the allow-list. `newLine` is excluded — pure emit formatting with no bearing on type-checking, inert anyway under the forced `noEmit: true`. See `src/PortableTsconfig.ts` for the classification rationale.

## Error handling

Typed errors owned by their modules (`Schema.TaggedErrorClass`), settled under the restrained-granularity rule (one tag per genuinely distinct recovery path):

- **`TsconfigParseError`** (`path`, `cause: Defect`) in `TsconfigJson.ts` — a document that failed to parse or decode. `path` is the file path when the failure is file-bound and `""` when decoding an in-memory string; the loader wraps file-bound decode failures, the codec module only declares the error.
- **`TsconfigExtendsError`** (`path`, `target`, `reason`, `chain`) in `TsconfigLoader.ts` — a chain that could not be resolved. One tag with a `reason` literal (`not-found` | `cycle` | `depth` | `empty`) because the four modes share a recovery path — fix the chain. `chain` carries the full resolution chain of normalized absolute paths for diagnostics.
- **`PlatformError` flows through untranslated** on IO — the package neither absorbs nor rewraps filesystem failures it cannot interpret.

## Testing

Per the [testing standards](../effect-standards.md#testing-standards): `@effect/vitest`, `it.effect`, `assert.*` (never `expect`), tests in `packages/tsconfig-json/__test__/`.

- **Fixture trees with real extends chains** — relative targets, array extends, node_modules package targets including the implicit `/tsconfig.json` and package.json `"tsconfig"` forms — asserting the merge semantics and the `extendedPaths` ordering.
- **Data-driven tsc-parity tests** for the extends lookup rules, recorded from the TypeScript-source verification.
- **Hostile inputs** — cycles, deep chains, malformed JSONC, dunder keys — each failing with its typed error, never a defect.
- **Round-trip properties on the document schema**, including unknown-key preservation through decode and re-encode.
- **A compile-time assignability test** (`TsEnumCodec.assignability.test.ts`) proving `encodeCompilerOptions`'s `ProgrammaticCompilerOptions` return assignable to a cited structural replica of `ts.CompilerOptions` (no `typescript` import).

## Evidence base and consumers

- **rspress-plugin-api-extractor** (`plugin/src/tsconfig-parser.ts`) — loads a tsconfig by path, resolves extends, extracts a `compilerOptions` subset, needs the `extendedPaths` metadata and feeds numeric `ts.CompilerOptions` to a virtual-TS environment. This is the [gate-proof](../roadmap.md#consumer-ports) consumer, deferred to post-`0.1.0`. It consumes `ts-vfs` from its own repo now that ts-vfs has [left the kit](../releases.md#not-on-the-gate).
- **@savvy-web/bundler** (`src/meta/tsconfig-resolver.ts`) — the same load-and-resolve, followed by the numeric→portable-string conversion that this package's string-level schemas eliminate outright.
- **@effected/ts-vfs (external)** — its virtual-TS environment consumes numeric `ts.CompilerOptions`, the [enum codec](#the-numeric-enum-codec-data-not-typescript)'s encode target. ts-vfs is external ([not on the gate](../releases.md#not-on-the-gate)), reached through the gate-proof plugin rather than a kit sibling; the encode-target shape is unchanged.

**Out of scope:** the bundler's `dts/` AST walkers and the api-extractor plugin's Twoslash type-checking keep direct `typescript` — the sanctioned island until the TS 7.1 JS API exists. This package resolves and shapes configuration; it never runs a compiler.

## Build and scaffolding

Scaffolded per [package-setup.md](../package-setup.md) — copied from an existing boundary package. Standard gates: `tsc --noEmit`, `turbo build:prod` with a zero-warning `dist/prod/issues.json`, biome and markdownlint clean, the full test suite green. The prod gate's expected suppressed count (the narrow `_base` suppression) is **3** (`suppressed: 0` in the prod gate means the build did not run properly).
