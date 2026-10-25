---
type: Module
title: "@effected/markdown"
description: CommonMark 0.31.2 + GFM as pure Effect Schema classes; parse, edit, format, modify, transform and project markdown documents.
status: stable
kind: package
resource: ../../packages/markdown
layer: L1
tags:
  - architecture
sources:
  - id: transform-src
    resource: ../../packages/markdown/src/MarkdownTransform.ts
  - id: section-bounds
    resource: ../../packages/markdown/src/internal/sectionBounds.ts
  - id: stringify-facade
    resource: ../../packages/markdown/src/Markdown.ts
  - id: stringify-blocks
    resource: ../../packages/markdown/src/internal/stringify.ts
  - id: mdast-totext
    resource: ../../packages/markdown/src/Mdast.ts
  - id: transform-tests
    resource: ../../packages/markdown/__test__/transform.test.ts
  - id: totext-tests
    resource: ../../packages/markdown/__test__/mdast-to-text.test.ts
  - id: stringify-node-tests
    resource: ../../packages/markdown/__test__/stringify-node.test.ts
  - id: issue-485
    resource: https://github.com/spencerbeggs/effected/issues/485
  - id: systems-804
    resource: https://github.com/savvy-web/systems/issues/804
  - id: issue-1029
    resource: https://github.com/spencerbeggs/effected/issues/1029
  - id: issue-1030
    resource: https://github.com/spencerbeggs/effected/issues/1030
generated:
  by: "okfit/claude-code"
  at: 2026-10-25T14:19:39Z
integrity:
  generated:
    body: ad4fc74e96223252
---

# `@effected/markdown`

`@effected/markdown` is CommonMark 0.31.2 plus GFM expressed as pure Effect
Schema classes: parse into mdast-shaped nodes carrying byte offsets, compute
offset-splice edits, format, modify by node, rewrite trees with typed
transforms, project to and from plain mdast,
walk the tree synchronously or as a `Stream`, and read and write frontmatter through
free-standing codecs. It also carries the MDX node vocabulary (construction
and serialization only), a phrasing-level parse entry point, and a
string-level frontmatter split/join facade. It carries the full-parity
ambition of its format siblings — parse, edit, format and a shared surface
contract, not a read-only projection — and is second in size only to
`@effected/yaml` at roughly 14,000 lines of `src` across 15 public modules
plus the `src/internal/` engine.

Markdown→HTML and HTML→markdown conversion are permanently out of scope as
product features; HTML exists only as test-harness machinery for the
CommonMark conformance corpus (`packages/markdown/__test__/e2e/support/htmlWriter.ts`).

## Tier and dependency posture

**Pure tier.** No IO; the engine is owned entirely in `src/internal/`; zero
external runtime dependencies. `peerDependencies` is `effect` plus
**optional** kit peers on `@effected/yaml`, `@effected/toml` and
`@effected/jsonc` (via `peerDependenciesMeta`), consumed only by the
respective frontmatter codec modules — a recorded delta from
`@effected/config-file`, whose codec peers are not optional. `"sideEffects":
false`.

The HTML5 named character references ship as a committed TypeScript map
generated from the WHATWG HTML standard's entity document
(`https://html.spec.whatwg.org/entities.json`) by
`packages/markdown/__test__/tools/generate-entities.ts` — hand-run, never in
CI or the test suite, and the only thing that fetches — so nothing at runtime
carries a dependency for a table of roughly two thousand entries, which is
what keeps the pure tier's zero-runtime-dependency claim true. Only
semicolon-terminated entity names are kept, since CommonMark's entity grammar
requires the semicolon. The generator used to flatten the `entities` npm
package's packed binary trie instead, with `entities` as an exact-pinned
devDependency; that trie is a private structure that re-encoded in the 8.1.0
minor and broke the walker, so the generator was moved to the spec document
`entities` itself builds from (2026-09-13) and the devDependency dropped. The
acceptance test for any regeneration is entry-for-entry data equality
between the old and new maps; the generated file stamps the fetch date.

## Engine: a hardened commonmark.js port, modularized like micromark

