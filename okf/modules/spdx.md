---
type: Module
title: "@effected/spdx"
description: SPDX license identifiers, exceptions and license expressions modeled as pure Effect Schema classes, owning the grammar rather than depending on a parser package.
status: stable
kind: package
resource: ../../packages/spdx
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: 78dfea390eda0a86b051d3f9570ee8b8bc7636bcdc724617eb19fe248d49a410
---

# @effected/spdx

`@effected/spdx` is SPDX license identifiers, exceptions and license
expressions as Effect Schema classes: parse, validate and model the SPDX
grammar, all pure. It follows the semver north star — a strict-grammar
package whose class *is* the schema, with a catalog held as static data on
its owning class — rather than the parse/edit/format shape of the kit's
format packages.

Owning the grammar rather than depending on `spdx-expression-parse` is what
keeps `@effected/package-json` free of a foreign CJS runtime edge, and
therefore at boundary tier. That is the same move `@effected/toml` and
`@effected/glob` made: vendoring a grammar *is* the wrapper, under the
kit's dependency policy.

## Tier and dependencies

Pure tier, per [the tier taxonomy](../glossary/library-tier.md): no IO, no
services, no layers, no `R`. All inputs are strings, all outputs are values
or typed errors. `effect` is the only peer, `dependencies` is empty and
`"sideEffects": false`.

No cross-`@effected` runtime edges: `@effected/package-json` depends on
`spdx`, never the reverse, running from boundary toward pure as the kit's
[dependency policy](../conventions/dependency-policy.md) requires. See [why
package-json delegates to spdx](../decisions/spdx-delegation.md).

Everything SPDX-adjacent — the upstream `spdx-license-ids` and
`spdx-exceptions` datasets, the canonical `spdx-expression-parse` (kept as
the differential oracle and as the algorithm reference) and the parser used
by the regeneration tool — is a **devDependency only**. Never import any of
them from `src/**`. The same holds for `lib/data/spdx-licenses.json`, the
committed catalog behind the metadata table: it is a build-time input to the
generator and nothing else. See [the generator input
convention](../conventions/generator-input-is-a-committed-file.md).

## Module layout

Module-per-concept; `src/index.ts` re-exports only.

- `src/License.ts` — the `License` class, owning the static license catalog
  and its derived metadata getters, plus `InvalidSpdxExpressionError`
  (shared across the surface).
- `src/LicenseException.ts` — `LicenseException` and its own static
  exception catalog.
- `src/SpdxExpression.ts` — the recursive expression AST, its `FromString`
  codec, `parse`, the sync validator and the two license accessors.
- `src/internal/` — the vendored datasets as hand-authored or generated
  TypeScript, and the parser. `licenseIds.ts` and `exceptions.ts` are the
  identifier sets; `licenseMeta.ts` is the generated metadata table.

## Public API

Class-based throughout: the class *is* the schema, no `*Schema` suffixes.

`License` and `LicenseException` are each a single `Schema.Class` carrying
an id and a deprecation flag, owning a **static catalog** of the valid and
deprecated identifiers, co-located with the domain. One class with a static
catalog is the deliberate choice over per-license classes or a bare
`Set<string>`: it is simple and cheap, it hands consumers real typed domain
objects rather than raw strings, and it keeps the catalog next to the
concept it describes.

The string-parsing constructors are `parse` (Effect) and `parseResult`
(Result) — not `make`, which `Schema.Class` already owns. An `of(...)`
construct-from-parts helper mirrors `SemVer.of`, and static predicates
answer catalog and grammar questions without constructing anything. Parsing
checks an id against the static catalog or against the `LicenseRef-` /
`DocumentRef-` pattern.

This does not contradict the kit's `X.make(...)`, never `new X(...)` rule —
`make` remains the fields constructor (`License.make({ id, deprecated })`
is exactly how the catalog is built), and reading either statement alone
makes it look like it does. What `make` cannot be is a **string parser**:
it takes the field record, not the encoded form, and applies only
field-level schema checks (`id` is `Schema.String`, with no catalog check
attached), so it will happily construct
`License.make({ id: "Not-A-License", deprecated: false })`. Catalog
membership is not a field-level constraint, so a string form needs a
second, differently-named entry point — `parse`/`parseResult`. Deprecated
ids are valid but flagged: they parse successfully and carry the
deprecation marker, and are never rejected.

### Catalog metadata

