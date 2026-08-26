---
status: current
module: effected
category: architecture
created: 2026-07-22
updated: 2026-08-26
last-synced: 2026-08-26
completeness: 95
related:
  - schema-org.md
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

Everything SPDX-adjacent — the upstream `spdx-license-ids` and `spdx-exceptions` datasets, the canonical `spdx-expression-parse` (kept as the [differential oracle](#testing) and as the algorithm reference), and the parser used by the regeneration tool — is a **devDependency only**. Never import any of them from `src/**`. The same holds for `lib/data/spdx-licenses.json`, the committed catalog behind the [metadata table](#catalog-metadata): it is a **build-time input to the generator and nothing else**, and it carries a [refresh obligation](#the-generator-has-two-sources-and-only-one-of-them-is-a-package).

## Module layout

Module-per-concept per the [standard](../effect-standards.md#module-layout-module-per-concept); `index.ts` re-exports only.

- `src/License.ts` — the `License` class, owning the static license catalog and its [metadata getters](#catalog-metadata), plus `InvalidSpdxExpressionError` (shared across the surface).
- `src/LicenseException.ts` — `LicenseException` and its own static exception catalog.
- `src/SpdxExpression.ts` — the recursive expression AST, its `FromString` codec, `parse`, the sync validator and the [two license accessors](#reading-licenses-out-of-an-expression).
- `src/internal/` — the vendored datasets as hand-authored or generated TypeScript, and the parser. `licenseIds.ts` and `licenseExceptions.ts` are the identifier sets; `licenseMeta.ts` is the generated metadata table.

## Public API

Class-based throughout, per the semver north star: the class IS the schema, no `*Schema` suffixes.

**`License` and `LicenseException`** are each a single `Schema.Class` carrying an id and a deprecation flag, owning a **static catalog** of the valid and deprecated identifiers — co-located with the domain the way semver co-locates its tables. One class with a static catalog is the deliberate choice over per-license classes or a bare `Set<string>`: it is simple and cheap, it hands consumers real typed domain objects rather than raw strings, and it keeps the catalog next to the concept it describes.

The **string-parsing** constructors are `parse` (Effect) and `parseResult` (Result) — **not `make`**, which `Schema.Class` already owns. An `of(...)` construct-from-parts helper mirrors [`SemVer.of`](semver.md), and static predicates answer catalog and grammar questions without constructing anything. Parsing checks an id against the static catalog or against the `LicenseRef-` / `DocumentRef-` pattern.

**This does not contradict the kit's [`X.make(...)`, never `new X(...)` rule](../effect-standards.md#schema-standards), and reading either statement alone will make it look as though it does.** The standard governs *how you construct a class from its fields*, and `make` remains that answer here — `License.make({ id, deprecated })` is exactly how the catalog is built. What `make` cannot be is a **string parser**: it takes the field record, not the encoded form, and it applies only the field-level schema checks (`id` is `Schema.String`, with no catalog check attached), so it will happily construct `License.make({ id: "Not-A-License", deprecated: false })`. Catalog membership is not a field-level constraint, and a package with a string form therefore needs a *second*, differently-named entry point for it. `parse`/`parseResult` are that name. The rule to carry away: **`make` is the fields constructor and stays so; a string form gets `parse`, never a redefined `make`.**

That is also why catalog construction carries no load-cost penalty — see [vendored data](#vendored-data-and-regeneration).

**Deprecated ids are valid but flagged.** They parse successfully and carry the deprecation marker; they are never rejected.

### Catalog metadata

`License` carries four **derived getters** over a generated metadata table — `referenceUrl`, `name`, `osiApproved` and `fsfLibre`. They exist because a downstream consumer rendering a license needs a title and a link, and the alternative is every consumer re-deriving both from the id, badly.

Four rulings hold this surface together, and each is the safe answer rather than the convenient one:

- **Absence is `Option.none()`, not a fabricated value.** `referenceUrl` and `name` are `Option`, because a `LicenseRef-`/`DocumentRef-` reference names a license that lives in the consuming document rather than on spdx.org, and an uncataloged id names nothing at all. Templating a URL anyway would hand a caller a *confidently broken link*, which is worse than no link.
- **The flags are plain `boolean` and default to `false`.** They assert something about a *known* license, so the absence of a catalog entry is never "approved". No `Option` here: an unknown license is not OSI-approved, and that is a complete answer rather than a missing one.
- **`osiApproved` and `fsfLibre` are independent and neither may be derived from the other.** The FSF's list is much shorter than the OSI's and the two disagree in **both** directions — `0BSD` is OSI-approved and not FSF-libre, `Apache-1.0` is FSF-libre and not OSI-approved. A reader who assumes containment will be wrong on real licenses.
- **`reference` is not vendored; it is templated, and the template is a checked invariant.** Every upstream entry's URL is exactly `https://spdx.org/licenses/<id>.html`, so shipping 721 of them would be 721 copies of a format string. The generator asserts the template against upstream for **every** id and fails loudly on any deviation, which is what converts an assumption into a checked one. Never relax that assertion to make a regeneration pass — a deviation means upstream changed the URL shape, and the answer is to vendor the field.

The table itself is `[id, name, flags]` **tuples**, 721 of them, matching the `licenseIds.ts` catalog exactly. Objects would repeat three keys 721 times for no information, at roughly 20 KB of shipped bytes — the same interning economics [`@effected/schema-org`](schema-org.md#what-ships-the-full-interned-table) reaches on a larger table.

### Reading licenses out of an expression

Two accessors on the `SpdxExpression` facade answer "which license(s) is this under", and the pair is the point — neither is complete alone.

- **`licensesOf(expr): ReadonlyArray<License>`** — every license the expression names, in **written order**, de-duplicated by identifier keeping first appearance. Reach for it wherever a target permits more than one license.
- **`primaryLicense(expr): Option<License>`** — the single license an expression can be said to be under, when there is one. A simple license, or one with an exception, yields that license; `OR` yields the **leftmost**, which is the choice the author wrote first and npm's convention treats as preferred; **`AND` yields `Option.none()`**.

**The `AND` `none` is the load-bearing decision, and it is a routing signal rather than an error.** A conjunction means every term binds at once, so no single license represents it, and picking one would silently drop a term that legally applies — a confidently wrong answer that looks perfectly fine. The call site is expected to carry both accessors and emit the array when there is no single primary. **Never "improve" `primaryLicense` to return the leftmost conjunct**: the `none` *is* the API.

`WITH` is handled by carrying the license and dropping the exception, in both accessors: the exception qualifies a license rather than naming a different one. The `+` "or later" marker is dropped for the same reason — `License` models identifiers, not operators.

This pair is now the house precedent for the general rule, adopted downstream by [`@effected/schema-org`](schema-org.md#the-house-precedent-never-pick-a-representative): **where collapsing many to one would lose information, decline rather than choose.**

**An accessor that declines to collapse does not stop a caller collapsing downstream, and the first consumer proved it.** They mapped `licensesOf(...)` to a bare `string[]` of ids, discarding the `License` entries — so the only [`referenceUrl`](#catalog-metadata) that survived was the primary's, and a dual-licensed (`AND`) package therefore emitted **no license at all**, since an `AND` has no primary. The kit's surface was correct at every step; the loss happened one level up, in the consumer's own intermediate type.

Two things worth carrying from it. The **entries are the payload** — `licensesOf` returns `License` objects rather than ids precisely so per-entry metadata travels with them, and a caller narrowing to ids re-creates the problem the pair exists to prevent; the TSDoc should keep saying so. And note what the consumer nearly did instead: they had drafted an ask for per-entry `referenceUrl`, which already existed, and caught it only by reading the installed `.d.ts` rather than trusting their belief about the boundary. **Read the artifact, not your memory of it** — the same discipline the [oracle rule](#testing) applies to upstream data.

**`SpdxExpression`** is a recursive tagged-union AST over the grammar, with each variant a separate node class and the recursion expressed via `Schema.suspend`. It provides a `FromString` codec, an Effect `parse`, a sync validity predicate and a canonical fully-parenthesized `toString` — one grammar as the single source of truth, so parse and encode round-trip.

The AST's license node is deliberately **distinct from the catalog `License` class**: it carries the grammar's trailing-`+` "or later" marker, which a catalog entry has no place for.

**`WITH` binds to a *simple expression*, and a reference is one.** The SPDX ABNF reads `simple-expression = license-id / license-id"+" / license-ref` and `with-expression = simple-expression "WITH" license-exception-id`, so `LicenseRef-Foo WITH Bison-exception-2.2` and `DocumentRef-spdx-tool-1.2:LicenseRef-MIT-Style-2 WITH Classpath-exception-2.0` are both grammatical. The exception node's license field is therefore a **union of the license node and the reference node**, not the license node alone; a reading under which `WITH` never binds to a reference is wrong, and [the oracle says so](#testing). Two neighbouring rules are deliberately *not* symmetric with this widening:

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

A **hand-run regeneration tool** in `scripts/` keeps them current: a devDep script run manually, never in CI and never in the test suite, on the same posture as [markdown's entities generator](markdown.md#the-entity-table-is-generated-data-not-a-dependency). It rewrites **only** each data literal's contents in place by byte span, leaving module headers, types and co-located hand-authored code untouched. It is idempotent — re-run and diff when the upstream data packages bump.

### The generator has two sources, and only one of them is a package

The identifier sets come from the `spdx-license-ids` / `spdx-exceptions` **devDependencies**. The [metadata table](#catalog-metadata) does not: `licenseMeta.ts` is generated from **`lib/data/spdx-licenses.json`**, the SPDX workgroup's own published catalog at release **v3.28.0**, committed into this package. It carries the titles and approval flags the npm packages do not.

It is a committed FILE rather than a vendored submodule, and that distinction cost a CI outage to learn. The upstream `spdx/license-list-data` repo is **1.86 GB**; the file read from it is **332 KB**. A sparse checkout makes that bearable locally, but sparse configuration lives in a submodule's own `.git/config` and does not travel — so every clone and every CI checkout paid the full history to reach a rounding error's worth of JSON, and validation went from ~6m45s to over 19 minutes. The rule that generalizes: **submodule a repo when a package needs to read the repo; commit the file when it needs one file.**

**That vendoring creates a re-pin obligation this package did not previously carry**, and it is recorded here because nothing else states it: under the silk `repos` skill's re-pin-on-dependency-bump rule, bumping `spdx-license-ids` now means **re-pinning the submodule tag as well**, and re-running the generator, and diffing — as one change. The two sources describe the same license list and must be advanced together; the version pinned in `.repos/config.json` and the version resolved for `spdx-license-ids` are two clocks that will silently diverge otherwise.

The safety net is real but is a net, not a substitute. The generator **asserts coverage**: every id in the catalog must resolve to a metadata entry, and every entry's `reference` must match the templated URL, and it fails loudly naming the offender rather than emitting a table with holes. So a forgotten re-pin surfaces at the next regeneration — which is the run that would otherwise ship a `name` of `Option.none()` for every id added since the pin. Nothing catches it *before* then, which is why the obligation is written down.

Everything under `.repos/` is **read-only** — silk's PreToolUse guards deny writes. The generator reads the submodule and writes only into `packages/spdx/src/internal/`. Reading it offline rather than fetching is what makes regeneration reproducible on any machine at any time.

Following the [oracle rule](#testing), an upstream bump here is likewise **a catalog review, not a version bump**: diff the regenerated literals and read what moved.

Catalog construction carries no meaningful load-cost penalty: the catalog is built through `License.make`, which applies only the field-level schema checks and performs **no catalog lookup or grammar parse**, since the vendored data is canonical by construction. Parse cost falls only on user input, never on the known-good catalog at module load.

## Consumer contract

[`@effected/package-json`](package-json.md) delegates **core SPDX expression validity** to this package and nothing more. It keeps its npm-specific special cases — `UNLICENSED` and `SEE LICENSE IN <file>` — because those are npm semantics, not SPDX.

The `workspace:^` edge does not lift package-json's tier: [R2 propagates only tier-3](../effect-standards.md#dependency-policy), so an edge to a pure package leaves it at boundary, exactly as its semver and npm edges do.

## Testing

`@effect/vitest` with `it.effect` the default mode, `assert.*` and never `expect`; tests in `packages/spdx/__test__/`.

- A **differential-oracle** conformance harness runs the validator and parser against `spdx-expression-parse` over the full id set and an expression corpus — the same posture as glob's minimatch oracle and toml's smol-toml oracle. If the engine disagrees with the oracle, **fix the engine**. A test-only ambient shim types that dependency.
  - **An oracle bump is a grammar review, not a version bump.** The rule has already moved the public surface once — a bump surfaced `LicenseRef-… WITH …` as an accept the engine rejected, and [the exception node's license field widened](#public-api) rather than the oracle being pinned back or the case excluded. Probe the new oracle's answers for the forms around any change (a reference with `WITH`, a document-ref with `WITH`, an unknown exception, a reference with `+`) and let the corpus record each answer, so the next reader sees which are accepts and which are rejects.
- Unit tests apply the mutate-the-edges discipline across malformed grammar, unknown ids, the `+` marker, `WITH` exceptions, `AND`/`OR` precedence and the ref forms.
- A round-trip property test builds its FastCheck arbitrary over the known SPDX id set rather than using raw `Schema.toArbitrary`: the AST's bare-`Schema.String` leaves make derivation emit ungrammatical identifiers, so the arbitrary composes grammatical expressions instead.
