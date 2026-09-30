---
type: Module
title: "@effected/templates"
description: A managed-section mechanism — delimited BEGIN/END blocks a tool owns inside a file the user otherwise owns.
status: stable
kind: package
resource: ../../packages/templates
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T01:39:09Z
  body_sha256: 21d1f961a162f47cf951dd40791047f8d96011cf5b6fc222607739fc9e6611c6
---

# @effected/templates

`@effected/templates` owns one mechanism: a managed section — a delimited
`BEGIN`/`END` block inside a file whose surrounding content belongs to the
user. A tool owns the block; the user owns everything else; neither
destroys the other. The package locates those blocks in a document,
decides what changed, and rewrites the document so the tool's blocks say
what the tool wants while every byte outside them survives.

The mechanism has two halves. The pure half is a text algorithm: parse a
string into spans and sections, compare, reconcile a declared set of
blocks against what the document already has, render a new string. It
takes no `Effect`, does no IO, and is testable from a string literal. The
effectful half is a `ManagedSection` service that reads a file, runs the
pure half, and writes back when the text actually changed — a shell thin
enough that a reviewer can see no business logic is hiding in it. That is
one subsystem in two layers, not two subsystems.

Scope is managed sections only; whole-file templating is deliberately out
of scope until a consumer proves a concrete shape.

## Mechanism here, content elsewhere

