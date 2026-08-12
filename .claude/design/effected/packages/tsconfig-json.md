---
status: current
module: effected
category: architecture
created: 2026-07-13
updated: 2026-08-12
last-synced: 2026-08-12
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
---

# @effected/tsconfig-json design

## Overview

`@effected/tsconfig-json` reads, decodes, validates, resolves and constructs `tsconfig.json` files: string-level schemas for the document shape, full `extends`-chain resolution matching tsc semantics, nearest-tsconfig upward discovery, a data-owned codec between string option values and TypeScript's numeric enums, and a portable-tsconfig filter for virtual-TS environments. It is a new invention scoped by [consumer surveys](#consumers-this-api-was-designed-against), not a port, and it is on the `0.1.0` release gate.

It enforces the repo's TypeScript posture: the version-coupled parts of tsconfig knowledge become plain data owned here, so no `@effected/*` package ever imports `typescript` (see [the TypeScript 5→6→7 posture](../roadmap.md#the-typescript-567-posture)).

## One package, not two

A split into a pure schema package plus a boundary IO package is **rejected**, for four reasons:

- **[R3](../effect-standards.md#dependency-policy) already delivers the split's benefit.** Boundary tier does not propagate, and a schema-only consumer pays no install cost for the IO surface, because `FileSystem`/`Path` are core in v4 and the package carries zero external runtime dependencies.
- **The [no-barrel](../effect-standards.md#no-barrel-re-exports) module-per-concept discipline already gives bundle isolation.** A consumer importing only the schema modules never references the loader modules, so their graphs tree-shake away. Package boundaries are not the unit of bundle isolation here; modules are.
- **The pure package could not even be jsonc-free.** String→document decoding belongs with the schemas, and every tsconfig is JSONC, so the "pure" half would carry the jsonc edge anyway.
- **Precedent runs toward consolidation.** [package-json](package-json.md) is one package spanning schemas and file IO, and no quarantine motive exists here.

The two-layer instinct survives as **internal architecture**: pure schema and codec modules that never import `FileSystem`, and separate loader, resolver and discovery modules that do.

## Tier and dependencies

**Boundary tier.** All file IO — loading, extends resolution, discovery — goes exclusively through core `FileSystem`/`Path` arriving via the `R` channel, and `PlatformError` flows through untranslated.

`effect` is the only non-workspace peer. [`@effected/jsonc`](jsonc.md) (the decode engine) and [`@effected/walker`](walker.md) (upward traversal) are `workspace:^` peers so a published patch floats, mirrored by a plain `workspace:*` in devDependencies — the two specifiers deliberately differ. Runtime `dependencies` stays **empty**.

**Hard rule: zero `typescript` imports anywhere, including type imports.** The version-coupled enum mappings are owned as plain data (see [the numeric-enum codec](#the-numeric-enum-codec-data-not-typescript)); anything shaped like `ts.CompilerOptions` is typed structurally.

**No services, no layers.** The package exposes effectful statics requiring `FileSystem`/`Path` in `R` — the [walker posture](walker.md#wiring-services-via-r-not-parameters) — discharged once by the consumer's platform layer at the edge. There is no per-consumer state that would earn a `Context.Service`.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept), one concept per file, every public name a file name, no barrels beyond `index.ts`. The document schema, option schemas, merge engine, enum codec, portable filter and JSX projection are all **pure** and never import `FileSystem`; only the loader, its sync facade, discovery and the internal target resolver touch the `R` channel. The merge engine takes an injected `join` rather than the `Path` service, which is what keeps it on the pure side.

Three shape choices are worth naming:

- **The extends-target resolver is one internal module.** `internal/extendsTarget.ts` owns both target forms — relative or rooted resolution, and bare-specifier `node_modules` lookup including a hardened subset of package.json `exports`-map resolution — because target resolution is an implementation seam of the loader, not a concept a consumer names. A hostile manifest is absorbed to "no resolution for that candidate", never a defect.
- **The document codec is a bare module-level const**, not a dotted static. The house `FromString` idiom assumes a `Schema.Class` with a static slot; the document schema is a `Schema.StructWithRest` **value**, chosen for the passthrough rest row, which has none. The codec is a sibling export whose name carries the module prefix, bound once at module top level because the jsonc schema factory derives a fresh cache per call.
- **The statics containers are static classes with a private constructor**, not `as const` objects, because an `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc entirely. Two of them go a step further and merge with a pre-existing same-named data interface, which trips Biome's `noUnsafeDeclarationMerging` — narrowly suppressed with a reason on each, since neither contributes instance members. A facade whose name is claimed by a *type alias* is not eligible for this conversion; a class can merge with an interface but not with an alias.

## Schema design: string-level, JSONC-always, forward-tolerant

The document schema models the **raw file shape**. `src/TsconfigJson.ts` and `src/CompilerOptions.ts` are authoritative for the field-by-field listing.

- **Enum-valued options stay string-level literal unions**, case-insensitive on decode the way tsc accepts them, canonical-lowercase on encode. This eliminates the numeric→string round trip a raw consumer of the TypeScript config API performs. Option *names* stay case-sensitive.
- **TS ≥ 6 only.** Dead and removed options get no typed fields, but they are not decode errors either — they ride the passthrough.
- **Forward- and backward-tolerant.** Unknown compiler-option keys are preserved through decode via a passthrough record, never rejected; known keys validate strictly; unknown keys survive re-encode. TypeScript adds options every minor release, and a schema pinned at publish time must not break on a newer consumer's tsconfig.
- **Every parse is JSONC**, unconditionally — tsconfig files are JSONC regardless of the `.json` name. There is no JSON-strict path.
- **Construction and validation are pure**: they need no IO and live in the pure schema modules.

## Extends resolution and merge semantics

The loader reads a tsconfig by path, decodes it as JSONC and resolves the full `extends` chain **matching tsc semantics**: relative targets against the extending file's directory; array `extends` with later entries winning; and package-name targets via plain upward `node_modules` **file** resolution, including the implicit `/tsconfig.json` suffix and the package.json `"tsconfig"` field. That last part is file and module-path resolution, not compiler machinery — which is the whole reason the capability can live in a zero-`typescript` package.

**Merge semantics are encoded explicitly**: compiler options merge per key with the derived config winning; the file-selection arrays replace wholesale; relative paths in a base config are re-rooted relative to the base file; project references are never inherited. The result is a **resolved-config type distinct from the document type**, carrying the config path and the extended paths in resolution order. Re-rooting composes per step without collapsing `..` segments, byte-identical to tsc's own path combination, so consumers comparing against tsc output see identical strings.

The resolved config also carries `${configDir}` substitution as a final phase and `pathsBase` provenance. See `src/ResolvedTsconfig.ts` for the engine.

### The tsc-parity discipline

The lookup and merge rules were extracted from the TypeScript source and encoded as data-driven tests with line citations embedded in the test comments and module headers, so drift from tsc is a failing test rather than a latent bug. These parity facts cost real review cycles — **do not regress them**:

- A malformed or non-object package.json coerces to `{}` and **falls through** to the `<pkg>/tsconfig.json` probe.
- There is **no package.json presence gate** — a manifest-less package directory still resolves via its `tsconfig.json`.
- The ancestor walk **continues past a present-but-unresolved candidate**: an `exports` map that fails to resolve blocks only that package's own fallbacks, never a farther ancestor's copy.
- A falsy `"tsconfig"` manifest field falls through to the `tsconfig.json` probe.
- Wildcard selection in `exports` maps is **longest base prefix**, not first-in-order.
- Slashes are normalized once, on the spec, and the normalized name resolves throughout.

### The file-only FileSystem contract

Target probes use core `FileSystem.exists`, which on a real filesystem is true for a directory, whereas tsc's host check is file-only. A relative extends target naming a real directory therefore resolves the directory verbatim and the subsequent read fails with a typed `PlatformError` — where tsc would retry the `.json`-appended sibling.

The divergence is **accepted and documented** in the loader's module header: it satisfies the hardening invariant, the in-memory fixture filesystem cannot exercise it (file-only by construction), and a stat-and-is-file probe would rewrite the tsc-cited target engine for a case no supported test can reach. Do not "fix" it.

### Hardening

Extends resolution is a recursive walk over untrusted files, so the [hardening invariants](../effect-standards.md#input-hardening-standards) apply and **must not be relaxed**: an extends-depth guard with **per-branch** cycle stacks (so diamonds stay legal), a recursion depth guard inside the `exports`-map subset, own-property checks on every untrusted map read with dunder keys skipped, and wildcard-substituted maps built on a null prototype. Malformed input always fails through the typed channel, never as a defect.

## The loader surface

`load`, `resolve` and `compilerOptions` are uniform `Effect.fn`s with named spans. The third is a thin projection of `resolve` down to the merged compiler options — the common "just give me the effective options" question — so consumers stop hand-parsing tsconfig files with bare `JSON.parse`, which is JSONC-blind and misses everything inherited through `extends`.

### TsconfigLoaderSync — the sync facade

Bundler plugin hooks and config factories are synchronous host APIs and the kit is async-first, so the sync facade is the escape hatch, in the same mold as [workspaces' equivalent](workspaces.md#workspacessync--the-escape-hatch). The design rule it implements: **sync escape hatches take their platform from the caller — the kit never imports `node:*` and never assumes posix.**

- **Consumer-supplied ops, structurally typed.** Minimal structural filesystem and path interfaces that Node's built-ins satisfy verbatim — the `fs` functions one-liner each, and `node:path` (including `node:path/win32` explicitly, or a Bun or Deno equivalent) *is* the path interface. Windows correctness is the consumer passing a win32-appropriate implementation, not anything in this module.
- **Zero logic duplication.** The facade runs the **unchanged** async pipeline; the consumer's ops are adapted into core service **values** provided per call, never layers, so there is no memoization to poison across calls with different options. The adapters are deliberately asymmetric: an unsupported path member throws a named defect, while an un-overridden filesystem member fails typed.
- **The failure contract is the async pipeline's, thrown.** The pipeline runs under `Effect.runSyncExit`; on failure the `Cause` is unwrapped so the typed error is thrown **as itself**, and a defect rethrows as-is. A caller never sees a fiber-failure wrapper.

## JsxConfig

A pure projection from decoded compiler options to the JSX transform a bundler can actually configure. The automatic-runtime spellings yield the automatic runtime with the import source defaulting exactly as tsc does; the classic spelling yields classic, with the factory options left on the compiler-options model where classic consumers read them. `preserve`, React Native and an absent setting yield `Option.none()` — JSX is left untransformed, so there is nothing to configure.

## Discovery

Nearest-tsconfig upward search over [walker](walker.md), with the filename parameterized — the default, a build-variant name or any other by argument — returning `Option`. Absence is `Option.none()`, never an error, and the stop boundary is inclusive.

## The numeric-enum codec: data, not typescript

One pure module owns the version-coupled string↔numeric mappings **as plain data**, including the enum-value gaps that not all TypeScript versions export, plus the lib-reference normalizer. When TypeScript adds an enum member, the change here is a data edit and a test fixture, not a dependency bump.

The **encode** direction feeds an external virtual-TS environment; the **decode** direction absorbs numeric configs coming out of TS APIs. Two whole-object properties are load-bearing:

- **Decode returns an open record, not the validated option type** — passthrough-honest. A numeric value with no table entry (a future TS enum member) is left as-is rather than errored; callers wanting the validated shape decode through the schema afterwards.
- **The `lib` encode direction emits the file-name form**, not the short name, verified against the installed TypeScript, which joins each entry onto the lib directory as a literal file name. A virtual-TS environment hands the options straight to the compiler, so consumers get the one form it resolves. Decode and the normalizer emit the short form.

### The typed encode return

Encode returns exported **structural** types rather than an open record, so a consumer handing the result to a virtual-TS environment or to the compiler does not end the pipeline with a cast. Those types are a verbatim structural transcription of TypeScript 6's compiler-option value union, minus the compiler-internal AST case unreachable from JSON, cited in TSDoc — **the zero-`typescript` rule is preserved**, nothing is imported.

The enum-family keys are typed as optional numbers, which is sound because a decoded options value restricts each spelling to the tables' covered literals, so the "unknown string passes through unencoded" branch is unreachable for well-typed input.

One **documented internal assertion** bridges the codec's internal record to the assignable value union, owned once here rather than re-cast at every call site — exactly as the compiler's own index signature makes the identical unproven claim about passthrough values. A compile-time assignability test pins the result against a cited structural replica, with no `typescript` import.

That free assignability targets the **TypeScript 6 consumer specifically**: TypeScript 7 dropped the index signature while keeping nominal enums, so the structural-subset argument holds against the TS6 shape the encode target's consumer pins. Worth recording as the version-coupled nuance it is.

## Portable tsconfig

A small pure module producing a self-contained, machine-independent config from a resolved one: compiler options only, emit, path and file-selection options excluded, `composite: false` and `noEmit: true` forced, and a `$schema` stamp. It is generic to any virtual-TS or Twoslash environment.

The filter is an **allow-list, never a deny-list**: only classified keys reach the output, and unknown options — including every forward-tolerance passthrough key the schemas preserve — are dropped by design. A portable config is deliberately a strict subset; growing it is an explicit, reviewed addition to the allow-list. Emit-formatting keys are excluded as having no bearing on type-checking and inert anyway under the forced `noEmit`.

### The opt-in tier: portable versus resolvable

The allow-list has **two tiers**. The unconditional tier is safe for every consumer. The second holds exactly one key, `types`, reached through an optional options argument and defaulting to off.

`types` exists because **portability and resolvability are different axes**, and the allow-list originally modeled only the first. `types` holds package *names*, never a path, so it passes the portability criterion outright — unlike `typeRoots`, which names machine-specific, config-location-dependent directories (absolute off a resolved config, relative off a bare options bag, portable in neither form) and stays dropped in **both** tiers.

What makes `types` not-unconditional is the failure mode it selects. Emitting it makes tsc **demand** those packages resolve, a hard error in a virtual environment with no `node_modules`; omitting it lets TypeScript auto-include whatever type packages the environment happens to have, and never error. Dropping it therefore trades a loud cannot-find-type-definition failure for a silent missing-globals one. Neither default serves both consumers, so the caller picks. Do not "simplify" this into an unconditional entry — the two-tier split is the whole point.

The precedent this sets: **a key that is portable but whose presence imposes a resolution obligation on the consuming environment belongs in the opt-in tier** — not the unconditional one, and not the exclusion list. The gap that produced the rule was a missing classification rather than a mechanism failure: an unclassified key was swallowed by the allow-list's own default, exactly as designed, and the symptom surfaced several layers downstream as missing ambient globals.

## Error handling

Typed errors owned by their modules, settled under the restrained-granularity rule of one tag per genuinely distinct recovery path.

A parse error carries the path and a structured cause; the path is the file path when the failure is file-bound and empty when decoding an in-memory string, with the loader wrapping file-bound decode failures and the codec module only declaring the error.

An extends error carries one tag with a `reason` literal covering not-found, cycle, depth and empty, because all four share a single recovery path — fix the chain — plus the full resolution chain of normalized absolute paths for diagnostics.

**`PlatformError` flows through untranslated** on IO: the package neither absorbs nor rewraps filesystem failures it cannot interpret.

## Testing

Per the [testing standards](../effect-standards.md#testing-standards): `@effect/vitest`, `it.effect`, `assert.*` never `expect`, tests in `__test__/`.

Resolution suites run on **in-memory fixture trees** — a noop filesystem layer over a `Map`, merged with core's `Path` layer, so there is **no platform package even in tests**. The map holds file paths only, so the fixture filesystem is structurally file-only, matching the loader's documented contract.

The families that matter: fixture trees with real extends chains asserting merge semantics and the extended-path ordering; data-driven parity tests recorded from the TypeScript-source verification; hostile inputs (cycles, deep chains, malformed JSONC, dunder keys) each failing with its typed error; round-trip properties on the document schema including unknown-key preservation; and the compile-time assignability test on the encode return.

## Consumers this API was designed against

- **`rspress-plugin-api-extractor`'s tsconfig parser** — loads a tsconfig by path, resolves extends, extracts a compiler-options subset, needs the extended-path metadata and feeds numeric options to a virtual-TS environment. This is the [gate-proof](../roadmap.md#consumer-ports) consumer, deferred to post-`0.1.0`.
- **`@savvy-web/bundler`'s tsconfig resolver** — the same load-and-resolve, followed by the numeric-to-portable-string conversion this package's string-level schemas eliminate outright.
- **`type-registry-effect`** (external) — its virtual-TS environment consumes numeric compiler options, which is the enum codec's encode target.

**Out of scope:** the bundler's declaration-file AST walkers and the api-extractor plugin's Twoslash type-checking keep direct `typescript` — the sanctioned island until the TS 7.1 JS API exists. This package resolves and shapes configuration; it never runs a compiler.

## Build and scaffolding

Scaffolded per [package-setup.md](../package-setup.md) from an existing boundary package. Standard gates: `tsc --noEmit`, a zero-warning `dist/prod/issues.json`, biome and markdownlint clean, the full suite green.

`savvy.build.ts` carries the standard **narrow** `_base` suppression; never widen it. The prod gate expects a **non-zero** suppressed count — `suppressed: 0` means the build did not run properly, which is exactly what running the prod target directly produces.
