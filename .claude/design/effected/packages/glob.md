---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 96
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../formatter-convention.md
  - walker.md
  - workspaces.md
  - github-actions.md
---

# @effected/glob design

## Overview

`@effected/glob` is glob matching as pure string→predicate compilation. Its engine is a full-fidelity vendored port of minimatch, brace-expansion and balanced-match, pinned to the versions this repo's lockfile resolves, each ported file carrying its upstream attribution and license header. Never edit those notices — the MIT files carry the full permission notice as license compliance.

## Tier and dependencies

**Pure tier.** `effect` is the only peer, with zero runtime dependencies, no services, no layers and no `R` anywhere. It vendors its engine because of dependency rule [R1](../effect-standards.md#dependency-policy) — pure and boundary packages take no external runtime deps — not because it lacks IO. Under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy), pure is a dependency statement, not an IO one; glob also happens to do no IO, but that is incidental to its tier.

The `minimatch` devDependency is the **test oracle only**, pinned exactly to the ported version and imported only under `__test__/`. Never move it to `dependencies`; never let it drift from the vendored version.

## Full-fidelity port

The port is the **complete** minimatch engine: extglobs, braces, character classes including POSIX classes, true `**` globstar, negation, `#`-comment handling and the full options surface. Scoping it to today's call sites was rejected — glob's broader dialect has known future consumers among the consuming applications, which is the same reasoning that made [toml](toml.md) a full-parity package.

The anti-drift concern a fixed dialect would address is solved differently. Multiple drifting glob semantics arise when each call site carries its own engine; the fix is everyone sharing **one** engine, not offering zero options. `GlobSet` pins fixed semantics internally, so the consumers that need drift-free behavior get it while applications reach the full dialect through `GlobPattern` options.

Two functional deviations from upstream are deliberate:

- **No ambient environment detection.** Upstream reads `process.platform`; here `platform` is an explicit option defaulting to `"posix"` — the [walker](walker.md) precedent, a pure library never reads ambient process state. The win32 path handling (UNC, drive letters, backslash splitting) is kept, behind the option.
- **Typed budget exhaustion instead of silent truncation.** Upstream truncates the expansion list at its budget and matches against the truncated set, silently changing match semantics. The port fails typed instead.

## `**` is real

`packages/**` matches `packages/a/b`. Do **not** reintroduce the trailing-`/**`-to-`/*` rewrite that some glob implementations carry: it silently misses nested matches. The consumer-side cost — an enumerator must do a bounded recursive descent instead of a single-level directory read — is exactly what the `crossesSegments` metadata below exists to drive.

## Module layout

Two concept modules plus the vendored engine, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `GlobPattern.ts` — single-pattern compilation, matching, metadata, options and the error.
- `GlobSet.ts` — multi-pattern include/exclude sets.
- `internal/` — the vendored engine, plus `limits.ts`, the zero-dependency leaf holding every numeric cap and the raw guard signal. `types.ts` is an engine leaf that breaks the upstream AST/index type cycle `noImportCycles` forbids.

The split is a **cycle firewall**: the engine throws raw guard records at compile time and never imports the facade, and only the two facade modules materialize them into the typed error.

## GlobPattern

A `Schema.Class` with one encoded field, the pattern source; the compiled matcher is cached in a non-encoded private instance field, since private indexes live outside the schema and are never encoded. Every construction path — `make`, `new`, decode, `FromString` — validates **compilability under default options** via a schema check, so a `GlobPattern` value is always defaults-compilable. Options refine matching; they never admit a defaults-rejected pattern.

`matches` is **total**: pure, with no error channel, and every compile-time guard fires before an instance exists, so nothing throws at match time.

**`Result` is the primitive.** `compileResult` holds the compilation, and `compile` is `Effect.fromResult` over it behind the named span — the span is the whole reason the `Effect` form exists. Never re-derive compilation on the `Effect` side. Compilation is pure, synchronous and `R = never`, so a synchronous host must not be made to build a runtime to compile a pattern. Kit convention: [the sync primitive policy](../sync-primitive-policy.md).

A `FromString` transformation schema exists for embedding patterns in config schemas; its decode failures surface as `SchemaError`. `escape` and `unescape` statics support building patterns from user-supplied literals.

`GlobPatternOptions` exposes minimatch's full options surface, schema-validated — see the source for the field list. **Invalid options are a developer wiring error and raise a defect** at construction; the typed channel stays reserved for malformed *patterns*. `braceExpandMax` is schema-bounded rather than a bare positive integer, because it is the one cap that can produce a compile-time typed failure: bounding it above by the stock budget guarantees permissive options can never admit a pattern the defaults check would reject. Caps tighten, never raise.

The error is a `Schema.TaggedError` carrying the pattern, a `reason` literal union and structured limit/actual fields. Malformed input is **never** a defect. Extglob over-nesting does not add a reason — it degrades to literal matching rather than erroring, matching upstream.

**Not a duplication of core.** `effect` ships `FileSystem.glob`, a filesystem-*scanning* glob. This package is deliberately a **pure string→predicate matcher** with no IO, which is exactly why the kit can point it at non-file candidates — `git ls-tree` entries, package names. Same noun, different concern; core still has no minimatch-dialect string predicate. Consumers wanting scan-plus-match against a real filesystem should reach for core's `FileSystem.glob`.

### The enumeration metadata

`enumerationPrefix` (the longest literal directory prefix) and `crossesSegments` (whether the pattern can match more than one level below that prefix — true iff it contains `**` or a `/` after the first magic segment) are **API with no upstream analogue**, designed for the enumerator contract. A substring-to-last-`/` prefix is wrong once `**` is real. Both are computed under default options, and their interaction with `matchBase` or windows modes stays defined only for default-options patterns.

**`enumerationPrefix` is meaningful for NON-NEGATED patterns only.** It is computed from the *inner* pattern, but a negated pattern's `matches` **inverts**, so it matches everything the inner pattern does not — and those matches can land anywhere, including outside the prefix. A negated pattern's walk must therefore ignore the prefix entirely: **start at the walk root and deep-walk unconditionally**, regardless of `crossesSegments`. Deep-walking *from the inner prefix* is the tempting half-fix that still silently misses every match outside it. Neither getter is wrong here — the inversion is simply not theirs to express, which is why the caveat lives with the contract rather than in each consumer's memory.

The contract has held under three independent consumers unmodified — the [workspaces](workspaces.md) enumerator it was designed against, [walker](walker.md)'s `descend` and [github-actions](github-actions.md)' cache-path search-root derivation, the last under real filesystem enumeration with round-trip and real-runner coverage. That is the useful part: a contract that survives its second and third consumer unchanged generalizes rather than encoding its first caller.

What remains open is narrow: no dedicated conformance run against a reference enumerator has been performed, so the enumeration semantics are **materially de-risked, not closed**. Nothing yet asserts case-by-case agreement with `@actions/glob` or another reference implementation.

## GlobSet

A `Schema.Class` over an array of pattern strings with **set** semantics: a leading `!` marks an exclusion, and a candidate matches when some include matches and no exclude does. `compileResult` is the primitive here too, with `compile` derived from it exactly as on `GlobPattern`.

Structural accessors serve the enumerator: deduped non-magic includes, magic includes, excludes and an exclusion predicate.

`GlobSet` pins default options internally and takes **no options surface** — it is the drift-free contract. The single-pattern-versus-set negation distinction is deliberate: minimatch's `!` negates the whole match, while the set treats `!` as an exclusion filter applied after positive matching. Both exist, at different levels, on purpose. Classification is pinned **per expanded alternative**, so a braced pattern expanding to both a literal and a wildcard contributes each alternative to its own bucket.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full. Upstream already carries substantial DoS hardening, **preserved** in the port: the 64KB pattern-length cap at every entry; brace-expansion's output budget, its recursion-to-loop rewrite and lazy tail evaluation; and the ReDoS-safe brace pre-check regex that mitigates CVE-2022-3517.

Two upstream guards are kept as **authorities**, not tightened: extglob recursion (over-nesting degrades to literal and does not error) and globstar recursion (exceeding it is upstream's deliberate false-negative "correctness for security" trade). Both are invariants, so `matches` stays total.

New depth guards at the shared nesting cap cover the remaining AST and brace-expansion recursion. **`balancedMatch.ts` is fully iterative — no stack surface, no guard; do not add one.**

One upstream hole is closed: coalescible nested extglobs recurse with a zero depth increment in stock minimatch, so it stack-overflows at default options on a roughly 60KB adoption chain that sits under its own length cap. The vendored AST parser adds a **structural depth backstop** counting every descent and failing typed, so that surface is guarded independently of the extglob recursion option. Know this before touching `ast.ts`.

Cap defaults live in `internal/limits.ts`. Three caps are caller-settable options, validated by the options schema so an invalid value is rejected as a wiring defect before any guard sees it. The internal-only caps follow the [walker](walker.md) `maxDepth` rule: a NaN or non-integer reaching a guard can only come from code, is programmer error and dies as a defect. Malformed input at every surface exits through the typed error — never a defect, never a hang.

The fs-walk optimizer passes are kept behind their option, for applications doing real directory walks.

## Observability

Pure-tier house rule: named `Effect.fn` spans on the public fallible boundaries only — the two `compile` statics. The span is the *entire* content of those wrappers, the engine having moved down to the `*Result` primitives; that is the point of the derivation, not an erosion of it, since a caller who wants the span still gets it by name. `matches` is infallible and hot, so it is span-free. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. No platform packages, no mock layers (no `R`), no `TestClock`. The engine is tested below the facade as well as through the public surface, in three families:

1. **A compliance fixture table** asserting the expected result *and* oracle agreement on every row.
2. **Oracle property tests** generating over the full dialect against the real `minimatch` package, asserting the vendored engine agrees modulo the two documented deviations. **If the engine disagrees with the oracle, fix the engine, never the expectation.** Oracle calls map `platform: "posix"` to upstream's `"linux"`, which has no posix member and is behaviorally identical while staying immune to ambient drift.
3. **A hostility suite** — oversized patterns, expansion bombs, deep brace nesting, extglob adoption chains, long globstar chains, deep comma-part chains — each failing through the typed error with the right reason, never a stack overflow, OOM or hang, plus the NaN and non-integer cap defect guards.

## Consumer contract

Glob itself does **no** enumeration — pure string→predicate only, and that is a load-bearing boundary.

[`@effected/workspaces`](workspaces.md) consumes it at three points: dependency matching expressed over `GlobPattern` (so workspaces carries no `minimatch` runtime dep), the `packages:` enumerator expressed over `GlobSet` (a literals fast-path, wildcards driving directory reads from `enumerationPrefix`, and `crossesSegments` triggering the bounded descent that makes `**` real end to end), and at-ref discovery matching the same compiled set against `git ls-tree` entries.

[`@effected/walker`](walker.md) is the second consumer, and the first outside workspaces. Its `descend` uses glob **type-and-property only** — a type-level import, the metadata getters and `matches` — so the boundary holds in the other direction too: the walker that does the IO takes no value dependency on the matcher that does none. That characterization describes `descend` specifically; walker's [`compileAndExpand`](walker.md#compileandexpand--the-recipe-seam) does value-import `compileResult` and the error to own the compile-plus-expand seam. The peer was already declared, so the dependency graph is unchanged, and `compileResult` being the primitive is what makes that seam cheap: walker folds a `Result` in place instead of crossing an `Effect` boundary twice to reach the same engine.

## Build and scaffold

Per [package-setup.md](../package-setup.md): scaffolded from a pure sibling, with model paths under `website/lib/models/glob`. The class factories mean `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories); never widen it. No `prepare` script: glob is a pure leaf with no workspace dependencies.
