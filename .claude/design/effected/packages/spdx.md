---
status: draft
module: effected
category: architecture
created: 2026-07-22
updated: 2026-07-22
last-synced: 2026-07-22
completeness: 45
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../formatter-convention.md
  - ../migration-playbook.md
  - package-json.md
  - semver.md
---

# @effected/spdx design

## Overview

`@effected/spdx` is SPDX license expressions as Effect Schema classes: parse, validate and model the SPDX expression grammar, all pure. It follows [the semver north star](semver.md) — a strict-grammar package whose class IS the schema, with a catalog held as static data on its owning class — not the format-package parse/edit/format shape of [`@effected/yaml`](yaml.md) or [`@effected/jsonc`](jsonc.md).

It exists to remove the kit's **one remaining foreign runtime dependency**. [`@effected/package-json`](package-json.md) imports `spdx-expression-parse` at runtime to validate the `license` field, and that single CJS edge is the only thing holding package-json at integrated tier ([per R1](../effect-standards.md#dependency-policy)). Vendoring SPDX into a dedicated pure package — an owned engine per the kit's [engine-origin policy](../effect-standards.md#dependency-policy) — lets package-json drop that edge and fall back to boundary tier. This is the same move `@effected/toml` and `@effected/glob` made: vendoring *is* the wrapper.

## Tier and dependencies

**Pure tier** under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): no IO, no services, no layers, no `R`. All inputs are strings, all outputs are values or typed errors. `peerDependencies: { effect }` only, `dependencies: {}` and `"sideEffects": false`.

