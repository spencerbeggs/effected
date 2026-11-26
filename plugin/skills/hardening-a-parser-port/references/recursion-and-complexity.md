# Recursion surfaces and algorithmic complexity

The two denial-of-service vectors of a parser over untrusted text: the stack
(unbounded recursion) and time or memory (superlinear work on small input).
Depth caps close only the first.

## Enumerating recursion surfaces: a worked example

`@effected/jsonc` has an *iterative* scanner and a single-stage
recursive-descent parser, yet **six** independent surfaces, each of which
overflowed the stack on `"[".repeat(20000) + "]".repeat(20000)` before it was
closed:

| # | surface | closed by |
| --- | --- | --- |
| 1 | `internal/parser.ts` value mode (`parseValue`→`parseArray`/`parseObject`) | cap |
| 2 | `internal/parser.ts` tree mode (`parseValueTree`→`…Tree`) | cap |
| 3 | `JsoncNode.evaluateNode` (backs `toValue`) | cap |
| 4 | `JsoncVisitor.visitGen` | cap |
| 5 | `Jsonc.deepEqual` | cap |
| 6 | `internal/navigate.skipValue` | **rewritten iteratively** |

The surfaces a two-stage frame does not predict — `toValue`, `equals`,
`visit`, `modify` — are where an incomplete hardening pass leaves the facade
overflowing on the same input.

## Measuring the cap

Do not guess the cap. A multi-frame recursion chain overflows far shallower
than "levels of nesting" suggests: yaml's composer overflowed at about 900
levels because each level is several stack frames, and its cap is 256. Measure
the real overflow point and set the cap with wide margin.

## Paired codec directions count depth in the same units

Count container descent, never leaves, in both directions. A parse that guards
only at the opening bracket (scalar leaves unchecked) beside a stringify that
guards at the top of every node, leaves included, breaks at the exact boundary:
a document at exactly the cap with a **non-empty** innermost element parses but
fails to re-emit. Both directions fail typed, so nothing defects, but the
round trip breaks and a documented "same cap on both sides" is false.

A compliance corpus and a differential oracle both miss this when the only
fixture at the bound has an *empty* innermost container: there is no leaf to
reach the phantom extra level. Hoist the guards into the container branches on
both directions, and pin a round-trip test at exactly the cap with a non-empty
innermost value.

## The two-stage pipeline is a special case

In a two-stage `lex → build-tree → walk-tree` pipeline (yaml's CST parser then
composer), the two surfaces are *coupled*, so their caps are chosen together:

- Cap the **tree-walker** (composer) at `MAX_NESTING_DEPTH` (yaml: 256).
- Cap the **tree-builder** (CST parser) slightly ABOVE it (yaml: 264), so the
  walker's user-facing diagnostic fires first when the capped tree is walked; the
  builder's guard is the backstop that keeps tree *construction* from overflowing.

Where a post-hoc walker instead runs over an **already-bounded** tree (jsonc's
`evaluateNode`, `deepEqual`), **equal** caps are correct — the builder's output can
never exceed the walker's cap, so the walker's guard fires only on a hand-built
tree. Do not mis-flag equal caps as a defect in that shape, and do not demand a
+8 offset where the two surfaces are independent rather than chained.

## Algorithmic complexity: the DoS vector can be time, not stack

Some grammars have a second, independent vector: **superlinear parse time on
small, flat input** — no recursion, no nesting, nothing for a depth guard to
see. Markdown is the canonical case: nested strong emphasis (`*a **a **a …`),
thousands of unmatched emphasis openers or link brackets, and repeated
`[ (](` patterns drive a naive matcher quadratic (or worse) while staying a few
bytes wide and one level deep. yaml's alias-expansion bomb — bounded by a
materialized-node budget (`AliasCountExceeded`), not a depth cap — is the same
lesson from the memory side: **amplification vectors are orthogonal to nesting
depth.**

Two consequences for a port:

- **The guard is the algorithm, not a limit constant** — with one carve-out.
  CommonMark's delimiter-stack emphasis algorithm and its "openers and closers
  multiple of 3" rule exist precisely to make pathological delimiter runs
  linear; an engine that "simplifies" them re-opens the vector. Port the
  algorithm faithfully — there is no bolt-on cap that fixes a quadratic
  matcher. **The carve-out: when the SPEC itself sanctions a limit, the limit
  IS the algorithm's fix.** The bare link-destination scan is quadratic on
  unclosed-link input in the reference implementation too, and cmark's fix is
  `MAX_LINK_DEST_PARENS` (32) under the spec's explicit "implementations may
  impose limits on parentheses nesting" license, which `@effected/markdown`
  adopts verbatim: on tens of thousands of unclosed links it turns seconds into
  milliseconds. The discriminator: a spec-sanctioned cap bounds a *scan the
  grammar cannot otherwise terminate*; a bolt-on cap papers over a matcher
  whose fix is a better algorithm. Check the reference's own limit constants
  before assuming the rule forbids constants.
- **The regression instrument is a vendored pathological corpus.** cmark's
  `pathological_tests.py` is the pattern: about 25 named cases
  (`"*a **a" * 65000`, 65k mismatched openers/closers, deep bracket nests,
  reference collisions), each asserting output *shape* via regex under a
  wall-clock timeout — no HTML fixture needed. Vendor it and run it as its own
  mandatory suite. Prefer **ratio-based scaling guards** (time N vs 2N vs 4N;
  instrumentation and hardware cancel) over absolute budgets where the claim
  is complexity. If the suite CALIBRATES its budgets against a measured input,
  **recalibrate after any engine performance fix**: a calibration input that
  rode the removed hot path now measures almost nothing, silently un-scaling
  every other budget.

**A green conformance corpus says nothing about complexity.** Every
conformance example is small and well-formed; an engine can pass all of them
and still hang on twenty repeated bytes. For any grammar whose spec (or whose
reference implementation's test tree) ships pathological cases, treat that
suite as a second, non-optional corpus — and where none exists, write the
hostile generator yourself (`"[".repeat(65000)`-style) before declaring the
engine hardened.
