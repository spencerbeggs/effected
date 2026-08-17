---
status: current
module: effected
category: architecture
created: 2026-07-22
updated: 2026-08-17
last-synced: 2026-08-17
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../formatter-convention.md
  - package-json.md
  - semver.md
  - markdown.md
---

# @effected/spdx design

## Overview

`@effected/spdx` is SPDX license identifiers, exceptions and license expressions as Effect Schema classes: parse, validate and model the SPDX grammar, all pure. It follows [the semver north star](semver.md) — a strict-grammar package whose class IS the schema, with a catalog held as static data on its owning class — rather than the parse/edit/format shape of the format packages.

Owning the grammar rather than depending on `spdx-expression-parse` is what keeps [`@effected/package-json`](package-json.md) free of a foreign CJS runtime edge, and therefore at boundary tier. That is the same move [toml](toml.md) and [glob](glob.md) made: under the kit's [engine-origin policy](../effect-standards.md#dependency-policy), vendoring *is* the wrapper.

## Tier and dependencies

**Pure tier** under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): no IO, no services, no layers, no `R`. All inputs are strings, all outputs are values or typed errors. `effect` is the only peer, `dependencies` is empty and `"sideEffects": false`.

No cross-`@effected` runtime edges: package-json depends on spdx, never the reverse, and the graph runs from boundary toward pure as [the acyclic-graph rule](../effect-standards.md#cross-effected-dependencies) requires.

Everything SPDX-adjacent — the upstream `spdx-license-ids` and `spdx-exceptions` datasets, the canonical `spdx-expression-parse` (kept as the [differential oracle](#testing) and as the algorithm reference), and the parser used by the regeneration tool — is a **devDependency only**. Never import any of them from `src/**`.

## Module layout

Module-per-concept per the [standard](../effect-standards.md#module-layout-module-per-concept); `index.ts` re-exports only.

- `src/License.ts` — the `License` class, owning the static license catalog, plus `InvalidSpdxExpressionError` (shared across the surface).
- `src/LicenseException.ts` — `LicenseException` and its own static exception catalog.
- `src/SpdxExpression.ts` — the recursive expression AST, its `FromString` codec, `parse` and the sync validator.
- `src/internal/` — the vendored datasets as hand-authored TypeScript, and the parser.

## Public API

Class-based throughout, per the semver north star: the class IS the schema, no `*Schema` suffixes.

**`License` and `LicenseException`** are each a single `Schema.Class` carrying an id and a deprecation flag, owning a **static catalog** of the valid and deprecated identifiers — co-located with the domain the way semver co-locates its tables. One class with a static catalog is the deliberate choice over per-license classes or a bare `Set<string>`: it is simple and cheap, it hands consumers real typed domain objects rather than raw strings, and it keeps the catalog next to the concept it describes.

The validating constructors are `parse` (Effect) and `parseResult` (Result) — **not `make`**, which `Schema.Class` reserves for its own unvalidated raw constructor. An `of(...)` construct-from-parts helper mirrors [`SemVer.of`](semver.md), and static predicates answer catalog and grammar questions without constructing anything. Validation checks an id against the static catalog or against the `LicenseRef-` / `DocumentRef-` pattern.

**Deprecated ids are valid but flagged.** They parse successfully and carry the deprecation marker; they are never rejected.

**`SpdxExpression`** is a recursive tagged-union AST over the grammar, with each variant a separate node class and the recursion expressed via `Schema.suspend`. It provides a `FromString` codec, an Effect `parse`, a sync validity predicate and a canonical fully-parenthesized `toString` — one grammar as the single source of truth, so parse and encode round-trip.

The AST's license node is deliberately **distinct from the catalog `License` class**: it carries the grammar's trailing-`+` "or later" marker, which a catalog entry has no place for.

**`WITH` binds to a *simple expression*, and a reference is one.** The SPDX ABNF reads `simple-expression = license-id / license-id"+" / license-ref` and `with-expression = simple-expression "WITH" license-exception-id`, so `LicenseRef-Foo WITH Bison-exception-2.2` and `DocumentRef-spdx-tool-1.2:LicenseRef-MIT-Style-2 WITH Classpath-exception-2.0` are both grammatical. The exception node's license field is therefore a **union of the license node and the reference node**, not the license node alone — the earlier "`WITH` never binds to a reference" reading was wrong, and [the oracle proved it](#testing). Two neighbouring rules are deliberately *not* symmetric with this widening:

- The exception must still be a **cataloged** exception id — `LicenseRef-Foo WITH Bogus-exception` is rejected, exactly as the cataloged-id form is.
- **Only a cataloged id may carry `+`.** A `+` after a reference is left unconsumed and dies on the trailing-token check, so `LicenseRef-Foo+` is rejected — the ABNF puts the `+` on `license-id`, never on `license-ref`, and the oracle agrees.

The engine expresses this by parsing all three simple-license forms — `DocumentRef:LicenseRef`, bare `LicenseRef`, cataloged id with optional `+` — into **one internal leaf**, then applying a **single** `WITH <known exception>` check to whichever it produced. That shared tail is the invariant to preserve: three per-branch `WITH` checks is how the reference forms drifted from the id form in the first place.

The `SpdxExpression` facade is an `as const` object, **not a static class**, and this is a recorded holdout from the kit's static-class-conversion sweep rather than an oversight: the AST union already claims that name as a type alias, and a type alias cannot merge with a class — only an interface can — so `export class SpdxExpression` would be a duplicate-identifier error ([the container rule](../effect-standards.md#a-sanctioned-grouped-statics-container-is-a-static-class-not-an-as-const-object)). The cost is that the facade's member TSDoc is exposed to the `as const` inference loss in the built `.d.ts`.

## The sync primitive

Per the kit's [sync-primitive policy](../sync-primitive-policy.md), this pure boundary exposes a **sync `Result` primitive** alongside its Effect form, with the Effect form derived from the sync one behind its span so the two cannot drift. Synchronous consumers — lint hooks, non-Effect callers — need the sync form, and package-json's own license validation reaches for the sync expression predicate.

## Error set

The single typed error is `InvalidSpdxExpressionError`. Both malformed grammar and an unknown identifier fail through it on the `E` channel — **never as a defect**. That is the [input-hardening invariant](../effect-standards.md#input-hardening-standards) applied to this grammar: recursive descent over the expression AST is depth-capped and surfaces the overflow as that error rather than a `RangeError`.

## Vendored data and regeneration

The license-id and exception sets are vendored as **real TypeScript** in hand-authored internal modules, split so a consumer touching only exceptions never pulls the license set — genuine tree-shaking, which a single `JSON.parse("…")` blob would defeat. Each module carries an attribution header naming the SPDX source and its upstream license.

A **hand-run regeneration tool** in `scripts/` keeps them current: a devDep script run manually, never in CI and never in the test suite, on the same posture as [markdown's entities generator](markdown.md#the-entity-table-is-generated-data-not-a-dependency). It reads the upstream JSON and rewrites **only** each data literal's contents in place by byte span, leaving module headers, types and co-located hand-authored code untouched. It is idempotent — re-run and diff when the upstream data packages bump.

Catalog construction carries no load-cost penalty: the catalog is built through `Schema.Class`'s reserved raw constructor, which does **not** validate, since the vendored data is canonical by construction. Validation cost falls only on user input, never on the known-good catalog at module load.

## Consumer contract

[`@effected/package-json`](package-json.md) delegates **core SPDX expression validity** to this package and nothing more. It keeps its npm-specific special cases — `UNLICENSED` and `SEE LICENSE IN <file>` — because those are npm semantics, not SPDX.

The `workspace:^` edge does not lift package-json's tier: [R2 propagates only tier-3](../effect-standards.md#dependency-policy), so an edge to a pure package leaves it at boundary, exactly as its semver and npm edges do.

## Testing

`@effect/vitest` with `it.effect` the default mode, `assert.*` and never `expect`; tests in `packages/spdx/__test__/`.

- A **differential-oracle** conformance harness runs the validator and parser against `spdx-expression-parse` over the full id set and an expression corpus — the same posture as glob's minimatch oracle and toml's smol-toml oracle. If the engine disagrees with the oracle, **fix the engine**. A test-only ambient shim types that dependency.
  - **That rule has been exercised, and it moved the public surface.** Bumping the oracle to `spdx-expression-parse` 5 surfaced `LicenseRef-… WITH …` as an accept the engine rejected. The oracle was not pinned back and the case was not excluded: the engine was fixed and [the exception node's license field widened](#public-api). The general lesson is that **an oracle bump is a grammar review, not a version bump** — probe the new oracle's answers for the forms around the change (a reference with `WITH`, a document-ref with `WITH`, an unknown exception, a reference with `+`) and let the corpus record each answer, so the next reader sees which are accepts and which are rejects.
- Unit tests apply the mutate-the-edges discipline across malformed grammar, unknown ids, the `+` marker, `WITH` exceptions, `AND`/`OR` precedence and the ref forms.
- A round-trip property test builds its FastCheck arbitrary over the known SPDX id set rather than using raw `Schema.toArbitrary`: the AST's bare-`Schema.String` leaves make derivation emit ungrammatical identifiers, so the arbitrary composes grammatical expressions instead.
