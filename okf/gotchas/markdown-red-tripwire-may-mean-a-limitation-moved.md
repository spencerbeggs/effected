---
type: Gotcha
title: A red markdown tripwire test may mean you fixed something, not broke it
description: "@effected/markdown pins its known limitations, engine-lineage divergences and one oracle defect with tripwire tests that fail when the pinned behaviour changes in either direction — including when it silently improves."
status: stable
stale_after: "2027-03-21T00:00:00Z"
resource: ../../packages/markdown/__test__/stringify.test.ts
tags:
  - testing
  - dx
sources:
  - id: known-limitation-pin
    resource: ../../packages/markdown/__test__/stringify.test.ts
  - id: interop-tripwires
    resource: ../../packages/markdown/__test__/e2e/mdast-interop.e2e.test.ts
  - id: oracle-tripwire
    resource: ../../packages/markdown/__test__/oracle.property.test.ts
  - id: dialect-matrix
    resource: ../../packages/markdown/__test__/e2e/dialect-matrix.e2e.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 8e522784e9b602de
---

# A red markdown tripwire test may mean you fixed something, not broke it

## What a reader sees

After a change to the [markdown module](../modules/markdown.md)'s engine or
stringifier, a test named `KNOWN LIMITATION: …`, one under `divergence
tripwires`, the `oracle defect tripwire`, or a dialect-matrix example
"listed as divergent" goes red. The failure message says the pinned
behaviour no longer holds.

## What they will wrongly conclude

That the change broke a conformance property and must be reverted, or that
the test is flaky and can be re-run.

## What is actually true

These tests pin a *limitation* or a *divergence*, not a correctness
property, and they fail in both directions — including when the limitation
was fixed silently. Each is a deliberate tripwire so that a behaviour the
package documents as a known edge cannot drift without a matching edit to
the documentation and the pin:

- **Known-limitation pins** — such as email-shaped plain text re-parsing as
  an autolink under `gfm`, which canonical stringify cannot keep plain
  because the email matcher is a postprocess over decoded text, so no
  escape spelling can hide the run from it.[^known-limitation-pin] If the
  emitted text now stays text, the limitation was fixed: update the pin
  with the fix.
- **Engine-lineage divergence tripwires** — the three whitespace-shaped
  stored-value differences between this commonmark.js port and micromark's
  fixtures (inline-code interior line endings, a trailing tab before a soft
  break, continuation-line indentation inside a multiline reference label).
  The interop harness masks each symmetrically, on *both* trees, and a
  tripwire per divergence fails if either side changes; the fix is to
  delete the now-dead normalizer clause and its tripwire
  together.[^interop-tripwires]
- **The oracle defect tripwire** — a phantom empty paragraph
  commonmark.js@0.31.2 emits for a definition followed by a thematic break,
  corrected on the oracle side only. If a future commonmark.js stops
  emitting it, delete the correction and the test.[^oracle-tripwire]
- **The dialect-matrix divergence list** — exactly eleven CommonMark
  examples (six tagfilter, five autolink-literal) are asserted to render
  differently under `gfm`; an entry whose dialects now agree fails as a
  stale entry, and an example that newly diverges fails as an unlisted
  one. Changing the count means changing the assertion,
  deliberately.[^dialect-matrix]

## The check

Read the test's own comment before touching it: every tripwire says what
to do when it fires. A red tripwire after an engine change is a prompt to
decide whether the change is a deliberate fix — then update the pin, the
README's known-limitation prose and this bundle in the same change — never
a reason to re-run or to widen the normalizer.

[^known-limitation-pin]: `packages/markdown/__test__/stringify.test.ts` — "KNOWN LIMITATION: email-shaped plain text re-parses as an autolink under gfm".
[^interop-tripwires]: `packages/markdown/__test__/e2e/mdast-interop.e2e.test.ts` — the "KNOWN ENGINE-LINEAGE DIVERGENCES" header comment and the "divergence tripwires" suite.
[^oracle-tripwire]: `packages/markdown/__test__/oracle.property.test.ts` — "oracle defect tripwire: the empty-paragraph divergence still exists and is still ours-correct".
[^dialect-matrix]: `packages/markdown/__test__/e2e/dialect-matrix.e2e.test.ts` — `EXPECTED_GFM_DIVERGENT`.