The engine is a vendored, hardened port of commonmark.js — the reference
parser maintained by the CommonMark spec author — implementing the spec
appendix's two-phase strategy: a block pass with lazy continuation, then an
inline pass with the delimiter stack. The port is restructured as
construct-per-module under `src/internal/`, with dialect-keyed registries (a
block-starts table and an inline-trigger table per dialect) — micromark's
decomposition without its continuation-passing-style machinery. Wrapping
mdast/remark as runtime dependencies was rejected as violating the kit's
pure-tier dependency rule; porting micromark directly was rejected as several
times the effort for an extension ecosystem that would not plug into an
Effect port anyway; and parser combinators cannot express lazy continuation
or the emphasis delimiter algorithm, because CommonMark deliberately has no
formal grammar.

Two implementation choices are load-bearing rather than incidental: the
inline pass builds a mutable linked list of tokens and materializes the
immutable node Schema classes only once that list is final (an array form
would reintroduce the quadratic behavior the delimiter stack exists to
prevent), and the frontmatter block, when capture is enabled, is captured raw
at the top of the block pass and never enters the inline pass.

## mdast-shaped nodes

Node Schema classes use mdast's exact node type names and field shapes — the
CommonMark types, the GFM additions and the frontmatter node
(`packages/markdown/src/MarkdownNode.ts`). Positions are unist positions with
line/column and byte offsets. Fidelity fields — bullet character, fence
character and info string, ATX vs setext heading style, delimiter runs,
spacing — ride alongside the mdast shape; the `Mdast` module projects to
plain spec-valid mdast JSON by stripping them. The one exception is `Text`'s
`escapeStyle`: an instruction to the emitter rather than a record of source
spelling, it is admitted by `Mdast.fromMdast` and projected back out by
`Mdast.toMdast` when set, so a consumer building plain mdast can carry it in.

Node discriminators use `Schema.Class` with an explicit tag field named
`type`, never `Schema.TaggedClass` — `TaggedClass` hardwires the `_tag` key,
which is unusable for a foreign contract that requires exactly `type`. This
is scoped to the foreign mdast contract: the package's own unions, such as
the `$schema` declaration union in the [frontmatter
interface](../interfaces/markdown-frontmatter.md), do use `TaggedClass`.
Optionality follows mdast's own readme rather than a summary of it: fields
the spec types as optional booleans are `optionalKey`, with absence meaning
unknown rather than false.

Three deltas from commonmark.js were decided up front, not discovered
mid-port: mdast type names replace commonmark.js's own names; byte offsets
are tracked everywhere (commonmark.js has only line/column source
positions, and offsets also power the edit layer); and definition nodes are
kept in the tree with reference nodes emitted unresolved, per mdast
semantics, where commonmark.js deletes definitions and resolves references
eagerly — wrong for an editing library. The port also retains the
concrete-syntax markers mdast drops. Reference *formation* still follows the
CommonMark spec exactly: a link or image label with no matching definition
stays literal text, never a reference node — the delta is only the emitted
node shape, not the formation rule.

## Dialects: a closed set, no public extension API

See [the closed-dialect-set decision](../decisions/markdown-dialects-closed-set.md)
for the full rationale. In brief: a dialect option defaults to GFM at the
facade (`Markdown.parse*`), plus a frontmatter toggle; the engine's
`parseBlocks` substrate defaults to `commonmark`, which is not an
inconsistency — the substrate default is the registry-composition base the
conformance harnesses and the differential oracle drive directly. GFM means tables, strikethrough, autolink literals,
task-list items and tagfilter, plus footnotes — a cmark-gfm/GitHub extension
rather than GFM spec text, included as table stakes. Footnote handling and
image-vs-footnote-marker disambiguation are expressed as parameterized
construct factories swapped into the GFM table, seams inside base constructs
rather than registry entries, matching how cmark-gfm itself expresses them;
the CommonMark dialect takes the no-seam defaults and stays byte-for-byte
unchanged. Autolink literals split by offset fidelity: scheme and `www`
literals are inline constructs over raw source so offsets stay true, while
email literals run as a postprocess after the delimiter stack is spent.

## Phrasing-level parse

