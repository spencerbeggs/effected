---
type: Module
title: tsconfig-json
description: Read, decode, validate, resolve and construct tsconfig.json files with zero typescript imports.
status: stable
kind: package
resource: ../../packages/tsconfig-json
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 847a622f1c35a1f5
---

# tsconfig-json

## Purpose

`@effected/tsconfig-json` reads, decodes, validates, resolves and constructs `tsconfig.json` files: string-level schemas for the document shape, full `extends`-chain resolution matching `tsc` semantics, nearest-tsconfig upward discovery, a data-owned codec between string option values and TypeScript's numeric enums, and a portable-tsconfig filter for virtual-TS environments. It is a new invention scoped by named consumer surveys, not a port. It enforces the kit's TypeScript posture: version-coupled parts of tsconfig knowledge become plain data owned here, so no `@effected/*` package ever imports `typescript` — see [no typescript imports](../conventions/no-typescript-imports.md).

## One package, not two

A split into a pure schema package plus a boundary IO package was considered and rejected — see [tsconfig-json is one package, not two](../decisions/tsconfig-one-package-not-two.md). The two-layer instinct survives as **internal architecture**: pure schema and codec modules that never import `FileSystem`, and separate loader, resolver and discovery modules that do.

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md). All file IO — loading, extends resolution, discovery — goes exclusively through core `FileSystem`/`Path` arriving via the `R` channel, and `PlatformError` flows through untranslated. `effect` is the only non-workspace peer; `jsonc` (the decode engine) and `walker` (upward traversal) are `workspace:^` peers mirrored by plain `workspace:*` devDependencies. Runtime `dependencies` stays **empty**.

