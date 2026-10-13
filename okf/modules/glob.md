---
type: Module
title: glob
description: Full-fidelity glob matching as pure string-to-predicate Effect Schema compilation, vendoring the complete minimatch dialect.
status: stable
kind: package
resource: ../../packages/glob
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e455653ed4287cb9
---

# glob

## Purpose

`@effected/glob` is glob matching as pure string→predicate compilation. Its engine is a full-fidelity vendored port of minimatch, brace-expansion and balanced-match, pinned to the versions this repo's lockfile resolves, each ported file carrying its upstream attribution and license header — those notices are never edited, since the MIT files carry the full permission notice as license compliance. See [glob is a full-fidelity vendored port](../decisions/glob-full-fidelity-port.md) for why the whole dialect ships rather than a call-site-scoped subset.

## Tier and dependency posture

[Pure tier](../glossary/library-tier.md): `effect` is the only peer, with zero runtime dependencies, no services, no layers, and no `R` anywhere. It vendors its engine because of the kit's dependency policy — pure and boundary packages take no external runtime dependency — not because it lacks IO; under the [tier taxonomy](../glossary/library-tier.md), pure is a dependency statement, not an IO one, and glob also happens to do no IO, but that is incidental to its tier. The `minimatch` devDependency is the **test oracle only**, pinned exactly to the ported version and imported only under `__test__/`; it must never move to `dependencies` and must never drift from the vendored version.

## `**` is real

`packages/**` matches `packages/a/b`. The trailing-`/**`-to-`/*` rewrite some glob implementations carry is deliberately **not** reintroduced: it silently misses nested matches. The consumer-side cost — an enumerator must do a bounded recursive descent instead of a single-level directory read — is exactly what the `crossesSegments` metadata (below) exists to drive.

## Module layout

Two concept modules plus the vendored engine: `GlobPattern.ts` (single-pattern compilation, matching, metadata, options, and the error) and `GlobSet.ts` (multi-pattern include/exclude sets). `internal/` holds the vendored engine plus `limits.ts` (the zero-dependency leaf holding every numeric cap and the raw guard signal) and `types.ts` (an engine leaf that breaks the upstream AST/index type cycle `noImportCycles` forbids). The split is a cycle firewall: the engine throws raw guard records at compile time and never imports the facade, and only the two facade modules materialize them into the typed error.

## GlobPattern

A `Schema.Class` with one encoded field, the pattern source; the compiled matcher is cached in a non-encoded private instance field, since private indexes live outside the schema and are never encoded. Every construction path — `make`, `new`, decode, `FromString` — validates **compilability under default options** via a schema check, so a `GlobPattern` value is always defaults-compilable; options refine matching but never admit a defaults-rejected pattern. `matches` is **total**: pure, with no error channel, and every compile-time guard fires before an instance exists, so nothing throws at match time.

**`Result` is the primitive.** `compileResult` holds the compilation, and `compile` is `Effect.fromResult` over it behind the named span — the span is the whole reason the `Effect` form exists, per the [sync primitive policy](../conventions/sync-primitive-policy.md). Compilation is pure, synchronous and `R = never`, so a synchronous host must not be made to build a runtime to compile a pattern.

A `FromString` transformation schema exists for embedding patterns in config schemas; its decode failures surface as `SchemaError`. `escape` and `unescape` statics support building patterns from user-supplied literals. `GlobPatternOptions` exposes minimatch's full options surface, schema-validated. **Invalid options are a developer wiring error and raise a defect** at construction; the typed channel stays reserved for malformed *patterns*. `braceExpandMax` is schema-bounded rather than a bare positive integer, because it is the one cap that can produce a compile-time typed failure — bounding it above by the stock budget guarantees permissive options can never admit a pattern the defaults check would reject; caps tighten, never raise. The error is a `Schema.TaggedError` carrying the pattern, a `reason` literal union, and structured limit/actual fields; malformed input is never a defect, and extglob over-nesting does not add a reason (it degrades to literal matching, matching upstream).

**Not a duplication of core.** `effect` ships `FileSystem.glob`, a filesystem-*scanning* glob; this package is deliberately a pure string→predicate matcher with no IO, which is exactly why the kit can point it at non-file candidates — `git ls-tree` entries, package names. Consumers wanting scan-plus-match against a real filesystem should reach for core's `FileSystem.glob` instead.

### The enumeration metadata

`enumerationPrefix` (the longest literal directory prefix) and `crossesSegments` (whether the pattern can match more than one level below that prefix — true iff it contains `**` or a `/` after the first magic segment) are API with no upstream analogue, designed for the enumerator contract; a substring-to-last-`/` prefix is wrong once `**` is real. Both are computed under default options, and their interaction with `matchBase` or windows modes stays defined only for default-options patterns.

