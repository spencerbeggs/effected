---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-10
last-synced: 2026-07-10
completeness: 98
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - walker.md
---

# @effected/glob design

## Overview

Target design for `@effected/glob`, the **seventh** package migration (step 2 of [migration-playbook.md](../migration-playbook.md)) and a **pure-tier** package. Glob is glob matching as pure string→predicate compilation — a sibling to `@effected/jsonc` and `@effected/yaml`. It is an **internal package** with no v3 source repo: its engine sources are minimatch 10.2.5 (BlueOak-1.0.0, Isaac Z. Schlueter), brace-expansion 5.0.7 (MIT, Julian Gruber) and balanced-match 4.0.4 (MIT, Julian Gruber) — the exact versions resolved in both this repo's and workspaces-effect's lockfiles. The port sizes at roughly 2,450 lines across three attributions, between jsonc and yaml in scale.

Its only consumer today is the future `@effected/workspaces`, at two call sites: `WorkspacePackage.matchesDependency` (which drops its `minimatch: ">=10.2.3"` runtime dep with its hazardous open-ended range) and the `packages:` pattern enumerator. Until workspaces lands, glob has no consumer — that is exactly why it runs now, while the minimatch dialect and CVE analysis from the 2026-07-09 surveys are fresh.

## Tier and dependencies

**Pure tier.** `peerDependencies: { effect: "catalog:effect" }` and zero runtime dependencies. No services, no layers, no `R` anywhere.

