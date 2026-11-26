# Porting an engine

The `SKILL.md` gives the two sanctioned engine origins (vendor-and-harden, or
from scratch). This reference holds how to verify a port while you write it and
where a ported extension hooks into an existing pipeline.

## Differential verification starts the port, it doesn't just gate the ship

When a reference implementation is executable and vendored (a reference parser,
a `normalize.py`), run the port against it **over the real corpus as the first
verification step** — before trusting any hand-written unit suite. It takes
minutes, and it finds the edge-case bugs a green hand-written suite never
sampled: a Markdown port's first differential run caught three real bugs that
dozens of passing unit tests had missed. The exact-pinned oracle devDependency
in the corpus harness is the *shipping-gate* complement to this porting-time
tool: same idea, different moment — use both.

## Where a ported extension hooks into an existing pipeline

The hook point is determined by two constraints, not by taste. A pass that must
read source text verbatim (offset fidelity) cannot run after decoding —
entities and escapes have already shortened node values, so offsets computed
there are guesses. A pass that must scan backwards over consumed text cannot run
before the delimiter/bracket stacks are spent — unlinking a node a live
delimiter still points at corrupts the list.

The two constraints can split one upstream extension across both moments:
cmark-gfm's autolink literals port as an inline construct for www/scheme
literals (raw source, offsets intact) and a postprocess after
`processEmphasis` for email literals (backwards scan, no stack left to
corrupt). Check the upstream source for this split before assuming a single
mechanism — and grepping for the construct's name is not enough on its own:
dispatch branches can live in switch cases that never mention it (cmark-gfm's
`![^`-never-opens-an-image branch contains no "footnote"). Grep for the
construct name AND read the dispatch switch for every character the construct
touches.

## An extension that branches inside a base construct: swap a parameterized construct

When the upstream extension is a branch inside a construct the base dialect
already owns, no trigger-table entry can express it. A construct that claims
every occurrence of its trigger character (cmark-gfm's close-bracket handler
emits a literal `]` even when nothing matches) makes anything registered after
it unreachable, and anything registered before it beats the constructs the
extension must lose to (`[^a](/url)` is a link, not a footnote).

The pattern: export a `makeXConstruct(seam?)` factory from the base construct
module, keep the base dialect's spelling as the no-seam default, and swap the
parameterized construct into the extending dialect's table rather than
appending a new entry. The base dialect stays byte-for-byte unchanged, and the
seam sits at exactly the upstream branch point (cmark-gfm's footnotes need two:
the close-bracket no-match branch and the image opener's `![^` peek).