`enumerationPrefix` is meaningful for **non-negated** patterns only: it is computed from the *inner* pattern, but a negated pattern's `matches` inverts, matching everything the inner pattern does not — and those matches can land outside the prefix. A negated pattern's walk must therefore ignore the prefix entirely and deep-walk from the root unconditionally, regardless of `crossesSegments`.

The contract has held under three independent consumers unmodified — `workspaces`' enumerator, `walker`'s `descend`, and `github-actions`' cache-path search-root derivation, the last under real filesystem enumeration with round-trip and real-runner coverage. What remains open: no dedicated conformance run against a reference enumerator (`@actions/glob` or similar) has been performed, so the enumeration semantics are materially de-risked, not closed.

## GlobSet

A `Schema.Class` over an array of pattern strings with **set** semantics: a leading `!` marks an exclusion, and a candidate matches when some include matches and no exclude does. `compileResult` is the primitive here too, with `compile` derived from it exactly as on `GlobPattern`. Structural accessors serve the enumerator: deduped non-magic includes, magic includes, excludes, and an exclusion predicate. `GlobSet` pins default options internally and takes **no options surface** — it is the drift-free contract, deliberately distinct from minimatch's whole-match `!` negation, which applies at the single-pattern level. Classification is pinned **per expanded alternative**, so a braced pattern expanding to both a literal and a wildcard contributes each alternative to its own bucket.

## Hardening

Upstream already carries substantial DoS hardening, **preserved** in the port: the 64KB pattern-length cap at every entry; brace-expansion's output budget, its recursion-to-loop rewrite, and lazy tail evaluation; and the ReDoS-safe brace pre-check regex mitigating CVE-2022-3517. Two upstream guards are kept as **authorities**, not tightened: extglob recursion (over-nesting degrades to literal and does not error) and globstar recursion (exceeding it is upstream's deliberate false-negative "correctness for security" trade) — both are invariants, so `matches` stays total.

New depth guards at the shared nesting cap cover the remaining AST and brace-expansion recursion. `balancedMatch.ts` is fully iterative — no stack surface, no guard, and none should be added. One upstream hole is closed: coalescible nested extglobs recurse with a zero depth increment in stock minimatch, so it stack-overflows at default options on a roughly 60KB adoption chain that sits under its own length cap; the vendored AST parser adds a structural depth backstop counting every descent and failing typed, guarding that surface independently of the extglob recursion option. Cap defaults live in `internal/limits.ts`. Three caps are caller-settable options, validated by the options schema so an invalid value is rejected as a wiring defect before any guard sees it; the internal-only caps follow the [walker](walker.md) `maxDepth` rule — a NaN or non-integer reaching a guard can only come from code, is programmer error, and dies as a defect. Malformed input at every surface exits through the typed error, never a defect, never a hang.

## Observability

Named `Effect.fn` spans on the public fallible boundaries only — the two `compile` statics; the span is the *entire* content of those wrappers, the engine having moved down to the `*Result` primitives. `matches` is infallible and hot, so it is span-free. No metrics; telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. No platform packages, no mock layers (no `R`), no `TestClock`. The engine is tested below the facade as well as through the public surface, in three families: a compliance fixture table asserting expected result *and* oracle agreement on every row; oracle property tests generating over the full dialect against the real `minimatch` package, asserting the vendored engine agrees modulo the two documented deviations (if the engine disagrees with the oracle, fix the engine, never the expectation); and a hostility suite — oversized patterns, expansion bombs, deep brace nesting, extglob adoption chains, long globstar chains, deep comma-part chains — each failing through the typed error with the right reason, never a stack overflow, OOM or hang, plus the NaN and non-integer cap defect guards.

## Consumer contract

Glob itself does **no** enumeration — pure string→predicate only, and that is a load-bearing boundary. `workspaces` consumes it at three points: dependency matching expressed over `GlobPattern` (so `workspaces` carries no `minimatch` runtime dependency), the `packages:` enumerator expressed over `GlobSet` (a literals fast path, wildcards driving directory reads from `enumerationPrefix`, and `crossesSegments` triggering the bounded descent that makes `**` real end to end), and at-ref discovery matching the same compiled set against `git ls-tree` entries. `walker` is the second consumer and the first outside `workspaces`: its `descend` uses glob type-and-property only — a type-level import, the metadata getters, and `matches` — so the boundary holds in the other direction too, since the walker that does the IO takes no value dependency on the matcher that does none. `walker`'s `compileAndExpand` does value-import `compileResult` and the error to own the compile-plus-expand seam, and `compileResult` being the primitive is what makes that seam cheap: `walker` folds a `Result` in place instead of crossing an `Effect` boundary twice to reach the same engine.

## Build

Scaffolded from a pure sibling, with model paths under `website/lib/models/glob`. The class factories mean `savvy.build.ts` carries the narrow `_base` API Extractor suppression; never widen it. No `prepare` script: glob is a pure leaf with no workspace dependencies.
