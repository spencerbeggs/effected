---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 95
related:
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - github-actions.md
  - git.md
  - markdown.md
  - walker.md
---

# @effected/templates design

## Overview

`@effected/templates` owns one mechanism: a **managed section** — a delimited `BEGIN`/`END` block inside a file whose surrounding content belongs to the user. A tool owns the block; the user owns everything else; neither destroys the other. The package locates those blocks in a document, decides what changed, and rewrites the document so the tool's blocks say what the tool wants while every byte outside them survives.

The mechanism has two halves and the split is the design's spine. The **pure half** is a text algorithm: parse a string into spans and sections, compare, reconcile a declared set of blocks against what the document already has, render a new string. It takes no `Effect`, does no IO and is testable from a string literal. The **effectful half** is a `ManagedSection` service that reads a file, runs the pure half and writes back when the text actually changed — a shell thin enough that a reviewer can see no business logic is hiding in it. That is one subsystem in two layers, not two subsystems, which is why this doc stays whole.

Scope is managed sections only. Whole-file templating is [deliberately out of scope](#deliberately-out-of-scope).

## Mechanism here, content elsewhere

The package owns marker syntax, parsing, reconciliation, comment styles as a parameterized set, and file IO. It owns **no vocabulary**: what a section's content says, which files carry sections and in what order, and what the section keys are called all belong to the consumer. No vendor naming appears anywhere in the package — the default marker phrase is `MANAGED SECTION` and the doc examples use `example-tool`.

The line matters because it decides, per symbol, whether something belongs here at all. A "shell section definition" is not a shell abstraction, it is a section id with `commentStyle` pre-bound to `#` — one `const` at a consumer's call site, and a consumer-flavored class if it lived here.

## Tier and dependencies

**Boundary tier**, per the [dependency policy](../effect-standards.md#dependency-policy).

- `effect` is the only peer. **No `@effected` edges and no external runtime dependencies.** The pure half imports `Schema`, `Data`, `Option` and `Result`; the service half adds `Context`, `Effect` and `Layer`.
- `FileSystem` arrives in `R` from the consumer's platform layer — the walker / xdg / git pattern, free under [R3](../effect-standards.md#dependency-policy).
- **`Path` is deliberately NOT required.** Paths are opaque strings handed straight to `FileSystem`; this package never joins, resolves or splits one. Requiring `Path` "for symmetry" would be surface a consumer has to satisfy for nothing. If a future member needs to derive a sibling path, `Path` joins `R` then and the change is recorded.
- `@effect/platform-node` is a devDependency, for the integration suite.

No diff engine, no template engine, no `node:` import anywhere.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); see `src/`:

- `CommentStyle.ts` — the `CommentStyle` class and its preset set.
- `SectionDialect.ts` — the marker phrase, the recognized styles, marker rendering, `SectionRenderError`.
- `Section.ts` — `SectionKey`, `SectionId`, `Section`.
- `SectionDocument.ts` — **the pure core**: parse, inspect, reconcile, render; `SectionParseError`.
- `SectionOutcome.ts` — the `SyncOutcome` / `CheckOutcome` unions.
- `ManagedSection.ts` — the `Context.Service`, its layers, `SectionFileError`.
- `internal/scan.ts` — the marker scanner (regex construction and escaping); `internal/reconcile.ts` — the spans and placeholder algorithm.

`SectionOutcome.ts` holds two unions rather than splitting them one per file: they are variants of one concept, share a module and reach nothing heavier than each other — the [grouped-statics carve-out](../effect-standards.md#no-barrel-re-exports) exactly as written.

## The identity rules

**`CommentStyle` is a class, not a literal union.** A two-member `"#" | "//"` union makes every *wrapped* comment format unrepresentable, which is the single largest capability gap a line-prefix-only predecessor had: a managed section in a Markdown README or an XML file needs `<!-- … -->`. Here a style is `{ prefix, suffix? }` **data**, so a consumer with a format nobody anticipated writes its own (`%` for TeX, `(* … *)` for ML) and everything works. The prefix and suffix checks are load-bearing rather than decoration: a newline in a prefix would let a caller inject arbitrary lines into a marker, and an empty prefix would make the scanner match every line. Both fail at construction, typed, per the [input-hardening standard](../effect-standards.md#input-hardening-standards), and the pattern is a negated character class with no nested quantifier, so it cannot backtrack.

**`commentStyle` is required on a `SectionId`, with no default.** A defaulted style means a caller who forgets it writes `#` markers into a TypeScript file — a syntax error in the user's file, produced silently by an omitted argument.

**The key is stored, rendered and compared verbatim, case-sensitively.** Rendering verbatim and matching exactly go together: an uppercasing renderer with case-sensitive keys would let two distinct keys produce one marker, and an uppercasing *transformation* on the schema would break the encoded-side round trip the [schema standards](../effect-standards.md#schema-standards) require. A file already carrying `SAVVY-LINT` markers is managed by declaring exactly that key. **This is the migration hazard for anyone porting from a predecessor whose marker formatting normalized case:** the emitted markers match nothing on disk, `check` reports every section absent and `sync` appends a second copy of every block beside the original — silent duplication, no compile error, and only round-tripping real files catches it. The fix is one documented line at id construction.

**No custom `Equal`/`Hash`.** A predecessor compared *normalized* content — trimmed and whitespace-collapsed — which is a silent-no-op generator: a template change that only alters indentation compares equal, reports `Unchanged` and never reaches the file. Structural equality is used instead, with exactly one normalization ([line endings](#line-endings-are-a-first-class-invariant)) that exists to *preserve* idempotency rather than defeat drift detection. Schema-class equality recurses into nested class fields deeply, which was probed before any comparison code was written: the discriminating case is that the same key with a *different* `CommentStyle` compares `false`, so `syncAll` cannot silently merge two different-language blocks.

## The dialect owns the marker vocabulary

`SectionDialect` carries the marker phrase and the set of comment styles the scanner recognizes. **The style set lives on the dialect because reconciliation must recognize sections it does not own** — a foreign tool's block in the same file is preserved verbatim and must not be mistaken for prose — and that set cannot be derived from the declared sections alone, since a foreign block's style may appear nowhere in the caller's input.

The corollary is a fail-loud guard: **a declared section whose comment style the dialect does not recognize fails typed**, rather than being written into a document where the scanner will never find it again, which is how a file grows a duplicate block on every run.

**Marker injection is refused, not written.** If a section's content contains a line the scanner would read as a marker, rendering it produces a document that re-parses into a *different* set of sections — the block boundary moves and the next sync eats user content. `render` fails typed. Content is caller-supplied, and a template interpolating a user string is one substitution away from corrupting the file; this is the package's one genuine integrity guard.

**Regex construction is escaped.** Prefix, suffix and phrase are all caller-supplied and all reach the scanning pattern; every one is escaped before interpolation. The compiled pattern is anchored per line, uses a bounded key character class and contains no nested quantifier, so scanning is linear in document length, and it is memoized per dialect instance.

## Reconciliation

`reconcile` is the whole algorithm; the single-section paths are it with one element, because two entry points that re-derive the same ordering will drift ([P2](../formatter-convention.md#the-rules)). See `src/internal/reconcile.ts`:

1. Scan the document into an alternating list of **text spans** (preserved verbatim) and **section placeholders**.
2. Compute each declared section's outcome by content — absent, equal, different — returned in **declared order, one per declared section**.
3. Reassign the declared sections that already exist into the existing slots, **in declared order over slots in document order**. This updates content in place *and normalizes ordering*.
4. Place a declared section that does not exist yet **before the nearest present successor sibling**, else after the nearest present predecessor, else append at the end.
5. Render: text spans verbatim, foreign sections as their exact source bytes, declared sections canonically.
6. Write only if the rendered text differs from the source.

**Ordering normalization is a contract, not a side effect.** It is what lets a consumer say "the preamble block must precede the tool block" by listing them in that order and have it be true even in a file a user reordered by hand. A consumer will depend on it.

**Ambiguity fails; it is not resolved silently.** An unterminated `BEGIN`, an orphaned `END`, overlapping spans and a duplicate identity all fail typed with the offending line. A predecessor skipped an unterminated marker and picked the first `BEGIN`/`END` pair by `indexOf`, both silent wrong answers with a file-corrupting tail: a skipped marker means the next write appends a **second** copy of the section, and a duplicate means every sync updates the first copy while the stale second stays on disk forever. Under the [failure-versus-defect boundary](../effect-standards.md#input-hardening-standards) a malformed document is malformed *input*, so it fails through `E` and the user fixes their file. Declaring one identity twice in a **single call** fails the same way, on the same argument: two intentions for one block, and any choice between them is a guess.

The algorithm is a bounded linear pass rather than a recursion, so the [nesting-depth cap](../effect-standards.md#input-hardening-standards) that governs the format packages has no analogue here. The hardening surface is the regex construction and the marker-injection guard, both above.

## Line endings are a first-class invariant

An LF-only implementation fails silently in both directions: a `$`-anchored scan under `m` leaves the `\r` inside the line, so markers in a CRLF file never match and every sync appends a fresh block below the ones it could not see.

- The document's **dominant** EOL is detected at parse and exposed; markers and inserted separators render with it, and a new file uses `\n`.
- **Drift comparison is EOL-normalized**, and this is the load-bearing half: a consumer supplying LF content against a CRLF file would otherwise report drift, rewrite and report drift again forever. Normalization happens at parse time and on the declared side in `check`/`reconcile`, **not** inside equality — putting it in a custom `Equal` would make `Equal.equals` dishonest for a consumer comparing two sections directly.
- A trailing-newline-free file stays trailing-newline-free unless a section is appended, and a BOM is preserved.
- Rendering wraps content in one EOL on each side and parsing strips exactly one from each side, so `""` and `"a\n"` both survive a round trip. A property test pins that rather than a comment.

## The service

`ManagedSection` reads, runs the pure core and writes back **only when the text changed** — a no-op write churns mtimes and makes every sync look like a change to a file watcher. Its shape is an **exported interface**, following [`GitShape`](git.md#git--the-service-read-tier), so a consumer can type a function against it without naming the service class. `layer` resolves `FileSystem` once at construction, so every member's `R` is `never`; `layerWith(options)` is the parameterized variant spelled as a distinct name so the zero-config `layer` stays a **const** and memoizes by reference.

Four shape decisions are deltas worth keeping:

- **No `Fn.dual` on any member.** Dual earns its cost when the subject is what you pipe; here the subject is a `path`, and nothing pipes a path. It also fights the house test pattern, since an override in `layerTest(overrides: Partial<Shape>)` against a dual member must satisfy both overloads and the natural one-line stub does not typecheck. Dual stays available on the pure surface if a consumer asks.
- **`checkAll` / `readAll` exist** because consumers check several blocks in one file and would otherwise read it once per block. One read, several pure comparisons, race-free.
- **No `exists`-then-read.** Probing and then reading is two syscalls and a TOCTOU window; the service reads once and maps not-found to an absent document. **A missing file is not an error** — read, check and probe treat it as empty, and sync creates it.
- **A read failure is never swallowed.** A predecessor answered `false` for an unreadable file, indistinguishable from a file with no section, which is exactly how a permissions problem becomes a duplicate block on the next sync. Here a missing file is `false` and an unreadable one **fails typed**.

Only `parse` gets the `Result` primitive plus `Effect` twin pair, because only `parse` is a public boundary a consumer would want as an `Effect`; `reconcile`, `check`, `read` and `remove` are instance methods on an already-parsed document and their `Effect` form *is* the service. Adding twins would mint dead surface — recorded so a later reviewer does not "complete the pattern".

## Errors and outcomes

Three typed errors, each defined in the module of the concept that raises it, none carrying a `reason: string` — see `src/`. `SectionParseError` names the ambiguity and the 1-based line (with the path filled in by the service, since the pure core has none); `SectionRenderError` names the refusal (marker in content, unrecognized comment style, duplicate declaration); `SectionFileError` carries `path`, `operation` and the underlying `PlatformError` **structurally** rather than stringified, because which half of a read-modify-write failed is what a consumer needs and a bare `PlatformError` does not say.

Use `Schema.Literals`, never the variadic `Schema.Literal`: the variadic form silently ignores every argument after the first, quietly narrowing a union to its first member (recorded in [walker.md](walker.md)).

The outcomes are `Data.TaggedEnum`s rather than a `Schema.Union`: they are in-memory answers a caller immediately `$match`es on, and the constructor / `$is` / `$match` ergonomics are the point. `CheckOutcome` is flat — `Absent` | `UpToDate` | `Drifted` — because a `Found({ isUpToDate, diff })` shape is two sources of truth for one question and forces every consumer through a nested branch. **No diff is shipped**: a set-difference diff dedupes, ignores order and reports a pure reordering as no change at all, and an honest one means an LCS engine, while every consumer call site reads only the outcome's tag. The outcomes carry `before`/`after` sections instead, so a real diff can be added later without breaking anyone.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards) and the same posture as [git](git.md#observability): `Effect.fn` names on the service's public fallible boundaries and on `SectionDocument.parse` (its `parseResult` is the unwrapped primitive), annotated with `path` and `key` only. **Never content** — a managed section can hold a token-bearing command line, and content is precisely what ends up in a trace exporter. No logging and no metrics.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`, integration under `__test__/integration/`.

**The pure suites need no layers at all** — plain `it` plus `assert` over string literals. That is the split paying for itself: the reconciliation scenarios that would cost a filesystem are string-to-string assertions here. The invariants worth mutation-proving are idempotency (property-tested), **text preservation** (every byte outside a declared span survives, in order — the property a scenario test is worst at proving), the parse/render round trip, the full scenario set re-run against CRLF fixtures, marker-injection refusal asserted on both the failure *and* the document being unmodified, and each ambiguity failing typed.

**The service suite runs on an in-memory `FileSystem`** built fresh per test and provided at the test boundary, because the fake is mutable and a suite-level layer cannot vary per test. Two traps recorded: `FileSystem.layerNoop` fails **unimplemented** members with a typed `NotFound`, which this package reads as "file absent" — so the double must implement `readFile`, the method the service actually calls, or every test silently sees an empty document; and every fake operation is `Effect.suspend`-wrapped so it observes the map as of when the effect runs.

**The integration suite is what justified itself twice.** `FileSystem.readFileString` **strips a leading BOM**, so reading through it silently deleted a user's BOM — a direct violation of the text-preservation promise, invisible to any in-memory double. The service reads `fs.readFile` and decodes with `ignoreBOM: true`. The suite also covers a genuinely unreadable file, real CRLF bytes surviving the OS round trip, an unchanged-means-unchanged mtime, and a read failure that is *not* `NotFound` (reading a directory), which proves the missing-file degrade is not over-applied.

Two mutation lessons generalize: dropping EOL normalization in `check` left the suite green because the CRLF tests never covered a *caller* supplying CRLF content, and the ordering property could not fail because its generated documents contained no pre-existing sections, so the reassignment path — where ordering normalization lives — was never exercised. Both are the same shape: **a test that exercises only the easy path of a two-path algorithm.** That is the thing to look for when mutating this package.

## Build

`savvy.build.ts` carries the one narrow `_base` suppression for the synthesized schema-class bases ([effect-api-extractor-bases](../effect-standards.md#api-extractor--effect-class-factories)); never widen it, and gate on a cold `pnpm build --filter @effected/templates` rather than the raw script. Two boundary lessons: an internal type named on a method of a public class fails the gate even when marked internal, and demoting it to a named alias does not help — **inlining the shape structurally** is the sanctioned fix. And `{@link X}` is ambiguous for a `Data.TaggedEnum`, where one name is both a type and a const; backticks are the only correct form.

## Consumers

- **[`@effected/github-actions`](github-actions.md)' `ManagedDocument`** — the in-kit consumer, and the one that tested the mechanism-versus-content line as a claim rather than a plan. It needed a marker-delimited PR comment or check summary whose regions an action rewrites while the human's prose survives, which is `SectionDocument` with three parameters fixed: HTML comment style, a `MANAGED REGION` phrase and namespaced wire keys. **It is a domain fixing of the dialect, not a second engine** — the region grammar, the line-ending invariant and the idempotence proof all stayed here, which is the outcome the split was designed for. Worth recording that the consumer wanted the dialect's parameters *narrowed*, not extended: nothing was missing from the mechanism.
- **Marketplace and docs tooling** — the wrapped-comment case a line-prefix-only predecessor could not represent; managed blocks in Markdown.
- Any consumer that writes into a user-owned file. This is the mechanism; it has no opinion about what goes in the block.

## Deliberately out of scope

- **Whole-file templating** — rendering an entire file from a template plus data, inheritance, partials, an expression language. It joins only when a consumer demands a concrete shape, and the concrete shape is the point: a speculative templating API gets designed twice.
- **Template content and policy** — every string inside a block, which files carry blocks and in what order.
- **A diff engine**, cut with evidence above and additive later.
- **File modes and permissions** — `chmod +x` on a generated hook is the consumer's, through `FileSystem` directly.
- **Multi-file orchestration** — a batch API would have to invent a failure policy (stop at first? collect?) that only the consumer can choose.
- **Git awareness** — whether a managed file is tracked, staged or ignored is [`@effected/git`](git.md)'s domain.
- **Locking or concurrency control** — two processes syncing one file race, per file, and the caller owns it, the same posture `@effected/git` takes for its mutating tier.