`Markdown.parsePhrasingResult`/`Markdown.parsePhrasing`
(`packages/markdown/src/internal/phrasing.ts`) parse a text fragment as one
paragraph's inline content without running the block pass at all, for a
caller holding already-markdown prose (a link-carrying sentence, a backtick
span) who wants its phrasing nodes without a full document parse and a
paragraph splice. The fragment is prepared exactly the way the block pass
prepares one paragraph, then handed to the inline pass with full source
provenance, so node positions are correct relative to the input string. Two
consequences follow from the single-paragraph contract: blank lines do not
break blocks (a `\n\n` stays literal newlines inside text content, since
nothing at this level can open a heading, list or code block), and no
reference context exists, so a bracketed link label, image label, or
footnote label stays literal text. Failure is rare by construction: only a hardening-guard trip fails, on
`Markdown.parseResult`'s own terms. `parsePhrasingResult` is the `Result`
primitive under the kit's [sync-primitive
policy](../conventions/sync-primitive-policy.md); `parsePhrasing` is its
`Effect.fn`-spanned `Effect` twin.

## Editing: offset-splice, not a lossless CST

See [the offset-splice decision](../decisions/markdown-editing-is-offset-splice.md).
In brief: the edit model is an offset/length/content edit plus an apply-all,
structurally identical to the `jsonc`, `yaml` and `toml` edit vocabularies —
the binding cross-package parity contract, per the [format-package
convention](../conventions/format-package-convention.md). Surgical edits are
computed as offset-splices over the original source; the canonical
stringifier serves synthesized trees. Apply-all adopts `toml`'s
overlap-rejection posture, and range filtering adopts `toml`'s
owning-node-intersection posture — the range-filter posture is the one place
the four format packages still document three different filters, and
`markdown` follows `toml`'s.

Canonical stringify serializes fidelity-first with a recorded canonical-form
table (on `Markdown.stringifyResult`'s TSDoc, mirrored in
`packages/markdown/README.md` and asserted row-by-row by
`packages/markdown/__test__/stringify.test.ts`'s "documented canonical form"
suite). That table is a published stability commitment — changing a row is
a breaking change, per [the canonical-form
convention](../conventions/markdown-canonical-form-is-a-published-commitment.md) — and its escaping is an always-escape set (backslash, backtick, `*`,
`[`, `]`, `<`, `~`, `|`) plus line-start and raw-source-autolink defenses,
with the corpus-wide re-parse equivalence property as the authority. Four
characters — `_`, `&`, `>` and `#` — escape only where CommonMark could
actually bind them, so `parse ∘ stringify` is the identity on ordinary prose
such as `snake_case`, `R&D` and `a > b`, which a downstream page emitter
would otherwise unescape by hand. `*` stays in the always-escape set on
purpose, because an intraword `*` can open emphasis. The MDX presence-keyed
`{` escape is documented separately in the [MDX
interface](../interfaces/markdown-mdx.md).

The one stringify option is `canonical: true` (on `stringify` and `stringifyResult`), which ignores fidelity fields. It is defined as `stringify(MarkdownTransform.canonicalize(tree))`, and both read the single fidelity-field table in `src/internal/fidelity.ts`, so the option and the transform cannot drift. `Text.escapeStyle` is an emitter instruction, not a fidelity field, and survives.

`Markdown.stringify` and `Markdown.stringifyResult` accept `Root |
FlowContent`. A lone flow node serializes as the one-block list `[node]`
through the same internal path a root's children take
(`stringifyBlocks`), so its output is byte-identical to a one-child root's:
the same canonical choices and the same trailing newline, with no wrapper
node built and so nothing that can fail a schema
constructor[^stringify-facade][^stringify-blocks]. `Frontmatter` and
`MdxjsEsm` are not admitted alone, since each means something only at a
document's root; a caller wraps them in a `Root`. The single-node suite pins
the equivalence[^stringify-node-tests].

A `Text` node carrying `escapeStyle: "literal"` opts out of that escaping:
the caller vouches the value is already safe markdown, and the emitter
drops every escape aimed at the inline phase while keeping every escape
that defends the block phase — the structure settled before inlines are
parsed. Kept: a table cell's unescaped `|` (with an escape pair treated as
atomic, as the cell splitter treats it), a value-final `\` doubled in any
container when more content follows it, newlines in single-line containers, the heading
closing-sequence `#`, blank-line and leading-whitespace defenses, line-start
block openers (only a line start that can actually open a block: a list
marker or `#` run followed by whitespace or the line end, `>`, a fence, a
thematic-break or setext run, a frontmatter fence, a delimiter-row-shaped
dash line, and conservatively any `<`, `[`, `|` or `:`; `~0.2.1` and
`1.0.0` stay as written), and MDX's `{`/`<`. A literal value that parses as markdown does not
round-trip, and that is the caller's promise to keep. The parser never sets
the field, the literal path is a separate emitter function so canonical
bytes cannot drift, and `packages/markdown/__test__/stringify-literal.test.ts`
pins both the kept set and the unchanged canonical bytes.