No cross-`@effected` runtime edges: package-json depends on spdx (`workspace:~`), never the reverse, and the graph runs from boundary toward pure as [the acyclic-graph rule](../effect-standards.md#cross-effected-dependencies) requires.

The `devDependencies` are build/test-only and never runtime:

- `spdx-license-ids` (CC0-1.0) and `spdx-exceptions` (CC-BY-3.0) — the upstream datasets, consumed only by the regeneration tool.
- `spdx-expression-parse` (MIT, ~277 LOC scanner + parser, the canonical package) — kept as a [differential-oracle](#testing) test target and as the algorithm reference for the port, never a runtime edge.
- `oxc-parser` — used by the regeneration tool to rewrite data literals by byte span.
- the standard toolchain: `@savvy-web/bundler`, `@effect/vitest`, `typescript`, `@types/node`.

## Module layout

Module-per-concept per the [standard](../effect-standards.md#module-layout-module-per-concept); `index.ts` re-exports only, every other module imports explicitly:

- `src/License.ts` — the `License` class and `InvalidSpdxExpressionError` (shared across the surface); owns the static license catalog.
- `src/LicenseException.ts` — the `LicenseException` class and its static exception catalog.
- `src/SpdxExpression.ts` — the recursive expression AST, `SpdxExpression.FromString`, `parse` and the sync validators.
- `src/internal/licenseIds.ts`, `src/internal/exceptions.ts` — the vendored datasets as hand-authored TypeScript, backing the class statics.

## Public API

Class-based throughout, per the semver north star: the class IS the schema, no `*Schema` suffixes.

### License

A single `Schema.Class` carrying `id` and `deprecated`. It owns a **static catalog** — a map of valid and deprecated SPDX license identifiers held as static data on the class, co-located with its domain the way `@effected/semver` co-locates its tables. Construction is via `License.make`, which validates the id against that static catalog or against the `LicenseRef-` / `DocumentRef-` pattern.

One class with a static map is the deliberate choice over per-license classes or a bare `Set<string>`: it is simple and cheap, it gives consumers real typed domain objects rather than raw strings, and it keeps the catalog next to the concept it describes.

### LicenseException

The same pattern for the SPDX exception identifiers — a `Schema.Class` with `id` and `deprecated`, owning its own static valid/deprecated catalog and validating on `make`.

### SpdxExpression

A recursive tagged AST modeling the SPDX expression grammar. The variants are `License {id, plus}`, `LicenseRef {documentRef?, ref}`, `WithException {license, exception}`, `And {left, right}` and `Or {left, right}`, with the recursion expressed via `Schema.suspend`. It provides `SpdxExpression.FromString` (a `Schema.decodeTo` codec from `Schema.String` to the AST), an Effect `parse` and a canonical `.toString()` — one grammar as the single source of truth, yielding round-tripping and `Schema.toArbitrary` derivation.

The exact field layout is **deliberately left open** for the implementation plan, to be pinned against the installed effect beta: whether the AST `License` leaf unifies with the catalog `License` class or stays a distinct node, and precisely where `plus` (the trailing `+` "or-later" marker) lives. These are open implementation details, not settled decisions.

### The sync primitive

Per the kit's [sync-primitive policy](../formatter-convention.md#decision-6--the-sync-primitive-policy), this pure boundary exposes a **sync `Result` primitive** alongside its Effect form — a `Result`-returning validate and/or an `isValidExpression(s): boolean`, with the Effect `parse` derived from the sync form behind its span so the two cannot drift. Synchronous consumers (lint hooks, non-Effect callers) need the sync form; package-json's own license validation is one such caller.

## Error set

The single typed error is `InvalidSpdxExpressionError`, a `Schema.TaggedErrorClass` in `License.ts`. Both malformed grammar and an unknown identifier fail through it as a typed `E`-channel failure — **never a defect**. That is the [input-hardening invariant](../effect-standards.md#input-hardening-standards) applied to this grammar: a parser that dies on hostile input violates "malformed input fails typed", so recursive descent over the expression AST is capped and surfaces the overflow as this error rather than a `RangeError`.

## Vendored data and regeneration

The license-id and exception sets are vendored as **real TypeScript** in hand-authored internal modules, split across `licenseIds.ts` and `exceptions.ts` so a consumer touching only exceptions never pulls the license set — genuine tree-shaking, which a single `JSON.parse("…")` string blob would defeat. Each module carries an attribution header naming the SPDX source and the upstream license (CC0-1.0 for the ids, CC-BY-3.0 for the exceptions). The dataset sizes are worth recording: `spdx-license-ids` ships 695 active plus 26 deprecated ids (~11KB) and `spdx-exceptions` ships 66 exceptions (~1.7KB); both change infrequently.

A **hand-run regeneration tool** keeps them current — a devDep script run manually, never in CI and never in the test suite, on the same posture as `@effected/markdown`'s entities generator. It reads the upstream `spdx-license-ids` / `spdx-exceptions` JSON and uses `oxc-parser` (`parseSync`, walk the ESTree, splice by byte `start`/`end` span) to replace **only** each data literal's contents in place, leaving the module header, types and any co-located hand-authored code untouched. Re-run and diff when the upstream data packages bump.

A load-cost tradeoff is worth recording: because `make` validates on construction (v4 semantics), building the catalog re-validates the ~721 known-good entries at module load. Default to `make` for correctness; an unchecked fast-path exists if that cost ever matters, since the data is canonical by construction — but do not optimize preemptively.

## Impact on @effected/package-json

Documented here as a cross-reference; [the package-json doc](package-json.md) is updated separately when this is implemented.

`src/License.ts` in package-json drops the `spdx-expression-parse` runtime dependency and its ambient `src/spdx-expression-parse.d.ts` shim, importing `@effected/spdx` via `workspace:~` instead. It **keeps** its npm-specific special cases (`UNLICENSED`, `SEE LICENSE IN <file>`) — those are npm semantics, not SPDX — and delegates only core SPDX-expression validity to this package.

**package-json's tier drops from integrated to boundary.** The `workspace:~` edge to a pure package does not re-lift it, exactly as its existing `@effected/npm` and `@effected/semver` edges do not ([R2 propagates only tier-3](../effect-standards.md#dependency-policy)); its file IO in `PackageJsonFile.ts` keeps it at boundary.

## Release gate

This makes the kit **19 publishable packages**. The package follows the [migration playbook](../migration-playbook.md) — design doc first, then port — and ships with the kit at `0.1.0`, on the [release gate](../releases.md), not an exception.

## Testing

`@effect/vitest` with `it.effect` the default mode, `assert.*` and never `expect`; tests in `packages/spdx/__test__/`.

- A **differential-oracle** conformance harness runs the validator and parser against `spdx-expression-parse` across the full identifier set and an expression corpus, asserting agreement — the same posture as `@effected/glob`'s minimatch oracle and `@effected/toml`'s `smol-toml` oracle. If the engine disagrees with the oracle, fix the engine.
- Unit tests plus the mutate-the-edges discipline: malformed grammar, unknown ids, the `+` marker, `WITH` exceptions, `AND`/`OR` precedence and `LicenseRef` / `DocumentRef` forms all fail or parse as specified.
- Property tests via `it.effect.prop` with `Schema.toArbitrary`, asserting `FromString` round-trips.