**Hard rule: zero `typescript` imports anywhere, including type imports.** The version-coupled enum mappings are owned as plain data (see [the numeric-enum codec](#the-numeric-enum-codec-data-not-typescript)); anything shaped like `ts.CompilerOptions` is typed structurally. No services, no layers: the package exposes effectful statics requiring `FileSystem`/`Path` in `R`, discharged once by the consumer's platform layer at the edge — there is no per-consumer state that would earn a `Context.Service`.

## Module layout

One concept per file, no barrels beyond `index.ts`. The document schema, option schemas, merge engine, enum codec, the programmatic-input codec, portable filter and JSX projection are all **pure** and never import `FileSystem`; only the loader, its sync facade, discovery and the internal target resolver touch the `R` channel. The merge engine takes an injected `join` rather than the `Path` service, which is what keeps it on the pure side.

The extends-target resolver is one internal module (`internal/extendsTarget.ts`) owning both target forms — relative/rooted resolution, and bare-specifier `node_modules` lookup including a hardened subset of package.json `exports`-map resolution — because target resolution is an implementation seam of the loader, not a concept a consumer names; a hostile manifest is absorbed to "no resolution for that candidate", never a defect. The document codec is a bare module-level const rather than a dotted static, because the document schema is a `Schema.StructWithRest` **value** chosen for its passthrough rest row, which has no static slot to hang a `FromString` idiom on.

## Schema design: string-level, JSONC-always, forward-tolerant

The document schema models the raw file shape. Enum-valued options stay **string-level literal unions**, case-insensitive on decode the way `tsc` accepts them, canonical-lowercase on encode, eliminating the numeric→string round trip a raw consumer of the TypeScript config API performs; option *names* stay case-sensitive. The package targets **TS ≥ 6 only** — dead and removed options get no typed fields, but they are not decode errors either, riding the passthrough. The schema is **forward- and backward-tolerant**: unknown compiler-option keys are preserved through decode via a passthrough record, never rejected; known keys validate strictly; unknown keys survive re-encode — TypeScript adds options every minor release, and a schema pinned at publish time must not break on a newer consumer's tsconfig. **Every parse is JSONC**, unconditionally — tsconfig files are JSONC regardless of the `.json` name, and there is no JSON-strict path. Construction and validation are pure and need no IO.

## Extends resolution and merge semantics

The loader reads a tsconfig by path, decodes it as JSONC, and resolves the full `extends` chain matching `tsc` semantics: relative targets against the extending file's directory; array `extends` with later entries winning; and package-name targets via plain upward `node_modules` **file** resolution, including the implicit `/tsconfig.json` suffix and the package.json `"tsconfig"` field — file and module-path resolution, not compiler machinery, which is the whole reason this capability can live in a zero-`typescript` package. Compiler options merge per key with the derived config winning; file-selection arrays replace wholesale; relative paths in a base config are re-rooted relative to the base file; project references are never inherited. The result is a resolved-config type distinct from the document type, carrying the config path and the extended paths in resolution order, with `${configDir}` substitution as a final phase and `pathsBase` provenance.

The lookup and merge rules were extracted from the TypeScript source and encoded as data-driven tests with line citations embedded in the test comments and module headers, so drift from `tsc` is a failing test rather than a latent bug — these parity facts cost real review cycles and must not be regressed: a malformed or non-object `package.json` coerces to `{}` and falls through to the `<pkg>/tsconfig.json` probe; there is no `package.json` presence gate; the ancestor `node_modules` walk continues past a present-but-unresolved candidate rather than aborting; a falsy `"tsconfig"` manifest field falls through to the `tsconfig.json` probe; `exports`-map wildcard selection is longest base prefix, not first-in-order; and slashes are normalized once, on the spec, with the normalized name resolving throughout.

**The file-only `FileSystem` contract** is a deliberate, accepted divergence: target probes use core `FileSystem.exists`, true for a directory on a real filesystem, whereas `tsc`'s host check is file-only. A relative extends target naming a real directory therefore resolves the directory verbatim and the subsequent read fails with a typed `PlatformError`, where `tsc` would retry the `.json`-appended sibling. This satisfies the hardening invariant, the in-memory fixture filesystem cannot exercise it by construction, and a stat-and-is-file probe would rewrite the `tsc`-cited target engine for a case no supported test can reach — do not "fix" it.

Extends resolution is a recursive walk over untrusted files, so the input-hardening invariants apply and must not be relaxed: an extends-depth guard with **per-branch** cycle stacks (so diamonds stay legal), a recursion depth guard inside the `exports`-map subset, own-property checks on every untrusted map read with dunder keys skipped, and wildcard-substituted maps built on a null prototype. Malformed input always fails through the typed channel, never as a defect.

## The loader surface

`load`, `resolve` and `compilerOptions` are uniform `Effect.fn`s with named spans; `compilerOptions` is a thin projection of `resolve` down to the merged compiler options — the common "just give me the effective options" question, so consumers stop hand-parsing tsconfig files with bare `JSON.parse`, which is JSONC-blind and misses everything inherited through `extends`.

### TsconfigLoaderSync — the sync facade

Bundler plugin hooks and config factories are synchronous host APIs, and the kit is async-first, so the sync facade is the escape hatch — the design rule it implements: sync escape hatches take their platform from the caller, since the kit never imports `node:*` and never assumes posix. **Consumer-supplied ops, structurally typed**: minimal structural filesystem and path interfaces that Node's built-ins satisfy verbatim (the `fs` functions one-liner each, and `node:path` — including `node:path/win32` explicitly, or a Bun or Deno equivalent — *is* the path interface). Windows correctness is the consumer passing a win32-appropriate implementation, not anything in this module. **Zero logic duplication**: the facade runs the unchanged async pipeline under `Effect.runSyncExit`; the consumer's ops are adapted into core service **values** provided per call, never layers, so there is no memoization to poison across calls with different options — an unsupported path member throws a named defect, while an un-overridden filesystem member fails typed. **The failure contract is the async pipeline's, thrown**: on failure the `Cause` is unwrapped so the typed error is thrown as itself, and a defect rethrows as-is — a caller never sees a fiber-failure wrapper. `TsconfigLoaderSyncOptions` is the shape a Node consumer's `fs`/`path` wrapper satisfies to unlock this facade.

## JsxConfig

A pure projection from decoded compiler options to the JSX transform a bundler can actually configure. The automatic-runtime spellings yield the automatic runtime with the import source defaulting exactly as `tsc` does; the classic spelling yields classic, with the factory options left on the compiler-options model where classic consumers read them. `preserve`, React Native and an absent setting yield `Option.none()` — JSX is left untransformed, so there is nothing to configure.

## Discovery

Nearest-tsconfig upward search over `walker`, with the filename parameterized — the default, a build-variant name, or any other by argument — returning `Option`. Absence is `Option.none()`, never an error, and the stop boundary is inclusive.

## The numeric-enum codec: data, not typescript

One pure module owns the version-coupled string↔numeric mappings **as plain data**, including the enum-value gaps that not all TypeScript versions export, plus the lib-reference normalizer — see [the numeric-enum codec is data, not code](../decisions/numeric-enum-codec-is-data.md) and [the enum mapping tables](../models/tsconfig-enum-mappings.md) for the tables' own shape and refresh procedure. When TypeScript adds an enum member, the change here is a data edit and a test fixture, not a dependency bump.

The **encode** direction feeds an external virtual-TS environment; the **decode** direction absorbs numeric configs coming out of TS APIs. Decode returns an open record, not the validated option type — passthrough-honest: a numeric value with no table entry (a future TS enum member) is left as-is rather than errored, and callers wanting the validated shape decode through the schema afterwards. The `lib` encode direction emits the file-name form (`lib.esnext.d.ts`), not the short name, verified against the installed TypeScript, which joins each entry onto the lib directory as a literal file name — a virtual-TS environment hands the options straight to the compiler, so consumers get the one form it resolves; decode and the normalizer emit the short form.

Encode returns exported **structural** types rather than an open record, so a consumer handing the result to a virtual-TS environment or to the compiler does not end the pipeline with a cast — those types are a verbatim structural transcription of TypeScript 6's compiler-option value union, minus the compiler-internal AST case unreachable from JSON, cited in TSDoc; the zero-`typescript` rule is preserved throughout. One documented internal assertion bridges the codec's internal record to the assignable value union, owned once here rather than re-cast at every call site, exactly as the compiler's own index signature makes the identical unproven claim about passthrough values, pinned by a compile-time assignability test against a cited structural replica with no `typescript` import. That free assignability targets the TypeScript 6 consumer specifically — TypeScript 7 dropped the index signature while keeping nominal enums, so the structural-subset argument holds against the TS6 shape the encode target's consumer pins.

### The validating door in

A **codec**, composing the existing decode normalizer with the schema's own decode, is the answer to "someone writing options in TypeScript naturally reaches for `ts.ScriptTarget.ES2025` over `\"es2025\"`" — deliberately not a `normalizeCompilerOptions` function, because the normalizer already exists (whole-object decode does the entire value-level job) and the actual gap is typing, not normalization: decode's open-record return is deliberate, so a total function returning the validated option type cannot exist without re-asserting exactly what a downstream laundering cast already asserts, one layer up. The codec form buys three things a function could not: "never guess" becomes enforced (an unmappable numeric survives normalization as a number and is rejected typed by the enum-family schemas, rather than the pass-through staying correct one layer down where a boundary that *promises* the validated type has to fail loudly); case-insensitivity comes free from the schema's existing case-insensitive literal decode; and the synchronous consumer keeps its shape via the schema's `Result` entry point with no `Effect` in the path. Scope is the exact inverse of the encode direction — the same six compiler-option families plus `lib`, deliberately not the watch families, which belong to a different document node.

## Portable tsconfig

A small pure module producing a self-contained, machine-independent config from a resolved one: compiler options only, emit/path/file-selection options excluded, `composite: false` and `noEmit: true` forced, and a `$schema` stamp. It is generic to any virtual-TS or Twoslash environment. The filter is an **allow-list, never a deny-list** — only classified keys reach the output, and unknown options, including every forward-tolerance passthrough key the schemas preserve, are dropped by design; growing the allow-list is an explicit, reviewed addition. Emit-formatting keys are excluded as having no bearing on type-checking and inert under the forced `noEmit`.

The allow-list has **two tiers**. The unconditional tier is safe for every consumer; the second holds exactly one key, `types`, reached through an optional options argument and defaulting to off. `types` holds package *names*, never a path, so it passes the portability criterion outright — unlike `typeRoots`, which names machine-specific, config-location-dependent directories and stays dropped in **both** tiers. What makes `types` not-unconditional is the failure mode it selects: emitting it makes `tsc` **demand** those packages resolve, a hard error in a virtual environment with no `node_modules`, while omitting it lets TypeScript auto-include whatever type packages the environment happens to have and never error — dropping it trades a loud failure for a silent missing-globals one, so the caller picks. Do not simplify this into an unconditional entry; the two-tier split is the whole point.

## Errors

Typed errors owned by their modules, under the restrained-granularity rule of one tag per genuinely distinct recovery path. A parse error carries the path and a structured cause; the path is the file path when the failure is file-bound and empty when decoding an in-memory string. An extends error carries one tag with a `reason` literal covering not-found, cycle, depth and empty, because all four share a single recovery path (fix the chain), plus the full resolution chain of normalized absolute paths for diagnostics. `PlatformError` flows through untranslated on IO — the package neither absorbs nor rewraps filesystem failures it cannot interpret.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` never `expect`, tests in `__test__/`. Resolution suites run on in-memory fixture trees — a real volume from `memfs` (a devDependency) seeded from a `Map`, merged with core's `Path` layer, so there is still no platform package even in tests. **A structurally file-only double must never come back**, and the reason is this package's own cautionary tale: a `layerNoop`-over-a-`Map` fixture makes directories not exist, which makes its `exists` structurally file-only, accidentally *agreeing* with the loader's file-only contract and thereby hiding the very divergence that contract exists to record — a test asserting `Option.none()` for a relative path to a directory passed for the wrong reason under that stub, while against a real volume the divergence is observable and the test pins the real answer. The **discovery** suite keeps a separate, narrow `layerNoop` stub, since it asserts which candidates walker probes rather than what a filesystem holds. The families that matter: fixture trees with real extends chains asserting merge semantics and extended-path ordering; data-driven parity tests recorded from the TypeScript-source verification; hostile inputs (cycles, deep chains, malformed JSONC, dunder keys) each failing with its typed error; round-trip properties on the document schema including unknown-key preservation; and the compile-time assignability test on the encode return.

## Consumers this API was designed against

`rspress-plugin-api-extractor`'s tsconfig parser loads a tsconfig by path, resolves extends, extracts a compiler-options subset, needs the extended-path metadata, and feeds numeric options to a virtual-TS environment. `@savvy-web/bundler`'s tsconfig resolver does the same load-and-resolve, followed by the numeric-to-portable-string conversion this package's string-level schemas eliminate outright. `type-registry-effect` (external) consumes numeric compiler options in its virtual-TS environment, which is the enum codec's encode target. Out of scope: the bundler's declaration-file AST walkers and the api-extractor plugin's Twoslash type-checking keep direct `typescript` as a sanctioned island — this package resolves and shapes configuration; it never runs a compiler.

## Build

Standard gates: `tsc --noEmit`, a zero-warning `dist/prod/issues.json`, Biome and markdownlint clean, the full suite green. `savvy.build.ts` carries the standard narrow `_base` suppression; the prod gate expects a **non-zero** suppressed count — `suppressed: 0` means the build did not run properly.