One default is worth naming because it surprised a real consumer: **a
language-less code node with no explicit fence character stringifies as an
indented block.** That is correct and canonical, and the TSDoc states it
outright rather than leaving it to be discovered — see
[languageless-code-node-indents](../gotchas/languageless-code-node-indents.md).

`MarkdownFormat.format` is conservative-by-skipping: marker-normalization
options only, with hazardous conversions skipped rather than attempted
cleverly, and both zero-edits-on-canonical and format idempotence are pinned
by tests. `codeBlockStyle` — converting between fenced and indented code — is
a separate, opt-in formatting option; the fence character itself is never
converted and never becomes a knob, because it is a fidelity field recording
what the source said, and a formatting option silently repurposing a
fidelity field is how a formatter starts lying about the document it read.
Both conversion directions skip on hazard rather than converting cleverly:
the indented direction applies only to root-level, flush-left,
language-less blocks, and skips a block that would lazily continue a
preceding paragraph, be absorbed by a preceding list or footnote definition,
merge with an adjacent code block across the blank line, or has no indented
spelling at all.

`MarkdownFormat.modify` is strict with no raw markdown: replacements are node
fragments or literal strings rendered through the canonical stringifier, so
modified documents re-parse cleanly by construction
(`packages/markdown/src/MarkdownFormat.ts:690`). Its refusals — list items,
table rows, frontmatter, the root, and a multi-line replacement into a
container whose continuation lines the splice cannot prefix — fail typed
with a code naming which refusal applied. See the [frontmatter-refusal
limitation](../limitations/markdown-modify-refuses-frontmatter.md).

## Error posture: parse is near-total

CommonMark has no syntax errors — every string is a valid document. The
parse error channel carries only hardening-guard failures, such as depth caps
and expansion budgets, never "malformed markdown". Diagnostics carry
warnings; strict or failing validation lives at the schema layer rather than
the parser. This diverges from the format siblings for a spec reason, not a
design one, and the diagnostics array does the recoverable-parse work those
packages put on their error channel.

## Module layout

One concern per file, mirroring the `yaml` package's layout; `src/index.ts`
is the sole barrel. `MarkdownNode.ts` co-locates every node class in one file
to break the recursive-AST cycle (`Schema.suspend`, no parent pointers,
recursive references typed as codecs), and also owns the position type and
the node-type selector vocabulary. `FrontmatterResolver.ts` is its own module
so the frontmatter resolver seam stays a lean composition point and a
consumer who never resolves declarations never loads the resolution
machinery. The three frontmatter codecs (`YamlFrontmatter.ts`,
`TomlFrontmatter.ts`, `JsonFrontmatter.ts`) are separate modules for the same
tree-shaking reason. `src/internal/` never imports a public module — the
raw-carrier cycle firewall, with the facade materializing diagnostics.

House schema conventions apply throughout: `make` rather than `new` in the
public surface, bare `optionalKey` fields with implementation-level
defaults, and the Effect-wrapping policy — pure sync where total, `Effect`
where the error channel is real, `Stream` for the visitor.

### Navigation and traversal

The visitor is a tagged-enum event union walking the already-parsed tree
rather than text — the one deliberate divergence from the `yaml`/`toml`
text-visitor convention, possible because parse and walk are separable
surfaces here. `MarkdownVisitor.walk` is the synchronous primitive — a lazy,
re-iterable `Iterable` that walks afresh on every iteration — and
`MarkdownVisitor.visit` is the `Stream` defined in terms of it, so the two
yield identical events; `walk` exists for callers that cannot suspend, such
as a lint rule a host calls synchronously[^issue-1030]. Either way a
foreign-tree depth trip yields exactly one terminal error event. Navigation
accessors are
derived getters using a plain sync walk whose depth guard is a thrown
defect, since getters have no error channel, and every one of them
recomputes per access — a caller checking repeatedly binds the result
once. `find`/`findAll` take a node-type tag (narrowing the result through
`MarkdownNodeOfType`, so `find("heading")` is `Option<Heading>`), a
type-guard, or a plain predicate; they walk in pre-order — the same order
the visitor enters nodes, starting at the root — and return matches by
identity, so a match feeds `MarkdownFormat.modify` directly. Headings list
in document order; sections are delimited by root-level headings only, with ranges
spanning their subsections so the edit layer can splice whole sections;
links pass URL strings through unmodified, with reference forms resolved
through the definition index and an unresolvable foreign reference leaving
the URL genuinely absent.

