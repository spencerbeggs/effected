---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - yaml.md
  - yaml-stringify.md
  - ../yaml-lint.md
  - ../formatter-convention.md
---

# @effected/yaml — the comment model

## Overview

[`@effected/yaml`](yaml.md) round-trips comments per node: where a comment is captured, which node owns it, how a run of comment lines is encoded in one string field, and how the stringifier puts it back. Capture lives in `src/internal/composer/comments.ts`; emission is spread across the stringifier's block, flow, explicit-key and compact branches.

The model reaches its current shape through two deliberate breaking schema changes, and both reasons still constrain it. The first split leading from trailing: a single undiscriminated `comment` field made the composer attribute own-line comments *backward*, so `# section` above `b:` re-emitted as `a: 1 # section` — relocating a comment onto the wrong line and construct, a worse fidelity bug than dropping it. The second moved the fields off `YamlPair` onto the key and value nodes, which is where the model actually closes.

## The fields

`YamlScalar`, `YamlMap`, `YamlSeq` and `YamlAlias` each carry `commentBefore` (own-line comment text directly above), `comment` (strictly **trailing**) and `spaceBefore` (a blank line preceded the node and its `commentBefore` block). **`YamlPair` carries none** — it is `key` and `value`, nothing else. `YamlDocument` uses the same two names as the node classes: `commentBefore` is the leading header block, `comment` the trailing one.

**Two node slots per entry rather than one pair slot is the whole point.** A key-line comment and a value's trailing comment become different fields on different nodes, so neither has to relocate onto the other's line — which a single pair-level slot forced. Pair-level storage was also the *cause* of most of the divergences the first pass recorded: pair-level placement, the alias drop, the trailing-comment drop on multi-line complex keys and the document field naming all dissolved with the move rather than being patched one at a time. The generalizable lesson: when a divergence list clusters, suspect where the data is stored, not the emitter reading it.

## Attribution

**Attribution runs forward, and a trailing comment belongs to the last node on its line.** An own-line comment leads the following entry's KEY node (`commentBefore`, plus `spaceBefore` when a blank line preceded it). A same-line comment attaches to the entry's VALUE when the value ends on that line (`a: 1 # t`) and to the KEY when it does not (`push: # only main`, with the value written below) — so a comment stays on the line its author put it on. Consecutive own-line comments join with newlines into one run, and blank lines inside a run embed as extra `\n`s. Own-line comments after a collection's last entry become the collection's `comment` when at or beyond its content column and **escape to the enclosing scope** — through multiple levels — when shallower, which is what makes a terminal comment land on the construct a reader would say it belongs to.

**The document header is marker-aware.** A header block *ahead* of a `---` marker is the document's `commentBefore`; a header *after* the marker leads the ROOT NODE; a header with no marker at all forward-attributes to the first entry's key exactly like any other own-line comment. A root **block** collection's terminal comment run escapes to the document — the document is that collection's enclosing scope, so the escape rule above keeps applying at the top — while a root **flow** collection's does not, because it sits inside the brackets with nowhere to escape to.

## Storage and the spaces-only escape

**Storage is the raw post-`#` slice.** Alignment spaces, no-space-after-`#` and bare `#` are all preserved byte-faithfully, because normalizing them at capture would make the field lossy for the one job it exists to do.

**One string, one reserved value — so spaces-only comments carry an escape.** A comment field holds a whole run of comment lines joined into a single string, and the empty segment `""` is *reserved* as the blank-line-within-a-run encoding. That is a pigeonhole: with `""` spent, no in-string sentinel can distinguish a bare `#` (raw slice `""`) from a `#` followed by one space (raw slice `" "`) from an embedded blank line. The resolution is a reversible escape rather than a second field or a structured type — a spaces-only raw slice is stored with one extra trailing space at capture (`rawCommentText`) and the renderers strip it back off at emission (`commentBlockLines` / `renderTrailingComment` in the stringifier). The escape is injective, so a bare `#`, a `#` with a trailing space and an embedded blank line all round-trip byte-intact. Its **public** consequence is real and deliberate: the comment-string value a consumer reads off a node for a spaces-only comment carries that extra trailing space, so the escaped form is what the field exposes — documented on `rawCommentText`'s TSDoc and in `packages/yaml/CLAUDE.md`.