`License` carries four derived getters over a generated metadata table —
`referenceUrl`, `name`, `osiApproved` and `fsfLibre` (`src/License.ts`).
They exist because a downstream consumer rendering a license needs a title
and a link, and the alternative is every consumer re-deriving both from the
id, badly.

Four rulings hold this surface together, and each is the safe answer
rather than the convenient one:

- **Absence is `Option.none()`, not a fabricated value.** `referenceUrl`
  and `name` are `Option`, because a `LicenseRef-`/`DocumentRef-` reference
  names a license that lives in the consuming document rather than on
  spdx.org, and an uncataloged id names nothing at all. Templating a URL
  anyway would hand a caller a confidently broken link, which is worse than
  no link.
- **The flags are plain `boolean` and default to `false`.** They assert
  something about a *known* license, so the absence of a catalog entry is
  never "approved".
- **`osiApproved` and `fsfLibre` are independent and neither may be derived
  from the other.** The FSF's list is much shorter than the OSI's and the
  two disagree in **both** directions — `0BSD` is OSI-approved and not
  FSF-libre, `Apache-1.0` is FSF-libre and not OSI-approved.
- **`reference` is not vendored; it is templated, and the template is a
  checked invariant.** Every upstream entry's URL is exactly
  `https://spdx.org/licenses/<id>.html`, so shipping every one would be
  hundreds of copies of a format string. The generator asserts the
  template against upstream for every id and fails loudly on any
  deviation. Never relax that assertion to make a regeneration pass — a
  deviation means upstream changed the URL shape, and the answer is to
  vendor the field.

The table itself is `[id, name, flags]` tuples, one per id in the
`licenseIds.ts` catalog — 734 ids. Objects would repeat three keys per
entry for no information: roughly 20 KB saved by not doing so. Never
"tidy" them into objects.

### Reading licenses out of an expression

Two accessors on the `SpdxExpression` facade
(`src/SpdxExpression.ts:311,351`) answer "which license(s) is this under",
and the pair is the point — neither is complete alone.

- **`licensesOf(expr): ReadonlyArray<License>`** — every license the
  expression names, in written order, de-duplicated by identifier keeping
  first appearance. Reach for it wherever a target permits more than one
  license.
- **`primaryLicense(expr): Option<License>`** — the single license an
  expression can be said to be under, when there is one. A simple license,
  or one with an exception, yields that license; `OR` yields the leftmost,
  the choice the author wrote first and npm's convention treats as
  preferred; `AND` yields `Option.none()`. See [the conjunction
  decision](../decisions/spdx-primary-license-declines-conjunction.md).

`WITH` is handled by carrying the license and dropping the exception, in
both accessors: the exception qualifies a license rather than naming a
different one. The `+` "or later" marker is dropped for the same reason —
`License` models identifiers, not operators.

An accessor that declines to collapse does not stop a caller collapsing
downstream: a consumer that maps `licensesOf(...)` to a bare `string[]` of
ids discards the `License` entries, so only the primary's `referenceUrl`
survives — and a dual-licensed (`AND`) package then emits no license at
all, since an `AND` has no primary. The entries are the payload:
`licensesOf` returns `License` objects rather than ids precisely so
per-entry metadata travels with them.

`SpdxExpression` is a recursive tagged-union AST over the grammar, with each
variant a separate node class and the recursion expressed via
`Schema.suspend`. It provides a `FromString` codec, an Effect `parse`, a
sync validity predicate and a canonical fully-parenthesized `toString` —
one grammar as the single source of truth, so parse and encode round-trip.
The AST's license node is deliberately distinct from the catalog `License`
class: it carries the grammar's trailing-`+` "or later" marker, which a
catalog entry has no place for.

**`WITH` binds to a *simple expression*, and a reference is one.** The SPDX
ABNF reads `simple-expression = license-id / license-id"+" / license-ref`
and `with-expression = simple-expression "WITH" license-exception-id`, so
`LicenseRef-Foo WITH Bison-exception-2.2` and
`DocumentRef-spdx-tool-1.2:LicenseRef-MIT-Style-2 WITH Classpath-exception-2.0`
are both grammatical. The exception node's license field is therefore a
union of the license node and the reference node, not the license node
alone. Two neighbouring rules are deliberately not symmetric with this
widening: the exception must still be a cataloged exception id
(`LicenseRef-Foo WITH Bogus-exception` is rejected), and only a cataloged
id may carry `+` (`LicenseRef-Foo+` is rejected, since the ABNF puts `+` on
`license-id`, never on `license-ref`).