Every lookup that can miss returns `Option`
([lookups return Option](../conventions/lookups-return-option.md)): `find`, `firstSection`,
`sectionByHeading` and the `frontmatter` getter, matching the sibling format
packages' tree lookups (`JsoncNode.find`, `YamlNode.find`). A derived getter
counts as a lookup, not a data field, because it recomputes from the tree on
each access; the optional fields of the node classes themselves keep mdast's
`T | undefined` shape, since they are data. The rule reaches inside a
`Result` too: `SchemaResolver.declarationOf` is a lookup over decoded
frontmatter that can miss, so it returns
`Result<Option<SchemaDeclaration>, …>` — `Option.none()` for data without a
`$schema` key — rather than `SchemaDeclaration | undefined`. Its
`requireDeclaration: true` overload turns the miss into a typed failure and
so returns the bare `SchemaDeclaration`, with `SchemaDeclarationMissingError`
in the error union only on that path. The
`FrontmatterSchemaResolver.resolve` seam still receives the absent case as
`undefined`, because that is a caller-supplied callback whose parameter
shape is its own contract; a caller bridges with `Option.getOrUndefined`.

The frontmatter fence grammar is the kit's own closed set — `---` yaml, `+++`
toml, `---json` json, each fence line exact — and it does not match
markdownlint's `frontMatterRe`: markdownlint also strips a bare `{ … }` JSON
block and fences with trailing whitespace, and does not strip `---json`. A
consumer bridging kit trees to markdownlint must parse the same text
markdownlint parsed (its `frontMatterLines` plus `lines`) rather than assume
the two agree on where the body starts.

The synthetic zero-width position sentinel is public, and position carries
it as a make-only constructor default: decode still requires a real position
on every node, so the mdast admission boundary is untouched, while `make`
lets a replacement fragment construct in one line instead of hand-writing a
span the modify path discards anyway. `make` re-constructs a nested class
value rather than passing it by reference, so positions must be asserted by
value (`deepStrictEqual`), never by identity (`strictEqual`).

Section finders sit as a layer over the existing sectioning rather than a
second sectioning implementation, and the section type is a value class
rather than a `Schema.Class` — a navigation projection, not a serializable
domain model. A string matches the trimmed heading text exactly, never as a
substring (a version string must not match a longer version that contains
it, since in a changelog the longer one is often newer and sits earlier).
Depth is equality, not a maximum, so "the first H2 section" cannot silently
return the H1 title. The body is untrimmed, exactly the bytes the body range
describes, so the string and offsets can never disagree.

### Tree rewrites: `MarkdownTransform`

`MarkdownTransform` is the tree-rewrite surface, beside `MarkdownVisitor`
(reads) and `MarkdownEdit` (source splices). It works on a tree, never on
source text, so its output composes with `Markdown.stringify` and with
itself. Every method is total with no error channel, so each returns a plain
value with no `Result`/`Effect` twin and no span; a handler that throws
propagates its exception unchanged[^transform-src].

- **`map` has two overloads.** The first covers every node whose handler
  cannot change its type (a `Root`, any flow node, a list item, a table row
  or cell, an `html` node) and returns `N` itself, so a generic caller
  constrained to `Root | FlowContent` gets its own type back. The second
  takes any node; for a lone phrasing-only node its result widens to
  `PhrasingContent` (`MarkdownTransformResult<N>`).
- **The walk is post-order, children left to right, as a contract.** A
  handler sees its node with its children already transformed, and handlers
  run in the document order of nodes' closing positions, so a stateful
  handler (dedupe keeping the first occurrence, remember the last paragraph)
  can rely on it. The input node is visited last.
- **Unchanged subtrees are shared.** A subtree no handler changed comes back
  as the same instance, so `map(node, {})` returns `node`.
- **A changed parent is rebuilt with only `children` swapped**, through its
  own constructor with `disableChecks`. That skips refinement checks only,
  which handler typing makes redundant; the constructor still parses the
  node's structural fields shallowly, with class instances passing by
  reference.
