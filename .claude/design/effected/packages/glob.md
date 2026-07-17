---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-17
last-synced: 2026-07-17
completeness: 98
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - walker.md
---

# @effected/glob design

## Overview

`@effected/glob` is glob matching as pure string→predicate compilation — a **pure-tier** sibling to `@effected/jsonc` and `@effected/yaml`. It is an internal package with no v3 source repo: its engine is a full-fidelity vendored port of minimatch, brace-expansion and balanced-match (versions pinned to those resolved in this repo's lockfile), each ported file carrying its upstream attribution and license header.

Its consumer is [`@effected/workspaces`](workspaces.md) at two call sites — `WorkspacePackage.matchesDependency` and the `packages:` pattern enumerator — plus the `WorkspaceSnapshots` at-ref discovery that matches the same compiled set against `git ls-tree` entries. Glob matching is a common utility the consuming applications will also need directly, which is why the port is full-dialect rather than scoped to today's call sites.

## Tier and dependencies

**Pure tier.** `peerDependencies: { effect: "catalog:effect" }` and zero runtime dependencies. No services, no layers, no `R` anywhere. It vendors its engine into `src/internal/` because of dependency rule [R1](../effect-standards.md#dependency-policy) — pure and boundary packages take no external runtime deps — not because it lacks IO. Under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy), pure is a dependency statement, not an IO one; glob also happens to do no IO, but that is incidental to its tier.

## Full-fidelity port

`@effected/glob` vendors the **complete** minimatch engine: extglobs, `{a,b}` braces, character classes including POSIX classes, true `**` globstar, negation, `#`-comment handling and the full options surface. Scoping the port to today's call sites (the original `@effected/toml` approach, since reversed — [releases.md](../releases.md#effectedtoml-is-a-full-parity-format-package)) was rejected: unlike toml, glob's broader dialect has known future consumers among the consuming applications.

The anti-drift concern that a fixed dialect would address is solved differently. The v3 repos had three drifting glob semantics because each call site carried its own engine; the fix is everyone sharing **one** engine, not offering zero options. `GlobSet` — the workspaces contract — pins its fixed semantics internally (default options), so the enumerator and `matchesDependency` semantics stay drift-free while applications get the full dialect through `GlobPattern` options.

Two functional deviations from upstream are deliberate:

- **No ambient environment detection.** Upstream's `defaultPlatform` reads `process.platform`; here `platform` is an explicit option defaulting to `"posix"` — the [walker](walker.md) precedent, a pure library never reads ambient process state. The win32 path-handling code is kept, behind the option.
- **Typed budget exhaustion instead of silent truncation.** Upstream `expand_` silently truncates the expansion list at `max` and matches against the truncated set, which silently changes match semantics. The port throws a guard signal that materializes as `GlobPatternError` with reason `ExpansionBudgetExceeded` instead.

## `**` is real

workspaces-effect's `glob-core.ts` silently rewrote a trailing `/**` to `/*` before compiling, so `packages/**` matched `packages/a` but not `packages/a/b` — nested packages were silently missed. This package does **not** carry that forward: `packages/**` matches `packages/a/b`. The consumer-side cost — the workspaces enumerator must do a bounded recursive descent instead of a single-level `readDirectory` — is what `crossesSegments` metadata (below) drives.

## Module layout

Two concept modules plus the vendored engine, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `GlobPattern.ts` — single-pattern compilation, matching, metadata, `GlobPatternError`, `GlobPatternOptions`.
- `GlobSet.ts` — multi-pattern include/exclude sets.
- `internal/` — the vendored engine (`minimatch.ts`, `ast.ts`, `braceExpansion.ts`, `balancedMatch.ts`, parsers and passes), plus `limits.ts`, the zero-dependency leaf holding every numeric cap and the raw `GuardExceeded` signal. `types.ts` is an engine leaf that breaks the upstream `ast.ts` ↔ `index.ts` type cycle `noImportCycles` forbids.

## Public surface

See `src/GlobPattern.ts` and `src/GlobSet.ts`; the index re-exports only.

### GlobPattern

A `Schema.Class` with one encoded field, `source: string`; the compiled matcher is cached in a non-encoded private instance field (private indexes live outside the schema and are never encoded). Every construction path — `make`, `new`, decode, `FromString` — validates **compilability under default options** via a schema check, so a `GlobPattern` value is always defaults-compilable.

- `GlobPattern.compile(source, options?): Effect<GlobPattern, GlobPatternError>` — the primary constructor and (with `GlobSet.compile`) the package's only fallible boundary, wrapped in `Effect.fn("GlobPattern.compile")`.
- A `FromString` transformation schema for embedding patterns in config schemas; decode failures surface as `SchemaError`.
- `matches(candidate: string): boolean` — **total**, pure, no error channel.
- Metadata getters: `hasMagic`, `negated`, `enumerationPrefix` (the longest literal directory prefix), `crossesSegments` (whether the pattern can match more than one level below `enumerationPrefix` — true iff it contains `**` or a `/` after the first magic segment).
- Statics `escape` / `unescape` for building patterns from user-supplied literals.

`enumerationPrefix` and `crossesSegments` are **new API with no upstream analogue**, designed for the enumerator contract — glob-core's `prefix` was substring-to-last-`/`, which is wrong once `**` is real. They are computed under default options, which is all `GlobSet` uses; their interaction with `matchBase`/windows modes stays defined only for default-options patterns.

Both held under a **second, independent consumer**: [`@effected/walker`](walker.md)'s `descend` drives a general-purpose filesystem walk off the same two getters, and needed no change to either for non-negated patterns. That is the useful part of the result — the metadata was designed against workspaces' enumerator, and a contract that survives its second consumer unmodified is one that generalizes rather than one that encoded its first caller.

**`enumerationPrefix` is meaningful for NON-NEGATED patterns only.** It is computed from the *inner* pattern, but a negated pattern's `matches()` **inverts**, so it matches everything the inner pattern does not — and those matches can land anywhere, including outside the prefix. Starting a walk at a negated pattern's `enumerationPrefix` therefore silently misses matches. Consumers must **deep-walk negated patterns unconditionally**, regardless of `crossesSegments`; `descend`'s walk condition is `crossesSegments || negated`. Neither getter is wrong here — the inversion is simply not theirs to express, and the caveat lives with the contract rather than in each consumer's memory.

`GlobPatternOptions` exposes minimatch's full options surface (schema-validated; see the source for the field list). Invalid options are a developer wiring error and raise a **defect** at construction; the typed channel stays reserved for malformed **patterns**. `braceExpandMax` is schema-bounded `[1, 100_000]` rather than a bare positive integer: it is the one cap that can produce a compile-time typed failure, so bounding it above by the stock budget guarantees permissive options can never admit a pattern the defaults check would reject. `platform` defaults to `"posix"`.

**Not a duplication of core.** `effect` introduced `FileSystem.glob(pattern, { root, exclude })` — a filesystem-*scanning* glob. This package is deliberately a **pure string→predicate matcher** with no IO, which is exactly why the kit can point it at non-file candidates: `git ls-tree` entries and package names. Same noun, different concern; core still has no minimatch-dialect string predicate. Consumers who want scan-plus-match against a real filesystem should reach for core's `FileSystem.glob`.

`GlobPatternError` lives in this module per the errors-near-domain rule: a `Schema.TaggedErrorClass` with `pattern`, a `reason` literal union (`PatternTooLong`, `ExpansionBudgetExceeded`, `NestingDepthExceeded`) and structured `limit`/`actual` fields. Malformed input is **never** a defect (the hardening invariant). Extglob over-nesting does not add a reason — it degrades to literal matching rather than erroring, matching upstream.

### GlobSet

A `Schema.Class` (encoded field `patterns: ReadonlyArray<string>`) with **set** semantics: a leading `!` marks an exclusion, and `matches(candidate) = someInclude && !someExclude`.

- `GlobSet.compile(patterns): Effect<GlobSet, GlobPatternError>`, wrapped in `Effect.fn("GlobSet.compile")`.
- Structural accessors serving the enumerator: `literals` (deduped non-magic includes), `wildcards` (magic includes), `excludes`, and `isExcluded(candidate)`.

`GlobSet` pins default options internally — it is the drift-free workspaces contract and takes no options surface. The single-pattern vs set negation distinction is deliberate: minimatch's `!` negates the whole match, while the set treats `!` as exclusion filters applied after positive matching; both exist, at different levels, on purpose. Expansion/classification is pinned **per expanded alternative**: a braced pattern that expands to both a literal and a wildcard contributes each alternative to its own bucket.

## Hardening

[hardening-a-parser-port](../effect-standards.md#input-hardening-standards) applies in full. Upstream already carries substantial DoS hardening, **preserved** in the port: `assertValidPattern`'s 64KB `MAX_PATTERN_LENGTH` at every entry; brace-expansion's `EXPANSION_MAX` output budget plus the `{a},b}` recursion-to-loop rewrite and lazy `post` evaluation; the ReDoS-safe brace pre-check regex `/\{(?:(?!\{).)*\}/` (the CVE-2022-3517 mitigation).

Every recursion surface in the engine carries an explicit bound. Upstream's own guards are kept as authorities — `maxExtglobRecursion` (default 2, over-nesting degrades to literal, does not error) and `maxGlobstarRecursion` (default 200, exceeding it is upstream's deliberate false-negative "correctness for security" trade, kept and documented as an invariant so `matches()` stays total). New depth guards at `MAX_NESTING_DEPTH` cover the remaining AST and brace-expansion recursion. `balancedMatch.ts` is fully iterative — **no stack surface, no guard; do not add one.**

One upstream hole is closed: coalescible nested extglobs recurse with `depthAdd = 0` in stock minimatch, so it stack-overflows at default options on a ~60KB adoption chain (under its own length cap). The vendored `ast.ts` `#parseAST` adds a **structural depth backstop** counting every descent, capped at `MAX_NESTING_DEPTH` and failing typed — so this surface is guarded independently of `maxExtglobRecursion`.

The cap defaults live in `internal/limits.ts`. Three caps are caller-settable options (`braceExpandMax`, `maxGlobstarRecursion`, `maxExtglobRecursion`), validated by the options schema as positive integers so an invalid value is rejected as a wiring defect before any guard sees it. The internal-only caps follow the [walker](walker.md) `maxDepth` rule: a NaN or non-integer reaching a guard can only come from code, is programmer error and dies as a defect (`assertCap`). Malformed input at every surface exits through `GlobPatternError` — never a defect, never a hang.

The fs-walk optimizer passes (`optimizationLevel` ≥ 1) are kept behind their option, for applications doing real directory walks.

## Observability

Pure-tier house rule: named `Effect.fn` spans on the public fallible boundaries only — `GlobPattern.compile` and `GlobSet.compile`. `matches` is infallible and hot: span-free. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. No platform packages, no mock layers (no `R`), no TestClock. The engine is tested below the facade (a compliance fixture table, oracle property tests, a hostility suite) as well as through the public surface. Three families:

1. **Inherited behavioral table** — the glob-core and `matchesDependency` compatibility cases, with the `**` case **inverted** since `packages/**` matches `packages/a/b` here by design.
2. **Oracle property tests** — the real `minimatch` npm package as a devDependency only, pinned exactly to the ported version, with `it.effect.prop` generating over the full dialect and asserting the vendored engine agrees with upstream, modulo the documented platform deviation. If the engine disagrees with the oracle, fix the engine, never the expectation.
3. **Hostility suite** — oversized patterns, expansion bombs, deep brace nesting, extglob adoption chains, long globstar chains and deep comma-part chains: each malformed input fails through `GlobPatternError` with the right `reason`, never a stack overflow, OOM or hang; plus the NaN/non-integer internal-cap defect guards.

## Build and scaffold

Per [package-setup.md](../package-setup.md): scaffolded from a pure sibling (jsonc), with model paths under `website/lib/models/glob`. `GlobPattern`, `GlobSet` and `GlobPatternError` are class factories, so `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories); never widen it. The `minimatch` devDependency is the oracle only — never in `dependencies`, never drifting from the vendored version. No `prepare` script: glob is a pure leaf with no `workspace:*` deps.

## Consumer contract

[`@effected/workspaces`](workspaces.md) consumes glob at three points, and glob itself does **no** enumeration — pure string→predicate only, a load-bearing boundary:

- `WorkspacePackage.matchesDependency` is expressed over `GlobPattern`, so workspaces carries no `minimatch` runtime dep.
- The `packages:` enumerator is expressed over `GlobSet`: a `literals` fast-path, `wildcards` driving `readDirectory` from `enumerationPrefix`, and `crossesSegments` triggering the bounded descent that makes `**` real end to end.
- `WorkspaceSnapshots` ([workspaces.md](workspaces.md)) matches the same compiled set against `git ls-tree` entries from [`@effected/git`](git.md) for at-ref discovery.

[`@effected/walker`](walker.md)'s `descend` is the second consumer, and the first outside workspaces: it peers on glob **type-and-property only** (a type-level `GlobPattern` import, the metadata getters and `matches`), so the boundary holds in the other direction too — the walker that does the IO takes no value dependency on the matcher that does none.