The engine parses all three simple-license forms — `DocumentRef:LicenseRef`,
bare `LicenseRef`, cataloged id with optional `+` — into one internal leaf,
then applies a single `WITH <known exception>` check to whichever it
produced. That shared tail is the invariant to preserve: three per-branch
`WITH` checks is how the reference forms drifted from the id form in the
first place.

The `SpdxExpression` facade is an `as const` object, not a static class —
a recorded holdout from the kit's static-class-conversion sweep rather than
an oversight: the AST union already claims that name as a type alias, and a
type alias cannot merge with a class (only an interface can), so
`export class SpdxExpression` would be a duplicate-identifier error. The
cost is that the facade's member TSDoc is exposed to the `as const`
inference loss in the built `.d.ts`.

## The sync primitive

Per the kit's [sync-primitive policy](../conventions/sync-primitive-policy.md),
this pure boundary exposes a sync `Result` primitive alongside its Effect
form, with the Effect form derived from the sync one behind its span so the
two cannot drift. Synchronous consumers — lint hooks, non-Effect callers —
need the sync form, and `@effected/package-json`'s own license validation
reaches for the sync expression predicate.

## Error set

The single typed error is `InvalidSpdxExpressionError`. Both malformed
grammar and an unknown identifier fail through it on the `E` channel,
never as a defect — the kit's input-hardening invariant applied to this
grammar: recursive descent over the expression AST is depth-capped and
surfaces the overflow as that error rather than a `RangeError`.

## Vendored data and regeneration

The license-id and exception sets are vendored as real TypeScript in
hand-authored internal modules, split so a consumer touching only
exceptions never pulls the license set — genuine tree-shaking, which a
single `JSON.parse("…")` blob would defeat. Each module carries an
attribution header naming the SPDX source and its upstream license.

A hand-run regeneration tool, `lib/scripts/generate-data.ts`, keeps them
current: a devDep script run manually, never in CI and never in the test
suite. It rewrites only each data literal's contents in place by byte span,
leaving module headers, types and co-located hand-authored code untouched.
It is idempotent — re-run and diff when the upstream data bumps. Full
mechanics, provenance and the refresh obligation are in [the license-data
model](../models/spdx-license-data.md) and [the regeneration
runbook](../runbooks/regenerate-spdx-data.md).

Catalog construction carries no meaningful load-cost penalty: the catalog
is built through `License.make`, which applies only the field-level schema
checks and performs no catalog lookup or grammar parse, since the vendored
data is canonical by construction. Parse cost falls only on user input,
never on the known-good catalog at module load.

## Consumer contract

`@effected/package-json` delegates core SPDX expression validity to this
package and nothing more. It keeps its npm-specific special cases —
`UNLICENSED` and `SEE LICENSE IN <file>` — because those are npm semantics,
not SPDX. The `workspace:^` edge does not lift package-json's tier: an edge
to a pure package leaves the boundary-tier consumer at boundary, exactly as
its semver and npm edges do.

## Testing

`@effect/vitest` with `it.effect` the default mode, `assert.*` and never
`expect`; tests in `packages/spdx/__test__/`.

- A **differential-oracle** conformance harness runs the validator and
  parser against `spdx-expression-parse` over the full id set and an
  expression corpus — the same posture as `glob`'s minimatch oracle and
  `toml`'s smol-toml oracle. If the engine disagrees with the oracle, fix
  the engine. A test-only ambient shim types that dependency.
  - An oracle bump is a grammar review, not a version bump. The rule has
    already moved the public surface once — a bump surfaced
    `LicenseRef-… WITH …` as an accept the engine rejected, and the
    exception node's license field widened rather than the oracle being
    pinned back or the case excluded. Probe the new oracle's answers for
    the forms around any change (a reference with `WITH`, a document-ref
    with `WITH`, an unknown exception, a reference with `+`) and let the
    corpus record each answer.
- Unit tests apply the mutate-the-edges discipline across malformed
  grammar, unknown ids, the `+` marker, `WITH` exceptions, `AND`/`OR`
  precedence and the ref forms.
- A round-trip property test builds its FastCheck arbitrary over the known
  SPDX id set rather than using raw `Schema.toArbitrary`: the AST's
  bare-`Schema.String` leaves make derivation emit ungrammatical
  identifiers, so the arbitrary composes grammatical expressions instead.