- **A rebuilt parent keeps its original `position`**: offsets into the
  pre-transform source, which no longer describe the transformed tree.
- **Phrasing-only handlers may change type** (`MarkdownPhrasingOnlyType`):
  a `link` handler may return a `linkReference`, because every parent of a
  phrasing node holds phrasing children. Every other handler returns its own
  type, which keeps `map` total. `html` is excluded from the type-changing
  set because it belongs to both the phrasing and the flow unions, so an
  `html` node can sit in a `Root`, `Blockquote` or `ListItem` where only
  flow content is valid. A type-level test pins that `html` is the only
  overlap between the two unions, so a new class that joins both breaks the
  suite rather than the typing's soundness[^transform-tests].
- **`shiftHeadings` clamps.** The new depth is `clamp(depth + by, min ?? 1,
  max ?? 6)`, and a heading whose new depth exceeds 2 drops `headingStyle:
  "setext"` (setext spells only depths 1 and 2), so it serializes as ATX. A
  heading whose depth and style do not change keeps its identity. A
  non-integer `by` or an invalid bound throws `RangeError` as a wiring
  error.
- **`sections` returns child-index spans** (`heading`, `headingIndex`,
  exclusive `end`) over an in-memory `Root`, so it works on a tree `map` has
  reshaped, where `MarkdownDocument.sections` needs source text. It takes an
  exact depth and an optional `[start, end)` window, which is how a caller
  nests: depth-2 blocks first, then depth-3 sections inside one block's
  `[headingIndex + 1, end)`. Both finders share one boundary helper, so
  they cannot drift: a section ends at the next root-level heading of equal
  or shallower depth[^section-bounds]. A stray shallower heading therefore
  ends a section too: querying depth 2 over `## Features`, a list, `# Top`
  and another list yields one span ending at `# Top`. That is the outline
  reading. A caller slicing a changelog by entry, where a stray H1 is
  content, takes each body's end from the next span's `headingIndex` (or
  the window's end for the last span) instead.
- **No depth guard.** `map`, `shiftHeadings` and `Mdast.toText` recurse
  once per nesting level. Every tree `Markdown.parse` or `Mdast.fromMdast`
  produces stays within `MAX_NESTING_DEPTH`, but a hand-built tree nested
  far deeper than parse output can overflow the call stack.

### Plain text: `Mdast.toText`

`Mdast.toText` is `mdast-util-to-string` semantics applied over the
`toMdast` projection, with the same `includeImageAlt` and `includeHtml`
options. The one value the projection changes is a code node's: a parsed
`Code.value` keeps its final line ending and plain mdast does not, so
`toText` strips it, giving `"let x"` rather than `"let x\n"` for a one-line
fenced block[^mdast-totext]. This is the remark-ecosystem derivation, for
matching what remark tooling computes (slugs, search indexes). It is
distinct from the display text on `DocumentHeading.text` and
`DocumentSection.text`, which render a hard break as a space and drop raw
HTML.

## Hardening

`packages/markdown/src/internal/limits.ts` is the zero-dependency leaf
carrying the cross-package depth constant (`MAX_NESTING_DEPTH = 256`),
guarding the recursive surfaces that take untrusted input — container
nesting in the block pass, the delimiter and bracket stacks in the inline
pass, stringify recursion and the visitor walk. Iterative surfaces are
deliberately unguarded, and so are the tree-to-tree recursions
(`MarkdownTransform` and `Mdast.toText`), which see only trees the guarded
surfaces already admitted or that a caller built by hand. The cmark
pathological suite pins the linear-time guarantee against Markdown's
quadratic emphasis and link-blowup DoS vector, calibrated against a
same-code-path baseline rather than raw milliseconds so v8 coverage
instrumentation overhead cannot mask an algorithmic regression; the suite is
recalibrated after any performance fix. Three of its cases nest past the
depth cap by construction and are *refused* rather than parsed — a named
`GUARD_REFUSED` set pins that they trip fast and with the right reason, so
a case newly falling into that branch fails the suite; they are the
hardening posture working, not failures. The bare link-destination scan is
capped at a fixed open-paren count — an inherited-not-introduced defect,
since upstream commonmark.js carries the identical uncapped loop, fixed here
via cmark's own cap and pinned by unit tests plus a growth-ratio guard immune
to instrumentation and hardware variance. The reference map is keyed through
a real `Map`, since link labels are attacker-controlled. Malformed input
yields a typed error or a diagnostic, never a defect, and defect passthrough
is proven at the facade.

Schema class construction dominates parse cost; stringify is orders of
magnitude cheaper because it builds no Schema nodes. That inward
construction cost is accepted, because it is the checked admission boundary
and checked admission is its purpose. What is not accepted is paying
construction per ancestor: array fields typed as a class deep-reconstruct
every element on `make`, but an array field typed as a real one-member union
passes through by identity — which is why the category type aliases for
table, row and list children (`TableContent`, `RowContent`, `ListContent`)
are real one-member unions rather than aliases of their single member.

## Observability

Pure-tier rule: named `Effect.fn` spans on the public fallible boundaries
only. No per-construct instrumentation inside the block or inline passes. No
metrics; telemetry-agnostic.

## Testing

Unit tests live in `packages/markdown/__test__/`, conformance suites in
`packages/markdown/__test__/e2e/`, using `@effect/vitest` and `assert.*`
(never `expect`). Five vendored corpora are committed as fixtures, each with
a pin file recording upstream repo, ref and license:

1. The CommonMark spec corpus (source: `commonmark-spec`,
   `.repos/config.json`) — normalized-HTML equivalence via a test-only HTML
   writer, following the `mdast-util-from-markdown` precedent; no product
   HTML.
2. The GFM spec extension sections (source: `cmark-gfm`,
   `.repos/config.json`) — the two upstream-disabled task-list examples are
   excluded, so task-list conformance is proven by the extensions corpus
   instead.
3. `cmark-gfm`'s extensions corpus — the only official footnote corpus.
4. The `cmark-gfm` pathological cases — the linear-time hardening proof.
5. `mdast-util-from-markdown` fixtures — markdown/JSON pairs with full
   positions, proving direct AST-plus-position equality through the `Mdast`
   projection, which proves interop rather than just rendering. Three
   engine-lineage divergences between this commonmark.js port and
   micromark's fixtures — all whitespace-shaped stored values, none
   reachable from mdast's field contracts — are masked symmetrically on
   both trees and each pinned by a tripwire.

The standing goal is an empty skip map, matching the `toml` precedent: the
dialect matrix runs the whole CommonMark corpus under both dialects with an
explicitly asserted bidirectional divergence list (eleven examples: six
tagfilter, five autolink-literal), so a divergence that appears or
disappears fails the suite. The differential oracle is the `commonmark` npm
package, an exact-pinned devDependency imported only by a property test,
following the `smol-toml` pattern; it is pinned to the CommonMark dialect
because it knows no GFM, and has surfaced a genuine upstream defect handled
by a narrow oracle-side correction plus a tripwire test that fails if
upstream fixes it. Known limitations of the stringifier are pinned the same
way, so a red tripwire can mean a limitation was fixed rather than a
regression — see
[markdown-red-tripwire-may-mean-a-limitation-moved](../gotchas/markdown-red-tripwire-may-mean-a-limitation-moved.md).
Property tests assert parse never
throws, node positions span valid offsets, splice idempotence, stringify∘parse
re-parse equivalence, and frontmatter round-trip through all three real
codecs.

`Mdast.toText` fixtures must come from parsed trees, not only hand-built
nodes: parsed nodes carry engine conventions a hand-built node lacks, and a
hand-built `Code` node with no trailing newline is exactly what hid the
final-line-ending defect. Two layers pin it[^totext-tests]. A projection
oracle reproduces the upstream `mdast-util-to-string` algorithm verbatim
over plain JSON, runs it on `toMdast(root)` for every conformance-corpus
example, and compares it against `toText` on every node of the parsed tree
walked in parallel. A fixture table covers every node kind under both option
flags, building code rows by parsing and hand-building only the kinds the
parser never produces (MDX, frontmatter). The real library is not a
devDependency; `commonmark` stays the package's one exact-pinned oracle.
`MarkdownTransform`'s traversal coverage uses a constructed tree holding
every node class with a `children` array, each with a `Text` leaf, because
the corpus has no footnote definitions and no MDX[^transform-tests].

## Consumer seam

The `Mdast` projection is the remark-ecosystem interop boundary; the
frontmatter codecs are the gray-matter replacement. Nothing in this package
knows about any consumer; like its format siblings it stays a pure, unaware
format package, and any future codec-style integration points its dependency
arrow at markdown, never from it.

The first in-kit consumer is `@effected/github-actions`, whose markdown
builder synthesizes node trees and serializes canonically to get
GitHub-safe escaping — the usage the escaping guarantees were written for,
and the first outside proof they hold. Because this is one of the kit's
largest packages, that consumer confines it to one module and pins the
confinement with a bundle-reachability test; a pure format package that a
consumer must ration is a reasonable outcome of its size, not a defect to
fix here.

`MarkdownTransform`, `Mdast.toText` and single-node stringify answer
effected#485[^issue-485] and savvy-web/systems#804[^systems-804], worked
through the `markdown-transform` dogfood loop with savvy-web/systems.

Two issues remain open against this surface. `Mdast.fromMdastResult` throws
rather than failing typed on foreign mdast nested 1000 or more levels
deep[^issue-1029]. A markdownlint-compatible lint shape, so a rule is
defined once over kit trees, is under design[^issue-1030].

## Parity notes

The edit and range types are field-identical to the three format siblings',
and the diagnostic core carries the shared fields — the binding cross-package
parity contract stated in the [format-package
convention](../conventions/format-package-convention.md). Two siblings emit
a trailing newline on stringify and the JSON frontmatter codec does not; this
recorded rough edge in the parity surface is normalized around at the
frontmatter write seam's one render site rather than forcing a sibling to
break byte-compatibility (see the [frontmatter
interface](../interfaces/markdown-frontmatter.md)). A `schema(target)`
factory must carry its decode and encode service generics from day one:
shipping without them silently loses a target schema's requirements through
the composition, and threading them later is a signature change on the
package's flagship surface.

## Deferred

The `obsidian` dialect must land as registry entries alone, with no public
API change. A read-side one-call composition folding parse, extract, resolve
and validate together remains unbuilt (the write half exists). Porting the
mdast-to-hast conversion for HTML output was raised and deferred behind a
decision gate — revisit after real consumer adoption shows whether keeping
that one remaining ecosystem dependency is a real cost; either way the
`Mdast` projection is the bridge a consumer renders through via the existing
ecosystem converter, and HTML string serialization stays permanently out of
scope regardless. A separate knowledge-format package is deferred until a
convention needing frontmatter schemas, heading/section navigation, link
extraction and lossless round-trip stabilizes enough to justify one.
Per-key surgical frontmatter editing over the format packages' own edit
layers is deferred; see the [frontmatter interface](../interfaces/markdown-frontmatter.md).

## Build

Standard package-scaffold mechanics, with the narrow
`ae-forgotten-export`/`_base` API Extractor suppression, building only via
`pnpm build --filter @effected/markdown`. The `commonmark` oracle package is
an exact-pinned devDependency — never in `dependencies`, and never drifting
from the ported CommonMark version.

[^transform-src]: `packages/markdown/src/MarkdownTransform.ts` — `map` overloads, walk order, structural sharing, `shiftHeadings`, `sections`.
[^section-bounds]: `packages/markdown/src/internal/sectionBounds.ts` — `rootHeadingBounds`, shared by `MarkdownDocument.sections` and `MarkdownTransform.sections`.
[^stringify-facade]: `packages/markdown/src/Markdown.ts` — `stringifyResult` / `stringify` over `Root | FlowContent`.
[^stringify-blocks]: `packages/markdown/src/internal/stringify.ts` — `stringifyBlocks`, the one path behind a root and a lone node.
[^mdast-totext]: `packages/markdown/src/Mdast.ts` — `Mdast.toText` and `MdastToTextOptions`.
[^transform-tests]: `packages/markdown/__test__/transform.test.ts` — the html-only-overlap type test and the every-container traversal tree.
[^totext-tests]: `packages/markdown/__test__/mdast-to-text.test.ts` — the projection oracle and the parsed-fixture table.
[^stringify-node-tests]: `packages/markdown/__test__/stringify-node.test.ts` — "Markdown.stringify on a single flow node".
[^issue-485]: <https://github.com/spencerbeggs/effected/issues/485>
[^systems-804]: <https://github.com/savvy-web/systems/issues/804>
[^issue-1029]: <https://github.com/spencerbeggs/effected/issues/1029>
[^issue-1030]: <https://github.com/spencerbeggs/effected/issues/1030>