## Divergences from the reference

**Three divergences from the reference `yaml` package are recorded in one place** — the head of `src/internal/composer/comments.ts`. Absent-value placement: a trailing comment on a valueless `a:` lands on the KEY, where the reference materializes a null `Scalar` and uses that — identical bytes, visible only to a consumer reading the field, and matching it would mean making `pair.value` always-a-node, which breaks every `value === null` check at runtime rather than at compile time. Plus pre-`#` spacing normalization and multi-document `...` trailer attribution. Every one keeps the emitted bytes reparse-stable. Read that header before changing attribution; do not re-derive them.

## Emission and the visitor

The stringifier emits comments for every node kind in both block and flow styles, including the explicit-key and compact branches, and a block scalar at the **document root** splices its captured header comment onto its first rendered line across the bare, `---` and tag/anchor branches. `preserveComments` delivers what its name promises instead of reaching only the document comment. Canonical mode (`forceDefaultStyles`) is **comment-free** — that is what keeps the e2e harness's byte-equality assertions comparing structure rather than trivia. The visitor's `Comment` event carries `placement: "leading" | "trailing"`; it walks alias comments and emits no pair-level events, which leaves the stream a consumer sees unchanged because the key and value walks run at the pair's own path. `YamlFormat.modify` replaces a value node outright, so the replacement starts comment-free while the entry's key keeps its own.

**Aliases needed the emitter changed too, not just the schema.** Giving `YamlAlias` the comment triple made capture work and left the stringifier's `instanceof YamlAlias` guards still skipping those fields, so an alias comment was attached on parse and dropped on emit — the divergence was half closed and read as closed. The oracle contract had asserted *capture* for aliases, which is precisely why it stayed green through it; its alias cases now assert byte-intact re-emission. The lesson generalizes past this package: for a round-tripping format, a test that reads a field back off the AST proves the parser and nothing else, and pairs of capture/emission code are exactly where a schema change leaves one half behind.

**A closing bracket is not content.** A flow collection whose closer sits at column 0 (`x: {\n  a: 1\n}`) was once rejected as an under-indented continuation line. The spec puts no indentation floor on a closer and the reference accepts the shape, so the continuation-indent check in `internal/composer/flow.ts` exempts a line holding only closing punctuation. Do not re-tighten it: it also blocked flow-comment parity, which is how it came into this scope.

## Verification

**Verification is a committed-literal oracle plus a fixed point.** `__test__/comment-model-oracle.test.ts` pins the node-level model against `yaml@2.9.0` on the same convention as the [explicit-key fixtures](yaml-stringify.md#explicit-key-spill--the-implicit-key-limit): authored once offline with provenance in a scratch `ORACLE.md`, the committed literals are the contract thereafter, and the reference package is never a dependency of the test run. A real-world workflow fixture stays byte-identical under `YamlFormat.formatToString` — including `push: # only main`, which an intermediate attribution rule re-based and the final one does not. [Conformance](yaml.md#fixture-corpus-and-compliance-harness) held at 100% throughout, including through the composer re-attribution that sits in the path every fixture exercises.

**An idempotence ledger entry is a place to look for a loss bug, not a place to park one.** The format-idempotence ledger in `__test__/e2e/format-properties.e2e.test.ts` is at its pre-comment-work baseline: the ids once parked there as "converges on the second pass" were comment-**loss** defects — the explicit-key branch never emitted the value node's own `commentBefore`, and a mapping whose last pair had a null value swallowed the terminal own-line comment while hunting for a value that was not there, both on a single pass.
