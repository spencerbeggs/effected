# The corpus harness in depth

The `SKILL.md` lists the harness rules every format package follows. This
reference holds the cases that need judgment: entries with no assertable
output, an oracle that is wrong, verifying a serializer, fixtures that land in
the wrong layer, and the standing real-world fixture.

## Vendoring and pinning the corpus

Vendor fixtures as committed plain files — no submodule, no fetch-on-test —
under `__test__/fixtures/<corpus>/`, with a pin file alongside (yaml's
`VENDORED.md`, toml's `README.md`) recording upstream repo, tag/commit, fetch
date, subset taken, and the update recipe. Check the corpus license and record
it; test-only vendoring with attribution is the ecosystem norm even for
CC-BY-SA spec corpora.

## Skips, and the entries that assert only termination

An empty skip map is the standing goal: toml runs its whole valid and invalid
suites with zero skips, and yaml runs every case directory with empty
`SKIP`/`SKIP_ASSERTIONS` maps. A skip is a documented exception, not a pressure
valve. Real corpora contain entries with no assertable output (cmark-gfm's
`extensions.txt` example 20 expects literally `<IGNORE>` — an upstream crash
regression asserting only termination). Run those through an explicit
`TERMINATION_ONLY` set with the reason inline — neither a skip nor a fabricated
assertion.

## Raw bytes and control characters

When cases deliberately embed CR/CRLF, a scoped `.gitattributes` (`* -text`) in
the fixture root keeps Git from normalizing them. Control characters in
hand-written tests and TS fixtures are ALWAYS escapes (`\x00`, `\x7f`), never
literal bytes: file-editing tooling silently mangles literal control characters,
and an edit round-trip that replaces a NUL with a space makes a preprocessing
hardening test pass vacuously. Literal bytes belong only in committed raw
fixture files under the scoped `.gitattributes`, which are never hand-edited.

## The differential oracle, and when it is wrong

The rejected upstream parser, exact-pinned as a devDependency, is imported by
exactly one property test (toml's `smol-toml` at 250 runs). The corpus wins on
disagreement; the oracle catches what the corpus never sampled.

**The oracle can be WRONG — and "corpus wins" only settles disagreements the
corpus actually exercises.** A generated input the corpus never sampled needs
root-cause investigation in the *oracle's* source before either side is
trusted. commonmark.js, for one, renders a phantom empty `<p></p>` for a
reference-only paragraph before a thematic break: a flag that does not carry
between its two definition-stripping sites in `blocks.js`. When the port is
right and the oracle is not: correct the oracle's OUTPUT narrowly on the oracle
side of the comparison, AND pin a tripwire test asserting the divergence still
exists — a future upstream fix fails the tripwire and forces the correction's
deletion. Never a skip entry.

## Serializer verification is a corpus-wide re-parse equivalence property

For every corpus example: parse → stringify → parse, then compare the two
parses' rendered output through the harness's own writer and normalizer —
render-to-render, never stringified-text-to-original-text and never
render-to-spec-HTML. Both sides share the parser, so the comparison isolates
serializer bugs from parser bugs, reuses the existing harness machinery at no
extra cost, and needs no skip list — any failure is a real serializer defect.
Genuinely unrepresentable cases get documented KNOWN LIMITATION tests that fail
if the limitation is ever silently fixed (the tripwire pattern again), never
skips.

## Unit fixtures must land in the layer they claim to test

In a multi-pass engine, an innocuous-looking input can be claimed by an earlier
pass and silently test the wrong thing — a markdown inline fixture starting with
`<` opens an HTML *block*, so the "inline" test exercises the block pass. Lead
inline fixtures with plain text (or assert the parsed node type first) so a
fixture cannot drift between layers unnoticed.

## A green corpus proves conformance, not reachability

A conformance corpus can be entirely green while a whole production is broken.
`@effected/yaml`'s corpus once passed in full while explicit-key entries with a
compact mapping value parsed to phantom null-keyed entries: the corpus has
explicit-key cases, but none in the *shape* real documents use.

**So every format package carries at least one standing fixture drawn from a
real document** — a `pnpm-workspace.yaml`, a `tsconfig.json`, an actual
`Cargo.toml` — parsed and round-tripped on every run, in addition to the corpus.
The corpus proves you match the spec's examples; the standing fixture proves the
production the spec's examples happen not to combine.

The law generalises past formats:

> Every defect worth finding was green somewhere — specifically, green in the
> suite of whoever was most confident about that code.

A duplicate module, a silent name collision, an unreachable export, a
truncation in every list read and a normaliser that drops its own typed input
can each pass their author's suite and surface only when a second party runs the
code for real. A suite you wrote cannot tell you what you did not think to
model. Budget for one consumer path exercised end to end — a real document, a
real API call, a real binary run — and treat its absence as a known gap rather
than as coverage.