It vendors a ported-with-attribution engine into `src/internal/` because of dependency rule [R1](../effect-standards.md#dependency-policy) — pure and boundary packages take no external runtime deps — **not** because it lacks IO. Under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy), pure is a dependency statement, not an IO one; glob happens to also do no IO, but that is incidental to its tier.

## The headline decision: a full-fidelity port

`@effected/glob` vendors the **complete** minimatch 10.2.5 engine (plus brace-expansion 5.0.7 and balanced-match 4.0.4): extglobs, `{a,b}` braces, character classes including POSIX classes, true `**` globstar, negation, `#`-comment handling and the full options surface.

Scoping the port to today's call sites — the original `@effected/toml` precedent, itself since reversed ([releases.md](../releases.md#effectedtoml-is-a-full-parity-format-package)) — was considered and **rejected**: unlike toml, glob's broader dialect has known future consumers. Glob matching is a common utility that the five consuming applications will need directly, not just `@effected/workspaces`. The consumer-contract survey (2026-07-09) still defines the **minimum** the package must satisfy — the two workspaces call sites, which use only segment-scoped `*`/`?`, leading-`!` negation, literals and anchored matching, with zero options — it just no longer bounds the dialect.

The anti-drift concern that motivated a fixed dialect is solved differently: the v3 repo had three drifting glob semantics because each call site carried its own engine, and the fix is everyone sharing **one** engine, not having zero options. `GlobSet` — the workspaces contract — pins its fixed semantics internally (default options), so the enumerator and `matchesDependency` semantics stay drift-free while applications get the full dialect through `GlobPattern` options.

One deliberate functional deviation from upstream was planned here, **no ambient environment detection**: upstream's `defaultPlatform` reads `process.platform`; here `platform` is an explicit option defaulting to `"posix"` — the [walker](walker.md) precedent: the caller who knows passes it in, and a pure library never reads ambient process state. The win32 path-handling code is kept, behind the option. Implementation surfaced a second deviation this section originally ruled out — typed budget exhaustion — recorded in [As built](#as-built-2026-07-09).

## Issue #62: the mandated behavior change

workspaces-effect's `glob-core.ts` line 42 silently rewrites a trailing `/**` to `/*` before compiling, locked in by its own test: `packages/**` matches `packages/a` but **not** `packages/a/b`. Nested packages are silently missed — their issue #62. [package-inventory.md](../package-inventory.md#internal-packages-no-source-repo) mandates glob must not carry this forward: **`**` is real here.** `packages/**` matches `packages/a/b`.

The consumer-side cost — the workspaces enumerator must do a bounded recursive descent instead of a single-level `readDirectory` — lands with the workspaces port, not here; glob's `crossesSegments` metadata (below) is how the enumerator will know. One consumer-contract survey suggestion to preserve the degradation for parity was considered and **rejected**: the inventory decision stands, and behavioral parity with a known bug is not a goal.

## Module layout

Two concept modules plus the vendored engine, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

```text
packages/glob/
  src/
    GlobPattern.ts       # single-pattern compilation, matching, metadata, GlobPatternError
    GlobSet.ts           # multi-pattern include/exclude sets
    index.ts             # public surface, re-exports only
    internal/
      limits.ts          # zero-dep leaf: all numeric cap constants and guard defaults
      balancedMatch.ts   # balanced-match 4.0.4 port
      braceExpansion.ts  # brace-expansion 5.0.7 port
      ...                # the full minimatch 10.2.5 port (AST, compiler, optimizer passes)
  __test__/
    GlobPattern.test.ts
    GlobSet.test.ts
```

Every ported file in `src/internal/` carries an attribution header comment naming the source package, version, license and author; LICENSE handling follows repo convention. `limits.ts` holds `MAX_PATTERN_LENGTH` (64KB, the upstream cap), `EXPANSION_MAX` (100,000), `MAX_GLOBSTAR_RECURSION` (200) and `MAX_NESTING_DEPTH` (256, the house parity constant for the new depth guards).

## Public surface

### GlobPattern

`class GlobPattern extends Schema.Class<GlobPattern>("GlobPattern")` with one encoded field, `source: string`. The compiled matcher is cached in a non-encoded `#private` instance field — the workspaces-review `WorkspaceStateSnapshot` precedent: private indexes live outside the schema and are never encoded.

- `GlobPattern.compile(source, options?): Effect<GlobPattern, GlobPatternError>` — the primary constructor and (with `GlobSet.compile`) the package's only fallible boundary. Wrapped in `Effect.fn("GlobPattern.compile")`.
- A `FromString` transformation schema (the house FromString-static codec idiom) for embedding patterns in config schemas; decode failures surface as `SchemaError` to be normalized by the embedding schema's boundary.
- `make` remains available for pre-validated construction per the house make-not-new rule; a schema `.check(...)` validates compilability, so `make` on a bad pattern fails validation.
- `matches(candidate: string): boolean` — **total**, pure, no error channel.
- `hasMagic: boolean`; `negated: boolean` (leading `!`, minimatch whole-pattern-negation semantics at the single-pattern level).
- `enumerationPrefix: string` — the longest literal directory prefix: the segments before the first magic-bearing segment, `""` if the first segment has magic.
- `crossesSegments: boolean` — whether the pattern can match more than one level below `enumerationPrefix`; true iff it contains `**` or a `/` after the first magic segment.
- Statics `escape(literal)` / `unescape(pattern)` — ported, trivial, rounding out the surface for building patterns from user-supplied literals.

**Options.** `compile` takes a schema-validated options type exposing minimatch's surface: `nobrace`, `nocomment`, `nonegate`, `noglobstar`, `noext`, `dot`, `nocase`, `nocaseMagicOnly`, `magicalBraces`, `matchBase`, `flipNegate`, `partial`, `preserveMultipleSlashes`, `optimizationLevel`, `platform`, `windowsPathsNoEscape`, `windowsNoMagicRoot`, `braceExpandMax`, `maxGlobstarRecursion`, `maxExtglobRecursion`. The deprecated `allowWindowsEscape` is dropped. Invalid options are a developer wiring error and raise a **defect** at construction; the typed channel stays reserved for malformed **patterns**. `platform` defaults to `"posix"` per the no-ambient-detection deviation above.

`enumerationPrefix` and `crossesSegments` are **new API with no upstream analogue**, designed for the enumerator contract — glob-core's `prefix` was substring-to-last-`/`, which is wrong once `**` is real. They are computed under default options. **OPEN:** their exact shape gets validated against the real enumerator when workspaces ports, and how they interact with `matchBase`/windows modes is unresolved — likely defined only for default-options patterns, which is all `GlobSet` uses.

`GlobPatternError` lives in this module per the errors-near-domain rule: a `Schema.TaggedErrorClass` with `pattern: string` (truncated for safety in messages), `reason: Schema.Literal("PatternTooLong", "ExpansionBudgetExceeded", "NestingDepthExceeded")` and structured `limit`/`actual` number fields. Kind: recoverable typed failure — malformed input is **never** a defect (the hardening invariant). Audience: calling code (stable `_tag` plus `reason` to branch on) and the end user (the message names the cap). Extglob over-nesting does not add a reason: it degrades to literal matching rather than erroring, matching upstream (see [Hardening](#hardening)).

### GlobSet

`class GlobSet` (Schema.Class, encoded field `patterns: ReadonlyArray<string>`) — the multi-pattern include/exclude set with glob-core's **set** semantics: a leading `!` marks an exclusion, and `matches(candidate) = someInclude && !someExclude`.

- `GlobSet.compile(patterns): Effect<GlobSet, GlobPatternError>`, wrapped in `Effect.fn("GlobSet.compile")`.
- Structural accessors serving the enumerator: `literals: ReadonlyArray<string>` (deduped non-magic includes), `wildcards: ReadonlyArray<GlobPattern>` (magic includes), `excludes: ReadonlyArray<GlobPattern>`; `isExcluded(candidate): boolean`.

`GlobSet` pins default options internally — it is the drift-free workspaces contract, and takes no options surface of its own.

The single-pattern vs set negation semantics distinction is deliberate and worth stating: minimatch's `!` negates the whole match, while the set treats `!` as exclusion filters applied after positive matching. Both exist, at different levels, on purpose.

**OPEN:** expansion/classification order. A braced pattern that expands to both a literal and a wildcard (e.g. `{tools/cli,packages/*}`) can be classified per expanded alternative (recommended) or per source pattern. Pin at implementation with a test.

## Hardening

[hardening-a-parser-port](../effect-standards.md#input-hardening-standards) applies in full. The engine survey found that upstream 10.2.5/5.0.7 already carry substantial DoS hardening which **must be preserved** in the port:

- `assertValidPattern`'s 64KB `MAX_PATTERN_LENGTH` at every entry.
- brace-expansion's `EXPANSION_MAX` output budget, plus two recent structural fixes: the `{a},b}` rewrite converted from recursion to a `for`-loop against stack exhaustion, and lazy `post` evaluation killing the `a{},{},{}` exponential blowup.
- The ReDoS-safe brace pre-check regex `/\{(?:(?!\{).)*\}/` — the CVE-2022-3517 mitigation, credited upstream to Yeting Li.

The full port puts **all eight** recursion surfaces from the engine survey in scope, each with an explicit bound:

1. `AST.#parseAST` nested-extglob recursion — upstream's `maxExtglobRecursion` (default 2) guard is **kept as the depth authority**, and its on-limit degrade-to-literal behavior is preserved: over-nesting degrades, it does not error.
2. `AST.toRegExpSource` ↔ `#partsToRegExp` tree-depth recursion — no upstream guard; gains a depth counter.
3. `AST.#flatten` — the upstream 10-pass width cap is kept; a tree-depth guard is added.
4. `AST.clone`/`copyIn` — gains a depth counter.
5. `#matchGlobStarBodySections` — upstream's `maxGlobstarRecursion` (default 200) is kept. Exceeding it is upstream's deliberate false-negative "correctness for security" trade, which we **keep and document as an invariant** rather than converting to an error: `matches()` stays total.
6. brace-expansion `expand_` — the `EXPANSION_MAX` budget, `for`-loop rewrite and lazy `post` are kept; gains a depth guard at `MAX_NESTING_DEPTH`.
7. brace-expansion `parseCommaParts` — self-recursive on `post`; currently relies **only** on the 64KB length cap, gains a depth guard.
8. balanced-match — fully iterative, **no stack surface**. Recorded here so nobody adds a guard there.

The fs-walk optimizer passes (`optimizationLevel` ≥ 1: `firstPhasePreProcess` / `secondPhasePreProcess` / `levelTwoFileOptimize` / `partsMatch`) are **kept** — they sit behind an option, and applications doing real directory walks will want them.

The cap **defaults** live in `internal/limits.ts`. Three caps are caller-settable options — `braceExpandMax`, `maxGlobstarRecursion` and `maxExtglobRecursion` — and are validated by the options schema (positive integers), so an invalid value is rejected as the wiring defect the Options paragraph already establishes, before any guard sees it. The internal-only caps (`MAX_PATTERN_LENGTH`, `MAX_NESTING_DEPTH` and the `EXPANSION_MAX` default) follow the [walker](walker.md) `maxDepth` rule: a NaN or non-integer reaching a guard can only come from code, is programmer error and dies as a defect. Malformed input at every surface exits through `GlobPatternError` — never a defect, never a hang.

## Observability

Pure-tier house rule: named `Effect.fn` spans on the public fallible boundaries only — `GlobPattern.compile` and `GlobSet.compile`. `matches` is infallible and hot: span-free. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Tests live in `__test__/GlobPattern.test.ts` and `__test__/GlobSet.test.ts`. No platform packages, no mock layers (no `R`), no TestClock. Three families:

1. **Inherited behavioral table.** Port the 9 `glob-core.test.ts` cases and the 3 `matchesDependency` cases (exact literal; `*test*`; `@scope/*` does **not** match slash-free names since `*` won't cross `/`) as compatibility fixtures — with the #62 case **inverted**: `packages/**` matches `packages/a/b` here, by design.
2. **Oracle property tests.** `minimatch` (the real npm package) as a devDependency **only**, with `it.effect.prop` generating over the **full dialect** — extglobs and option objects included — asserting the vendored engine agrees with upstream, modulo the documented platform/ambient-detection deviation. The full-fidelity port makes the oracle much stronger than a dialect-bounded one would be.
3. **Hostility suite.** >64KB patterns, expansion bombs (`{a,b}` repetition toward the 100k budget), deep `{{{…}}}` nesting, extglob nesting (`+(+(+(…)))` beyond `maxExtglobRecursion` degrades to literal, never hangs), long `**/**/…` chains, `parseCommaParts` deep post-chains — each malformed input fails through `GlobPatternError` with the right `reason`, never a stack overflow, OOM or hang; plus the NaN/non-integer internal-cap defect guards.

## Build and scaffold

Per [package-setup.md](../package-setup.md): copy a pure sibling (jsonc) into `packages/glob`, with model paths `../../website/lib/models/glob` in `turbo.json` outputs and `savvy.build.ts` `localPaths`, and `repository.directory: packages/glob`. `GlobPattern`, `GlobSet` and `GlobPatternError` are class factories, so unlike walker this package **does** need the narrow `_base` suppression in `savvy.build.ts` per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). devDependencies add `minimatch` (the oracle). No `prepare` script needed — glob has no `workspace:*` deps; it is a pure leaf.

## Consumer impact: the workspaces port (forward-looking)

When `@effected/workspaces` lands:

- `WorkspacePackage.matchesDependency` re-expresses over `GlobPattern`, dropping the `minimatch` runtime dep.
- The `packages:` enumerator re-expresses over `GlobSet`: `literals` fast-path, `wildcards` drive `readDirectory` from `enumerationPrefix` and `crossesSegments` triggers the bounded recursive descent — fixing #62 end to end.
- `sync.ts`'s hand-rolled third semantic is deleted in favour of the same `GlobSet`.
- At-ref discovery (`PointInTimeWorkspaceLive`) uses the same compiled set against `git ls-tree` entries.

Glob itself does **no** enumeration — pure string→predicate only. That boundary is load-bearing.

## As built (2026-07-09)

The port merged with 139 tests (a 130-row compliance table asserting expected outcome AND oracle agreement per row, four oracle property tests against the exact-pinned minimatch 10.2.5 devDependency, a hostile-input suite) and a zero-warning `issues.json` whose suppressed bucket holds only the four synthesized `_base` symbols. Four as-built notes against the design above:

1. **Budget exhaustion is a typed error, not upstream's silent truncation — a second behavioral deviation.** Upstream `expand_` silently truncates the expansion list at `max` and matches against the truncated set; silent truncation silently changes match semantics, and the `ExpansionBudgetExceeded` reason this design mandates is unreachable under it. The port throws the guard signal instead. The "only one deviation" claim in the headline section is qualified accordingly.
2. **`braceExpandMax` is schema-bounded `[1, 100_000]`**, tighter than the "positive integers" this design specified. Rationale: a `GlobPattern` value is pinned as *always defaults-compilable* (the schema check), and `compile` first validates under the effective options; bounding the one cap that can produce a compile-time typed failure above by the stock budget means permissive options can never admit a pattern the defaults check would reject, so `compile` never faces a make-time throw it cannot type. `maxGlobstarRecursion`/`maxExtglobRecursion` stay bare positive integers (neither produces a compile-time typed failure: globstar is a match-time false negative, extglob over-nesting degrades).
3. **Upstream security finding, and why the `#parseAST` backstop exists.** Stock minimatch 10.2.5 **stack-overflows with `RangeError` at default options** on `"@(".repeat(20000) + "a" + ")".repeat(20000)` — roughly 60KB, under its own 64KB pattern cap (verified against the real package, 2026-07-09). Upstream's `extDepth` counter adds `depthAdd = 0` when a nested extglob is coalescible (adoption), so adoption chains recurse unboundedly. The vendored `ast.ts` adds a structural depth backstop counting **every** descent, capped at `MAX_NESTING_DEPTH`, failing typed. This is design-relevant provenance: the engine survey's "eight recursion surfaces" list treated `#parseAST` as guarded by `maxExtglobRecursion`; it is not, on the adoption path.
4. **Test layout**: four engine-level test files (`braceExpansion`, `engine`, `compliance`, `hostility`) exist beyond the two public-surface files sketched in [Testing](#testing) — the jsonc/yaml multi-file precedent, required so the compliance gate could run against the raw engine before the facade existed. A `types.ts` engine leaf also exists beyond the module sketch: upstream let `ast.ts` and `index.ts` import each other's types circularly, which `noImportCycles` forbids.

The two OPEN items above (enumerator metadata validation; `matchBase`/win32 metadata interaction) remain open for the workspaces port.