The package owns marker syntax, parsing, reconciliation, comment styles as
a parameterized set, and file IO. It owns no vocabulary: what a section's
content says, which files carry sections and in what order, and what the
section keys are called all belong to the consumer. No vendor naming
appears anywhere in the package — the default marker phrase is `MANAGED
SECTION` and the doc examples use `example-tool`. A "shell section
definition" is not a shell abstraction; it is a section id with
`commentStyle` pre-bound to `#`, a `const` at a consumer's call site — see
[mechanism, not content, is the design's spine](../decisions/templates-mechanism-not-content.md).

## Tier and dependencies

**Boundary tier.** `effect` is the only peer; no `@effected` edges and no
external runtime dependencies. `FileSystem` arrives in `R` from the
consumer's platform layer, the walker/xdg/git pattern. `Path` is
deliberately not required: paths are opaque strings handed straight to
`FileSystem`, and this package never joins, resolves or splits one — if a
future member needs to derive a sibling path, `Path` joins `R` then, as a
recorded change, not a reflex. `@effect/platform-node` is a devDependency
for the integration suite only. No diff engine, no template engine, no
`node:` import anywhere.

`Section.ts` imports `Effect` as a value — `Schema.withConstructorDefault`
takes an effect, for the attribute default below — which is still
`effect`, not a new dependency, and does not move the boundary-tier split.

## Module layout

Module-per-concept; see `packages/templates/src/`:

- `CommentStyle.ts` — the `CommentStyle` class and its preset set.
- `SectionDialect.ts` — the marker phrase, the recognized styles, marker
  rendering, `SectionRenderError`.
- `Section.ts` — `SectionKey`, `SectionId`, `Section`.
- `SectionDocument.ts` — the pure core: parse, inspect, reconcile, render;
  `SectionParseError`.
- `SectionOutcome.ts` — the `SyncOutcome` / `CheckOutcome` unions, both in
  one module because they are variants of one concept sharing a module
  under the grouped-statics carve-out.
- `ManagedSection.ts` — the `Context.Service`, its layers,
  `SectionFileError`.
- `internal/scan.ts` — the marker scanner (regex construction and
  escaping); `internal/reconcile.ts` — the spans and placeholder
  algorithm; `internal/attributes.ts` — the attribute grammar, shared by
  renderer and scanner so the two cannot disagree.

Import direction is one-way: `CommentStyle → Section → SectionDialect →
SectionDocument → ManagedSection`. `internal/` may import concept modules;
concept modules must not import `SectionDocument` (why the scanner returns
a plain tagged result and `SectionDocument` mints the error).

## The identity rules

**`CommentStyle` is a class, not a literal union.** A two-member `"#" |
"//"` union makes every wrapped comment format unrepresentable, which is
the single largest capability gap a line-prefix-only predecessor had: a
managed section in a Markdown README or an XML file needs `<!-- … -->`.
Here a style is `{ prefix, suffix? }` data, so a consumer with a format
nobody anticipated writes its own (`%` for TeX, `(* … *)` for ML) and
everything works. The prefix and suffix checks are load-bearing: a newline
in a prefix would let a caller inject arbitrary lines into a marker, and
an empty prefix would make the scanner match every line — both fail at
construction, typed, with a negated character class and no nested
quantifier, so the pattern cannot backtrack.

**`commentStyle` is required on a `SectionId`, with no default.** A
defaulted style means a caller who forgets it writes `#` markers into a
TypeScript file — a syntax error in the user's file, produced silently by
an omitted argument.

**The key is stored, rendered and compared verbatim, case-sensitively.**
Rendering verbatim and matching exactly go together: an uppercasing
renderer with case-sensitive keys would let two distinct keys produce one
marker, and an uppercasing transformation on the schema would break the
encoded-side round trip the kit's schema standards require. This is the
migration hazard for anyone porting from a predecessor whose marker
formatting normalized case: the emitted markers match nothing on disk,
`check` reports every section absent, and `sync` appends a second copy of
every block beside the original — silent duplication, no compile error,
caught only by round-tripping real files. The fix is one documented line
at id construction: declare exactly the key already on disk.

**No custom `Equal`/`Hash`.** A predecessor compared normalized content —
trimmed and whitespace-collapsed — which is a silent-no-op generator: a
template change that only alters indentation compares equal, reports
`Unchanged`, and never reaches the file. Structural equality is used
instead, over content and marker attributes, neither of which is
identity, with exactly one normalization (line endings) that exists to
preserve idempotency rather than defeat drift detection.

## The dialect owns the marker vocabulary

`SectionDialect` carries the marker phrase and the set of comment styles
the scanner recognizes. The style set lives on the dialect because
reconciliation must recognize sections it does not own — a foreign tool's
block in the same file is preserved verbatim and must not be mistaken for
prose — and that set cannot be derived from the declared sections alone,
since a foreign block's style may appear nowhere in the caller's input.

A declared section whose comment style the dialect does not recognize
fails typed, rather than being written into a document where the scanner
will never find it again, which is how a file grows a duplicate block on
every run.

Marker injection is refused, not written. If a section's content contains
a line the scanner would read as a marker, rendering it produces a
document that re-parses into a different set of sections — the block
boundary moves and the next sync eats user content — so `render` fails
typed. Regex construction is escaped throughout: prefix, suffix and phrase
are all caller-supplied and all reach the scanning pattern, escaped before
interpolation. The compiled pattern is anchored per line, uses a bounded
key character class, contains no nested quantifier, and is memoized per
dialect instance.

## Attributes ride the BEGIN marker

A `BEGIN` marker may carry `name="value"` pairs between the phrase and the
closing rule; an `END` never carries any. They exist for the one thing
content cannot do: say something a later run can act on without opening
the block. The motivating case is a stamp identifying which run last wrote
a region, read to decide whether writing again is allowed at all.

**Attributes participate in equality but never in identity.** Identity
stays key plus comment style, so an attribute change updates the block in
place — the alternative orphans the existing block and appends a second
one. Equality includes attributes, so changing only an attribute is real
drift that reaches the file.

**`attributes` is an always-present record, not an optional key.** A
section parsed from a bare marker (field absent) and a section declared
with `{}` compare unequal under class equality if attributes were
optional, so a consumer that never uses attributes would see permanent
drift against every marker already on disk.
`Schema.withConstructorDefault` fills the canonical empty record on both
sides, and the scanner omits the field rather than passing `undefined`, so
the default fires; omitting the field and passing `{}` are the same
section.

**Emission is insertion-ordered; equality is not.** A rewrite renders
pairs in the record's insertion order, while record equality is
order-insensitive, so a marker a human reordered by hand carrying the same
pairs is `Unchanged` and is left alone.

**The grammar is deliberately small and has no escaping.** Names match
`[A-Za-z][A-Za-z0-9_-]*` — a leading digit, underscore or dash is refused,
which is also what makes a `__proto__`-shaped name unrepresentable — and
values are double-quoted and may contain neither `"` nor a line break. No
escape mechanism, by design: an escape grammar is a second parser hiding
inside the first. A violation fails typed at render (`SectionRenderError`,
reason `invalidAttribute`, naming the attribute), not at construction,
because attribute names and values are runtime data.

**The scanner reads the run as one loose group and validates it
separately.** A repeated capture group would keep only its last pair, so
the marker pattern captures the whole run lazily under a once-only
optional group, and `internal/attributes.ts` parses that capture
afterwards through a hand-rolled character walk rather than a second
regex: the natural re-validation is an anchored `(pair)(sep pair)*$`
pattern, and that shape backtracks polynomially on an adversarial
near-miss run coming off an untrusted, unbounded-length document line. The
hand-rolled walk touches each character exactly once, so a megabyte of
hostile line costs a megabyte of work.

**Compatibility is one-way.** A current scanner reads an old unattributed
marker as it always did, but a scanner predating this feature does not
recognize an attributed marker at all — the line falls out as ordinary
content, and the block it opened stops being a managed section. Writing
attributes into a file that other tooling also manages is a decision, not
a free addition.

## Reconciliation

`reconcile` is the whole algorithm; the single-section paths are it with
one element, because two entry points that re-derive the same ordering
will drift. See `packages/templates/src/internal/reconcile.ts`:

1. Scan the document into an alternating list of text spans (preserved
   verbatim) and section placeholders.
2. Compute each declared section's outcome by content — absent, equal,
   different — returned in declared order, one per declared section.
3. Reassign the declared sections that already exist into the existing
   slots, in declared order over slots in document order. This updates
   content in place and normalizes ordering.
4. Place a declared section that does not exist yet before the nearest
   present successor sibling, else after the nearest present predecessor,
   else append at the end.
5. Render: text spans verbatim, foreign sections as their exact source
   bytes, declared sections canonically.
6. Write only if the rendered text differs from the source.

**Ordering normalization is a contract, not a side effect.** It is what
lets a consumer say "the preamble block must precede the tool block" by
listing them in that order and have it be true even in a file a user
reordered by hand.

**Ambiguity fails; it is not resolved silently.** An unterminated `BEGIN`,
an orphaned `END`, overlapping spans, and a duplicate identity all fail
typed with the offending line. A predecessor skipped an unterminated
marker and picked the first `BEGIN`/`END` pair by `indexOf`, both silent
wrong answers with a file-corrupting tail: a skipped marker means the next
write appends a second copy of the section, and a duplicate means every
sync updates the first copy while the stale second stays on disk forever.
A malformed document is malformed input, so it fails through `E` and the
user fixes their file.

The algorithm is a bounded linear pass rather than a recursion, so the
nesting-depth cap that governs the format packages has no analogue here.

## Line endings are a first-class invariant

This section is the origin of the kit-wide
[line-endings-first-class convention](../conventions/line-endings-first-class.md);
any future file-rewriting package should read that convention rather than
rediscovering the rule.

An LF-only implementation fails silently in both directions: a
`$`-anchored scan under `m` leaves the `\r` inside the line, so markers in
a CRLF file never match and every sync appends a fresh block below the
ones it could not see.

- The document's dominant EOL is detected at parse and exposed; markers
  and inserted separators render with it, and a new file uses `\n`.
- Drift comparison is EOL-normalized, on both the parsed side (at scan
  time) and the declared side (in `check`/`reconcile`) — not inside
  equality, since putting it in a custom `Equal` would make
  `Equal.equals` dishonest for a consumer comparing two sections directly.
  Dropping either side means a CRLF document, or a caller supplying CRLF
  content, reports drift and rewrites forever.
- A trailing-newline-free file stays trailing-newline-free unless a
  section is appended, and a BOM is preserved.
- Rendering wraps content in one EOL on each side and parsing strips
  exactly one from each side, so `""` and `"a\n"` both survive a round
  trip.

The scanner's trailing `\r` is a lookahead, not a consumed character: if
the match consumed it, the section's span would contain a CR the
canonical render never re-emits, and the document would never reach a
fixed point.

## The service

`ManagedSection` reads, runs the pure core, and writes back only when the
text changed — a no-op write churns mtimes and makes every sync look like
a change to a file watcher. Its shape is an exported interface, so a
consumer can type a function against it without naming the service class.
`layer` resolves `FileSystem` once at construction, so every member's `R`
is `never`; `layerWith(options)` is the parameterized variant spelled as a
distinct name so the zero-config `layer` stays a const and memoizes by
reference.

- **No `Fn.dual` on any member.** The subject is a `path`, and nothing
  pipes a path; dual also fights the house test pattern, since an
  override in `layerTest(overrides: Partial<Shape>)` against a dual
  member must satisfy both overloads and the natural one-line stub does
  not typecheck.
- **`checkAll` / `readAll` exist** because consumers check several blocks
  in one file and would otherwise read it once per block.
- **No `exists`-then-read.** Probing and then reading is two syscalls and
  a TOCTOU window; the service reads once and maps not-found to an absent
  document. A missing file is not an error — read, check and probe treat
  it as empty, and sync creates it.
- **A read failure is never swallowed.** A predecessor answered `false`
  for an unreadable file, indistinguishable from a file with no section —
  exactly how a permissions problem becomes a duplicate block on the next
  sync. Here a missing file is `false` and an unreadable one fails typed.

Only `parse` gets the `Result` primitive plus `Effect` twin pair, because
only `parse` is a public boundary a consumer would want as an `Effect`;
`reconcile`, `check`, `read` and `remove` are instance methods on an
already-parsed document and their `Effect` form *is* the service.

## Errors and outcomes

Three typed errors, each defined in the module of the concept that raises
it, none carrying a `reason: string`. `SectionParseError` names the
ambiguity and the 1-based line (with the path filled in by the service,
since the pure core has none); `SectionRenderError` names the refusal
(marker in content, unrecognized comment style, duplicate declaration,
invalid attribute — the last carrying the offending attribute's name);
`SectionFileError` carries `path`, `operation` and the underlying
`PlatformError` structurally, because which half of a read-modify-write
failed is what a consumer needs.

The outcomes are `Data.TaggedEnum`s rather than a `Schema.Union`: they are
in-memory answers a caller immediately `$match`es on. `CheckOutcome` is
flat — `Absent` | `UpToDate` | `Drifted` — because a `Found({ isUpToDate,
diff })` shape is two sources of truth for one question. No diff is
shipped: a set-difference diff dedupes, ignores order and reports a pure
reordering as no change at all, and an honest one means an LCS engine,
while every consumer call site reads only the outcome's tag. The outcomes
carry `before`/`after` sections instead, so a real diff can be added later
without breaking anyone.

## Observability

`Effect.fn` names on the service's public fallible boundaries and on
`SectionDocument.parse`, annotated with `path` and `key` only. Never
content — a managed section can hold a token-bearing command line, and
content is precisely what ends up in a trace exporter. No logging and no
metrics.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`,
integration under `__test__/integration/`.

The pure suites need no layers at all — plain `it` plus `assert` over
string literals. The invariants worth mutation-proving are idempotency
(property-tested), text preservation (every byte outside a declared span
survives, in order), the parse/render round trip, the full scenario set
re-run against CRLF fixtures, marker-injection refusal asserted on both
the failure and the document being unmodified, and each ambiguity failing
typed.

The service suite runs on a real in-memory volume
(`@effected/memfs`, a devDependency) built fresh per test and provided at
the test boundary, because the volume is mutable and a suite-level layer
cannot vary per test. Three things about that fixture generalize:

- **Assertion timing dictates the constructor family.** The pair is built
  eagerly with `makeHandle` and wrapped in `Layer.succeed`, not
  `layerWith` — a memfs layer re-seeds a fresh volume on every
  `Effect.provide`, which would leave assertions running after the
  provide reading a volume nobody wrote to.
- **The write counter is a fault handler that declines**, so the write is
  counted and really happens. A stub body that swallowed it would leave
  every later read reporting pre-write contents.
- **The volume exercises a precondition a `Map` double cannot.** This
  package requires `FileSystem` and deliberately not `Path`, so it cannot
  create a parent directory — a `Map` double happily accepts a write into
  a directory that does not exist, while the volume refuses it, and the
  refusal *is* the contract surfacing.

`FileSystem.layerNoop` fails unimplemented members with a typed
`NotFound`, which this package reads as "file absent", so a partial stub
makes every test silently see an empty document — a specific instance of
deny-by-default's cost, and the reason the double is a real volume.

The integration suite justified itself twice: `FileSystem.readFileString`
strips a leading BOM, so reading through it silently deleted a user's BOM
in violation of the text-preservation promise, invisible to any in-memory
double — the service reads `fs.readFile` and decodes with `ignoreBOM:
true`. The suite also covers a genuinely unreadable file, real CRLF bytes
surviving the OS round trip, an unchanged-means-unchanged mtime, and a
read failure that is not `NotFound` (reading a directory), proving the
missing-file degrade is not over-applied.

Two mutation lessons generalize, both the same shape — a test that
exercises only the easy path of a two-path algorithm: dropping EOL
normalization in `check` left the suite green because the CRLF tests
never covered a caller supplying CRLF content, and an ordering property
could not fail because its generated documents contained no pre-existing
sections, so the reassignment path was never exercised.

## Build

`savvy.build.ts` carries the one narrow `_base` suppression for the
synthesized schema-class bases; never widen it, and gate on a cold `pnpm
build --filter @effected/templates` rather than the raw script. An
internal type named on a method of a public class fails the gate even
when marked internal, and demoting it to a named alias does not help —
inlining the shape structurally is the sanctioned fix. `{@link X}` is
ambiguous for a `Data.TaggedEnum`, where one name is both a type and a
const; backticks are the only correct form.

## Consumers

- **`@effected/github-actions`'s `ManagedDocument`** — the in-kit
  consumer, and the one that tested the mechanism-versus-content line as
  a claim rather than a plan. It needed a marker-delimited PR comment or
  check summary whose regions an action rewrites while the human's prose
  survives, which is `SectionDocument` with three parameters fixed: HTML
  comment style, a `MANAGED REGION` phrase, and namespaced wire keys. It
  is a domain fixing of the dialect, not a second engine — the region
  grammar, the line-ending invariant and the idempotence proof all stayed
  here. The consumer wanted the dialect's parameters narrowed, not
  extended — nothing was missing from the mechanism. Marker attributes
  are the one thing a later round *did* find missing: a run stamp
  readable from the marker line so a delayed re-run could see it had been
  overtaken. The mechanism absorbed it as marker syntax with an equality
  rule; the meaning of the pairs, including which keys constitute a
  stamp, stayed entirely with the consumer — see
  [`sectionId` renders verbatim](../gotchas/sectionid-renders-verbatim.md)
  for the migration hazard this raises for a consumer porting an
  existing predecessor.
- **Marketplace and docs tooling** — the wrapped-comment case a
  line-prefix-only predecessor could not represent; managed blocks in
  Markdown.
- Any consumer that writes into a user-owned file. This is the mechanism;
  it has no opinion about what goes in the block.

## Deliberately out of scope

- **Whole-file templating** — rendering an entire file from a template
  plus data, inheritance, partials, an expression language. It joins only
  when a consumer demands a concrete shape.
- **Template content and policy** — every string inside a block, which
  files carry blocks and in what order.
- **A diff engine**, cut with evidence above and additive later.
- **File modes and permissions** — `chmod +x` on a generated hook is the
  consumer's, through `FileSystem` directly.
- **Multi-file orchestration** — a batch API would have to invent a
  failure policy (stop at first? collect?) that only the consumer can
  choose.
- **Git awareness** — whether a managed file is tracked, staged or
  ignored is `@effected/git`'s domain.
- **Locking or concurrency control** — two processes syncing one file
  race, per file, and the caller owns it, the same posture `@effected/git`
  takes for its mutating tier.
