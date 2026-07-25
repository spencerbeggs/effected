---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 92
related:
  - ../effect-standards.md
  - ../roadmap.md
  - ../formatter-convention.md
  - ../../plans/2026-07-25-github-split-master.md
  - walker.md
  - git.md
  - markdown.md
---

# @effected/templates design

## Overview

`@effected/templates` owns one mechanism: a **managed section** — a delimited `BEGIN`/`END` block inside a file whose surrounding content belongs to the user. A tool owns the block; the user owns everything else; neither destroys the other. The package's job is to locate those blocks in a document, decide what changed, and rewrite the document so the tool's blocks say what the tool wants while every byte outside them survives.

The mechanism has two halves and the split is the design's spine. The **pure half** is a text algorithm: parse a string into spans and sections, compare, reconcile a declared set of blocks against what the document already has, render a new string. It takes no `Effect`, does no IO and is testable from a string literal. The **effectful half** is a `ManagedSection` service that reads a file, runs the pure half, and writes the file back when the text actually changed — a shell thin enough that a reviewer can see there is no business logic hiding in it.

v1 scope is **managed sections only**, per [roadmap.md](../roadmap.md#effectedtemplates). Whole-file templating is [deliberately out of scope](#deliberately-out-of-scope).

The package is ported from `@savvy-web/silk-effects`' `ManagedSection` service (`src/services/ManagedSection.ts`, plus `SectionBlock`, `SectionDefinition`, `CommentStyle` and `SectionResults`), which is Phase 1b of the [GitHub/Actions split](../../plans/2026-07-25-github-split-master.md). It is a **mechanism port, not a package move** — see [Division of labor](#division-of-labor-mechanism-here-content-elsewhere).

## Division of labor: mechanism here, content elsewhere

**`@effected/templates` owns the mechanism. `@savvy-web/templates` owns the content and the policy.** The line is not negotiable and it decides, per symbol, whether a thing ports.

| Concern | Home | Why |
| --- | --- | --- |
| Marker syntax, parsing, reconciliation, file IO | `@effected/templates` | Domain-free text mechanics |
| Comment styles as a parameterized set | `@effected/templates` | Mechanics; the *choice* is the consumer's |
| What a section's content says | `@savvy-web/templates` | Policy — shell preambles, hook bodies, tool invocations |
| Which files carry sections, and in what order | `@savvy-web/templates` | Policy — `.husky/pre-commit`, config paths |
| Section keys (`savvy-base`, `savvy-lint`, …) | `@savvy-web/templates` | Vocabulary |

Concretely, from the v3 package: `SavvySections.ts` (`SavvyBaseSection`, `SavvyHooksSection`, `savvyBasePreamble`, `savvyHooksHygiene`, `savvyToolSection`), `ShellSectionDefinition`, `lint/cli/sections.ts`'s hook paths and every `SAVVY-*` key **do not port in any form**. `ShellSectionDefinition` is the interesting one: it is not a shell abstraction, it is "`SectionId` with `commentStyle` pre-bound to `#`", which is one `const` at the consumer's call site and a silk-flavored class here.

**No silk vocabulary appears in this package** — not in a type name, not in a default, not in a doc comment example. The default marker phrase is `MANAGED SECTION`, not `SAVVY MANAGED SECTION`, and the doc examples use `example-tool`.

## Tier and dependencies

**Boundary tier**, per the [dependency policy](../effect-standards.md#dependency-policy). Confirmed, not provisional:

- `peerDependencies: { effect }`. **No `@effected` edges and no external runtime dependencies.** The pure half imports `Schema`, `Data`, `Option` and `Result`; the service half adds `Context`, `Effect` and `Layer`.
- `FileSystem` arrives in the `R` channel from the consumer's platform layer — the walker/xdg/git pattern. Requiring a core-declared service in `R` costs a consumer nothing ([R3](../effect-standards.md#dependency-policy)).
- **`Path` is NOT required.** Paths are opaque strings handed straight to `FileSystem`; this package never joins, resolves or splits one. Requiring `Path` "for symmetry" would be surface a consumer has to satisfy for nothing. If a future member needs to derive a sibling path, `Path` joins `R` then and the change is recorded.
- `@effect/platform-node` is a **devDependency only**, for the integration suite. devDependencies never count toward tier.

No diff engine, no template engine, no `node:` import anywhere.

## The pure core / effectful edge split

The v3 service put the entire algorithm inside `Layer.effect`'s closure, interleaved with `fs.exists`/`fs.readFileString`/`fs.writeFileString`. That is why its hardest logic — the `syncMany` reconciliation, ~90 lines of span juggling — could only be tested by writing files. Every scenario test in the v3 suite pays for a filesystem to assert a string transformation.

The v4 shape inverts it:

```text
                 pure, no Effect, no IO
  string ──► SectionDocument.parseResult ──► SectionDocument
                                                  │
                                    ┌─────────────┼──────────────┐
                                 read/has       check         reconcile / remove
                                    │             │                │
                                Option<Section> CheckOutcome   SectionReconciliation
                                                                { text, outcomes }
                 ────────────────────────────────────────────────────────
                 effectful edge: ManagedSection reads the file, calls the
                 above, writes back only when `text` differs
```

Three properties follow, and they are the reason for the split:

1. **Every interesting invariant is a string→string property.** Idempotency, text preservation, ordering normalization, CRLF handling and marker-injection refusal are all asserted against string literals with zero layers.
2. **The service has one branch worth reviewing** — "did the text change?" — and everything else is delegation.
3. **The pure half is usable without a runtime.** A synchronous consumer (a lint-staged handler, per [C1 of the formatter convention](../formatter-convention.md#the-driving-constraint)) can parse and reconcile without building an `Effect` runtime.

This follows [decision 6](../formatter-convention.md#decision-6--the-sync-primitive-policy): pure computation exposes the sync form as the primitive. **One deliberate scoping note:** only `parse` gets the `*Result` + `Effect` twin pair, because only `parse` is a public boundary a consumer would otherwise want as an `Effect`. `reconcile`, `check`, `read` and `remove` are instance methods on an already-parsed document, returning `Result`/`Option`/a total value with **no `Effect` twin** — their `Effect` form is the `ManagedSection` service. Adding twins would mint dead surface. Recorded so a later reviewer does not "complete the pattern".

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

```text
packages/templates/
  src/
    CommentStyle.ts      # CommentStyle class + the preset set
    SectionDialect.ts    # marker phrase + recognized styles; marker rendering; SectionRenderError
    Section.ts           # SectionKey (branded), SectionId, Section
    SectionDocument.ts   # THE PURE CORE: parse, inspect, reconcile, render; SectionParseError
    SectionOutcome.ts    # SyncOutcome / CheckOutcome unions
    ManagedSection.ts    # the Context.Service, its layers, SectionFileError
    index.ts             # re-exports only
    internal/
      scan.ts            # the marker scanner (regex construction + escaping)
      reconcile.ts       # the spans/placeholder algorithm
  __test__/
    CommentStyle.test.ts
    SectionDialect.test.ts
    SectionDocument.test.ts
    SectionDocument.reconcile.test.ts
    SectionDocument.prop.test.ts
    ManagedSection.test.ts
    fixtures.ts                        # the in-memory FileSystem double
    integration/ManagedSection.int.test.ts
```

`SectionOutcome.ts` holds two unions rather than splitting them one-per-file: they are variants of one concept (what happened to a section), share a module, and reach nothing heavier than each other — the [grouped-statics carve-out](../effect-standards.md#no-barrel-re-exports) exactly as written.

## Public surface

### `CommentStyle` — a class, not a literal union

v3's `CommentStyle` is `Schema.Literals(["#", "//"])`. Two styles, both **line prefixes**, which silently makes every wrapped-comment format unrepresentable: a managed section in a Markdown README or an XML/HTML file needs `<!-- … -->`, and there is no way to spell it. That is the single largest capability gap in the v3 mechanism and the marketplace/docs consumers hit it directly.

```ts
export class CommentStyle extends Schema.Class<CommentStyle>("CommentStyle")({
  /** Opens the comment. Non-empty, no newline. */
  prefix: Schema.String.check(Schema.isPattern(/^[^\r\n]+$/)),
  /** Closes the comment, for wrapped styles. Omitted for line styles. */
  suffix: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[^\r\n]+$/))),
}) {
  static readonly hash: CommentStyle;       // #
  static readonly slash: CommentStyle;      // //
  static readonly semicolon: CommentStyle;  // ;
  static readonly dash: CommentStyle;       // --
  static readonly html: CommentStyle;       // <!-- … -->
  static readonly block: CommentStyle;      // /* … */
  static readonly presets: ReadonlyArray<CommentStyle>;

  /** Stable identity for keying; never rendered. */
  get id(): string;
}
```

**Open, not closed.** A consumer with a format nobody anticipated writes `CommentStyle.make({ prefix: "%" })` (TeX) or `CommentStyle.make({ prefix: "(*", suffix: "*)" })` (ML) and everything works. Extensibility is free here because the styles are *data*, not code paths.

The `isPattern` checks are load-bearing, not decoration: a prefix containing a newline would let a caller inject arbitrary lines into the marker, and an empty prefix would make the scanner match every line. Both fail at construction, typed, per the [input-hardening standard](../effect-standards.md#input-hardening-standards). The pattern is a negated character class with no nested quantifier, so it cannot backtrack.

`presets` is a grouped static array on a module that reaches nothing — the `MergeStrategy` / `ConfigResolver` carve-out, not a namespace-object violation. Nothing sits behind a preset except a two-field object.

### `SectionKey`, `SectionId`, `Section`

```ts
/** `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, branded. */
export type SectionKeyBrand = string & Brand.Brand<"SectionKey">;
export const SectionKey: Schema.Codec<SectionKeyBrand, string>;

/** What identifies a section inside a document. */
export class SectionId extends Schema.Class<SectionId>("SectionId")({
  key: SectionKey,
  commentStyle: CommentStyle,   // required — see below
}) {
  /** Build a `Section` for this identity. */
  section(content: string): Section;
  // As built: `matches` was dropped — identity comparison is `Equal.equals`,
  // which the nested-equality probe confirmed is deep and exact.
}
// MIGRATION WARNING (dogfood round 1): keys render into markers VERBATIM.
// A predecessor whose marker-formatting code normalized case (silk uppercased
// `toolName`) must move that normalization to SectionId construction, or the
// emitted markers match nothing on disk: `check` reports every section absent
// and `sync` appends a second copy of every managed block beside the original.
// Silent duplication, no compile error; only round-tripping real files catches
// it. The downstream fix is one documented line at id construction.

/** An identity plus the content the owner wants in it. */
export class Section extends Schema.Class<Section>("Section")({
  key: SectionKey,
  commentStyle: CommentStyle,
  content: Schema.String,
}) {
  get id(): SectionId;
  withContent(content: string): Section;
}
```

Three decisions:

- **`commentStyle` is required, with no default.** v3 defaults it to `"#"`. A defaulted comment style means a caller who forgets it writes `#` markers into a TypeScript file — a syntax error in the user's file, produced silently by an omitted argument. One word at the call site buys that away.
- **The key is stored, rendered and compared verbatim** (ruled 2026-07-25; this reverses the case-insensitive proposal originally drafted here). A file already carrying `SAVVY-LINT` markers is managed by declaring the key `"SAVVY-LINT"`. Rendering verbatim and matching exactly go together: an uppercasing renderer with case-sensitive keys would let two distinct keys produce one marker, and an uppercasing *transformation* on the schema would break the encoded-side round-trip the [schema standards](../effect-standards.md#schema-standards) require. If adoption ever hits a genuinely mixed-case corpus, a normalization option is the additive fix.
- **`read` returns the caller's key, not the on-disk spelling.** `read(path, id)` answers with `id.key`; returning the file's casing would make `Equal.equals(read(...), expected)` fail for a purely cosmetic difference.

**No custom `Equal`/`Hash`.** v3 overrode both on `SectionBlock` to compare *normalized* content — trimmed and whitespace-collapsed. That is a silent-no-op generator: a template change that only alters indentation compares equal, reports `Unchanged`, and never reaches the file. v4 uses the schema class's structural equality, with exactly one normalization, [line endings](#line-endings-are-the-invariant-v3-did-not-have), which exists to *preserve* idempotency rather than defeat drift detection.

**Dropped from v3:** `prepend`/`append` (content shaping the consumer can do with `+`, used by nothing but their own tests), `withValidation` (a predicate that makes `block()` **throw** — a defect where a typed failure belongs, and content policy besides), `generate`/`generateEffect` (a config→content factory, which is template content, i.e. the other package's job), and `SectionDefinition.diff` (a diff between two identities, which is a field comparison).

### `SectionDialect` — the parameterized marker vocabulary

```ts
export class SectionDialect extends Schema.Class<SectionDialect>("SectionDialect")({
  /** The phrase between the key and the closing rule. */
  phrase: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/)),
  /** Which comment styles the document scanner recognizes. */
  styles: Schema.Array(CommentStyle),
}) {
  /** phrase: "MANAGED SECTION"; styles: CommentStyle.presets. */
  static readonly default: SectionDialect;

  beginMarker(id: SectionId): string;
  endMarker(id: SectionId): string;
  render(section: Section, eol?: Eol): Result.Result<string, SectionRenderError>;
  recognizes(style: CommentStyle): boolean;
}
```

Rendered form, unchanged from v3 at the default phrase so existing files keep working:

```text
# --- BEGIN EXAMPLE-TOOL MANAGED SECTION ---
…content…
# --- END EXAMPLE-TOOL MANAGED SECTION ---
```

and for a wrapped style:

```text
<!-- --- BEGIN EXAMPLE-TOOL MANAGED SECTION --- -->
…content…
<!-- --- END EXAMPLE-TOOL MANAGED SECTION --- -->
```

**Why `styles` lives on the dialect.** Reconciliation must recognize sections it does not own — a foreign tool's block in the same file is preserved verbatim and must not be mistaken for prose. That scan needs a set of prefixes to look for, and it cannot be derived from the declared sections alone (a foreign block's style may appear nowhere in the caller's input). The dialect carries it, defaulting to every preset.

The corollary is a fail-loud guard: **a declared section whose comment style the dialect does not recognize fails typed** (`SectionRenderError`, reason `unknownCommentStyle`) rather than being written into a document where the scanner will never find it again — which is how a file grows a duplicate block on every run.

**Marker injection is refused, not written.** If a section's content contains a line that the scanner would read as a marker, rendering it produces a document that re-parses into a *different* set of sections — the block boundary moves, and the next sync eats user content. `render` fails typed with reason `markerInContent`. v3 had no such check; content is caller-supplied, and a template that interpolates a user string is one substitution away from corrupting the file. This is the package's one genuine integrity guard.

**Regex construction is escaped.** `prefix`, `suffix` and `phrase` are all caller-supplied and all end up in the scanning pattern; every one is escaped before interpolation. The compiled pattern is anchored per line (`^…$` under `m`), uses a bounded key character class and contains no nested quantifier, so scanning is linear in document length. The compiled `RegExp` is memoized per dialect instance — a dialect is a long-lived constant and recompiling per call is the sort of thing that only shows up under a profiler.

### `SectionDocument` — the pure core

```ts
export class SectionDocument extends Schema.Class<SectionDocument>("SectionDocument")({
  text: Schema.String,
  dialect: SectionDialect,
}) {
  /** The primitive. */
  static parseResult(text: string, dialect?: SectionDialect):
    Result.Result<SectionDocument, SectionParseError>;

  /** Derived from `parseResult`; adds the span and nothing else. */
  static readonly parse: (text: string, dialect?: SectionDialect) =>
    Effect.Effect<SectionDocument, SectionParseError>;

  /** Every managed section found, in document order. */
  get sections(): ReadonlyArray<PlacedSection>;
  /** The document's dominant line ending. */
  get eol(): Eol;

  read(id: SectionId): Option.Option<Section>;
  has(id: SectionId): boolean;
  check(section: Section): CheckOutcome;                       // total
  reconcile(sections: ReadonlyArray<Section>):
    Result.Result<SectionReconciliation, SectionRenderError>;
  remove(id: SectionId): Option.Option<string>;                // none when absent
}

/** A section as found in a document, with its span. */
export class PlacedSection extends Schema.Class<PlacedSection>("PlacedSection")({
  section: Section,
  start: Schema.Number,   // offset of the begin marker's first character
  end: Schema.Number,     // offset one past the end marker's last character
  line: Schema.Number,    // 1-based line of the begin marker
}) {}

/** The result of reconciling a declared set against a document. */
export class SectionReconciliation extends Schema.Class<SectionReconciliation>("SectionReconciliation")({
  text: Schema.String,
  outcomes: Schema.Array(SyncOutcomeSchema),
}) {
  get changed(): boolean;   // text !== the source document's text
}
```

`reconcile` is the whole algorithm; `write` and `sync` are it with one element. There is no separate single-section write path, because with one declared section the reconciliation and the v3 single-block write agree exactly — and [P2](../formatter-convention.md#the-rules) says two entry points that re-derive the same ordering will drift.

`remove` returns `Option<string>`: `none` when the section was not there (nothing to write), `some(text)` otherwise. Removal collapses the surrounding blank lines into one separator, so repeated removals never accumulate gaps — v3's behavior, kept.

### `ManagedSection` — the service

```ts
export interface ManagedSectionShape {
  readonly read: (path: string, id: SectionId) =>
    Effect.Effect<Option.Option<Section>, SectionParseError | SectionFileError>;
  readonly readAll: (path: string) =>
    Effect.Effect<ReadonlyArray<Section>, SectionParseError | SectionFileError>;
  readonly isManaged: (path: string, id: SectionId) =>
    Effect.Effect<boolean, SectionParseError | SectionFileError>;
  readonly sync: (path: string, section: Section) =>
    Effect.Effect<SyncOutcome, SectionParseError | SectionRenderError | SectionFileError>;
  readonly syncAll: (path: string, sections: ReadonlyArray<Section>) =>
    Effect.Effect<ReadonlyArray<SyncOutcome>, SectionParseError | SectionRenderError | SectionFileError>;
  readonly check: (path: string, section: Section) =>
    Effect.Effect<CheckOutcome, SectionParseError | SectionFileError>;
  readonly checkAll: (path: string, sections: ReadonlyArray<Section>) =>
    Effect.Effect<ReadonlyArray<CheckOutcome>, SectionParseError | SectionFileError>;
  readonly remove: (path: string, id: SectionId) =>
    Effect.Effect<boolean, SectionParseError | SectionFileError>;
}

export class ManagedSection extends Context.Service<ManagedSection, ManagedSectionShape>()(
  "@effected/templates/ManagedSection",
) {
  static readonly layer: Layer.Layer<ManagedSection, never, FileSystem.FileSystem>;
  static layerWith(options: ManagedSectionOptions): Layer.Layer<ManagedSection, never, FileSystem.FileSystem>;
  static makeTest(overrides?: Partial<ManagedSectionShape>): ManagedSectionShape;
  static layerTest(overrides?: Partial<ManagedSectionShape>): Layer.Layer<ManagedSection>;
}

export interface ManagedSectionOptions {
  /** Defaults to `SectionDialect.default`. */
  readonly dialect?: SectionDialect;
}
```

The shape is an **exported interface**, following [`GitShape`](git.md#git--the-service-read-tier): a consumer can type a function against `ManagedSectionShape` without naming the service class, and the surface is a reviewable declaration rather than whatever the implementation returned.

`layer` resolves `FileSystem` once at construction, so every member's `R` is `never`. `layerWith(options)` is the parameterized variant per the [layer-statics rule](../../plans/2026-07-25-github-split-master.md#non-negotiables-kit-wide-from-the-specs-probe-findings--house-standards) (`static layer(options)` spelled as a distinct name so the zero-config `layer` stays a **const**, memoizable by reference; a `layer()` that must be called mints a fresh reference per call and defeats memoization).

Members read, run the pure core, and write back **only when the text changed** — the no-op write is not merely wasteful, it churns mtimes and makes every `sync` look like a change to a file watcher.

#### Deltas from the v3 service shape

- **`Fn.dual` is dropped from every member.** The v3 shape declared 7 dual members, doubling the declared type surface. The evidence against keeping it is direct: **every call site in `savvy-web/systems` uses the data-first form** — `ms.syncMany(path, blocks)`, `ms.check(path, block)`, `ms.remove(path, def)` — and the only data-last usage in the entire source tree is a v3 test named "works with the dual API (data-last)". Dual earns its cost when the subject is what you pipe; here the subject is a `path`, and nothing pipes a path. It also actively fights the house test pattern: an override in `layerTest(overrides: Partial<Shape>)` against a dual member must satisfy both overloads, so the natural one-line stub does not typecheck. Dual stays available on the **pure** surface, where piping a document or a section is natural, if a consumer asks for it.
- **`write` is dropped.** It was `sync` without the report and without the skip; no consumer called it. Removing it removes the "which one do I want?" question and the second ordering implementation.
- **`checkAll` and `readAll` are added.** The v3 consumers check three blocks in one file with three separate reads (`commit/check.ts` reads `.husky/commit-msg` three times). One read, three pure comparisons is both faster and race-free.
- **`syncMany` → `syncAll`**, matching `@effected/toml`'s `applyAll`.
- **No `exists`-then-read.** v3 probes `fs.exists` and then reads — two syscalls and a TOCTOU window in which a file can appear or vanish between them. v4 reads once and maps not-found to an absent document.
- **`isManaged` no longer swallows read errors.** v3 pipes the read through `orElseSucceed(() => "")`, so an unreadable file answers `false` — indistinguishable from a file with no section, which is exactly how a permissions problem becomes a duplicate block on the next sync. v4 answers `false` for a missing file and **fails typed** for an unreadable one.

## Errors

Three typed errors, each defined in the module of the concept that raises it. All are `Schema.TaggedErrorClass`; none carries a `reason: string`.

```ts
// SectionDocument.ts — the pure core's only failure
export class SectionParseError extends Schema.TaggedErrorClass<SectionParseError>()("SectionParseError", {
  reason: Schema.Literals([
    "unterminatedSection",   // BEGIN with no matching END
    "orphanedEnd",           // END with no preceding BEGIN
    "overlappingSections",   // a BEGIN inside another section's span
    "duplicateSection",      // two sections with the same identity
  ]),
  /** 1-based line of the offending marker. */
  line: Schema.Number,
  /** The section key involved, when the failure names one. */
  key: Schema.optionalKey(Schema.String),
  /** Filled in by the service; the pure core has no path. */
  path: Schema.optionalKey(Schema.String),
}) {}

// SectionDialect.ts
export class SectionRenderError extends Schema.TaggedErrorClass<SectionRenderError>()("SectionRenderError", {
  reason: Schema.Literals(["markerInContent", "unknownCommentStyle"]),
  key: Schema.String,
}) {}

// ManagedSection.ts
export class SectionFileError extends Schema.TaggedErrorClass<SectionFileError>()("SectionFileError", {
  path: Schema.String,
  operation: Schema.Literals(["read", "write"]),
  /** The underlying `PlatformError`, preserved structurally. */
  cause: Schema.Defect(),
}) {}
```

`Schema.Literals`, never the variadic `Schema.Literal` — [walker recorded](walker.md#downward-descenderror-the-packages-first-typed-error) that v3's variadic form silently ignores every argument after the first in the beta, quietly narrowing a union to its first member.

Three postures are worth stating because each is a departure:

**Ambiguity fails; it is not resolved silently.** v3's scanner *skips* an unterminated `BEGIN` marker and its `parseContent` picks the *first* `BEGIN`/`END` pair by `indexOf`. Both are silent wrong answers with a file-corrupting tail: a skipped unterminated marker means `write` appends a **second** copy of the section below the broken one, and a duplicate means every sync updates the first copy while the stale second stays on disk forever. Under the [Failure-vs-Defect boundary](../effect-standards.md#input-hardening-standards) a malformed document is malformed *input*, so it fails through `E` with the line number that identifies it, and the user fixes their file. This is the port's most consequential behavior change and the migration note it needs.

**`SectionFileError` wraps rather than leaks `PlatformError`.** The xdg/git precedent: `path` plus `operation` tells a consumer *which* half of a read-modify-write failed, which a bare `PlatformError` does not, and `cause: Schema.Defect()` keeps the original structurally rather than as `String(cause)` — the exact field v3 got wrong in both of its errors.

**A missing file is not an error.** `read`/`check`/`isManaged` treat it as an empty document; `sync`/`syncAll` create it. Only removal of a section from a file that does not exist is a plain `false`.

## Outcomes

```ts
export type SyncOutcome = Data.TaggedEnum<{
  Created: { readonly section: Section };
  Updated: { readonly before: Section; readonly after: Section };
  Unchanged: { readonly section: Section };
}>;
export const SyncOutcome = Data.taggedEnum<SyncOutcome>();

export type CheckOutcome = Data.TaggedEnum<{
  Absent: { readonly id: SectionId };
  UpToDate: { readonly section: Section };
  Drifted: { readonly onDisk: Section; readonly expected: Section };
}>;
export const CheckOutcome = Data.taggedEnum<CheckOutcome>();
```

`Data.TaggedEnum` rather than a `Schema.Union` of `TaggedStruct`s: these are in-memory answers a caller immediately `$match`es on, and the constructor/`$is`/`$match` ergonomics are the whole point. It follows the `JsoncVisitorEvent` / `MarkdownVisitorEvent` precedent; the `ConfigEvent` `Schema.Union` precedent applies to payloads that are *published and serialized*, which these are not. Their members are schema classes, so a consumer who does need to serialize one has the pieces.

Two renames and one cut:

- **`SyncResult` → `SyncOutcome`, `CheckResult` → `CheckOutcome`.** `Result` is `effect`'s own module name and this kit imports it in nearly every package; a domain type called `SyncResult` sitting next to `Result.Result` is a comprehension tax paid on every read.
- **`CheckResult.Found({ isUpToDate, diff })` flattens to `UpToDate` | `Drifted`.** A boolean plus a diff that already encodes the same fact is two sources of truth for one question, and it forces every consumer through a nested branch.
- **No `SectionDiff` in v1.** v3's diff is a *set* difference over lines: it dedupes, ignores order, and reports a pure line reordering as no change at all — a diff that can say "nothing changed" about changed content. Fixing it means shipping an LCS engine. The evidence says do neither: every consumer call site reads only `outcome._tag` (`results.map((r) => r._tag).join(", ")`), and not one renders the diff. So the outcomes carry `before`/`after` **sections**, a consumer who wants a rendering uses a diff library, and a real diff can be added later without breaking anyone.

## Line endings are the invariant v3 did not have

v3 is LF-only, and the failure is silent in both directions. Its scanning regex anchors with `$` under `m`, which matches before `\n` but leaves a `\r` inside the line — so `--- ---\r` never matches and **managed sections simply do not work in a CRLF file**: every sync appends a fresh block below the ones it could not see.

v1 makes line endings a first-class invariant:

- The document's **dominant** EOL is detected at parse (`\r\n` if any CRLF is present, else `\n`) and exposed as `doc.eol`.
- Markers and inserted separators are rendered with the document's EOL; a new file uses `\n`.
- **Drift comparison is EOL-normalized.** This is the load-bearing half: a consumer supplies LF content, the file is CRLF, and an exact comparison would report drift, rewrite, and report drift again forever. Normalizing only line endings keeps `sync` idempotent on CRLF documents without reintroducing v3's whitespace-collapsing blindness.
- A trailing-newline-free file stays trailing-newline-free unless a section is appended to it; a BOM is preserved.

The content boundary rule is v3's and round-trips: rendering wraps `content` in one EOL on each side, parsing strips exactly one from each side, so `""` and `"a\n"` both survive a round trip. A property test pins it rather than a comment.

## Reconciliation

The `syncAll` algorithm, ported intact because it is genuinely good, and stated here because it is the package's only non-obvious behavior.

1. Scan the document into an alternating list of **text spans** (preserved verbatim) and **section placeholders**.
2. For each declared section, compute its outcome by content: absent → `Created`, equal → `Unchanged`, different → `Updated`. Outcomes are returned **in declared order, one per declared section**.
3. Reassign the declared sections that already exist into the existing slots, **in declared order over slots in document order**. This updates content in place *and normalizes ordering* — a document holding `[B, A]` for a declared `[A, B]` comes back as `[A, B]`, with all surrounding text and every foreign section fixed where they were.
4. Place a declared section that does not exist yet **before the nearest present successor sibling**, else **after the nearest present predecessor**, else append at the end, separated by one blank line.
5. Render. Text spans go out verbatim; foreign sections go out as their exact source bytes; declared sections go out canonically.
6. Write only if the rendered text differs from the source.

**Ordering normalization is a contract, not a side effect.** It is what lets a consumer say "the preamble block must precede the tool block" by listing them in that order, and have it be true even in a file a user reordered by hand. Document it as a guarantee; a consumer will depend on it.

Two v3 defects that the [duplicate-fails-typed rule](#errors) closes rather than papering over: slot reassignment is *positional*, so a document containing two blocks with the same identity assigns a declared block into a **different** section's slot, and a declared block can be dropped entirely when `slotCursor` outruns the slot list. Neither is reachable once duplicates fail at parse.

The algorithm is a **bounded linear pass**, not a recursion — nothing here can overflow a stack, which is why the [nesting-depth cap](../effect-standards.md#input-hardening-standards) that governs the format packages has no analogue in this one. The hardening surface here is the [regex construction](#sectiondialect--the-parameterized-marker-vocabulary) and the [marker-injection guard](#errors), both stated above.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards), and the same posture as [git](git.md#observability):

- Every `ManagedSection` member is `Effect.fn("ManagedSection.sync")` and friends — public, fallible boundaries.
- `SectionDocument.parse` carries `Effect.fn("SectionDocument.parse")`; `parseResult` is the unwrapped primitive.
- Spans are annotated with `path` and `key` only. **Never content** — a managed section can hold a token-bearing command line, and a template's content is precisely the sort of thing that ends up in a trace exporter.
- No logging and no metrics. The library is telemetry-agnostic; the application composes `@effect/opentelemetry` at its edge.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`.

**The pure suites need no layers at all.** `SectionDocument`, `SectionDialect` and `CommentStyle` are tested with plain `it` + `assert` over string literals, because there is no `Effect` to run. That is the split paying for itself: the reconciliation scenarios that cost the v3 suite a filesystem are string→string assertions here.

The v3 scenario suite ports directly and is the acceptance floor: writes `[A, B]` in order into an empty file; inserts a missing `A` before its declared sibling `B`; updates in place preserving intervening user content; normalizes `[B, A]` to `[A, B]`; preserves an unrelated foreign section; and is idempotent on a second identical call.

Beyond it, the invariants worth mutation-proving:

- **Idempotency.** `reconcile` twice yields byte-identical text and all-`Unchanged` outcomes on the second pass. Property-tested with `it.effect.prop` over generated documents and section sets, not just the one scenario.
- **Text preservation.** Every byte outside a declared section's span is present, in order, in the output. This is the property that makes the mechanism safe, and it is the one a scenario test is worst at proving.
- **Round trip.** `parse(render(doc)) ≡ doc`, including the `""` and trailing-newline content cases.
- **CRLF.** The full scenario set runs a second time against CRLF fixtures, asserting the output stays CRLF and the second pass is `Unchanged`.
- **Marker injection.** A section whose content contains a begin or end marker fails typed; a mutation removing the guard must turn a test red, so the assertion is on the failure *and* on the document being unmodified.
- **Ambiguity.** Unterminated, orphaned, overlapping and duplicate all fail typed with the right `reason` and line.

**The service suite runs on an in-memory `FileSystem`.** `FileSystem.layerNoop(partial)` (verified in the vendored source: `layerNoop: (fileSystem: Partial<FileSystem>) => Layer<FileSystem>`) over a `Map<string, string>` in `fixtures.ts`, implementing `readFileString`, `writeFileString` and `exists` and leaving everything else noop. Because the fake is **mutable**, each test builds its own and provides it at the test boundary rather than a suite-level `layer(...)` — walker records why a `layer(...)` boundary cannot vary per test, and a test boundary is a sanctioned provisioning point.

`ManagedSection.layerTest(overrides?)` + `makeTest` follow `@effected/workspaces` exactly: unstubbed members `Effect.die` with a message naming the member and telling the caller to pass an override. No `./testing` subpath.

One integration suite (`__test__/integration/`) drives the real `@effect/platform-node` `FileSystem` against a temp directory, covering the two things a fake cannot: a genuinely unreadable file producing `SectionFileError`, and a real CRLF file surviving a round trip through the OS.

## Consumers

- **`@savvy-web/silk-effects` / `@savvy-web/cli`** — the origin. The `savvy commit init` / `savvy lint init` / `savvy … check` commands manage `savvy-base`, `savvy-hooks`, `savvy-commit` and `savvy-lint` blocks across four husky hooks, and are the reason `syncAll`'s ordering guarantee exists (the preamble defines `pm_exec`; the tool block calls it). They migrate to `@effected/templates` + `@savvy-web/templates` after this package ships.
- **claude-code-marketplace-manager** and docs tooling — the wrapped-comment (`<!-- … -->`) case that v3 could not represent; managed blocks in Markdown.
- Any kit consumer that writes into a user-owned file. This is the mechanism; it has no opinion about what goes in the block.

## Deliberately out of scope

- **Whole-file templating.** Rendering an entire file from a template plus data, template inheritance, partials, an expression language. It joins only when a v4 consumer demands a concrete shape ([roadmap.md](../roadmap.md#effectedtemplates)) — and the concrete shape is the point: a speculative templating API is exactly the kind of surface that gets designed twice.
- **Template content and policy.** Every string a consumer wants inside a block, which files carry blocks, and in what order. `@savvy-web/templates` — see [Division of labor](#division-of-labor-mechanism-here-content-elsewhere).
- **A diff engine.** [Cut with evidence](#outcomes); additive later.
- **File modes and permissions.** `chmod +x` on a generated hook is the consumer's, through `FileSystem` directly.
- **Multi-file orchestration.** "Sync these blocks across these five files" is a loop the consumer writes; a batch API here would have to invent a failure policy (stop at first? collect?) that only the consumer can choose.
- **Git awareness.** Whether a managed file is tracked, staged or ignored is [`@effected/git`](git.md)'s domain.
- **Locking or concurrency control.** Two processes syncing the same file race, per file, and the caller owns it — the same posture `@effected/git` takes for its mutating tier.

## Build

`savvy.build.ts` carries the one narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases of the schema class factories ([effect-api-extractor-bases](../effect-standards.md#api-extractor--effect-class-factories)). Never widen it. Gate on a cold `pnpm build --filter @effected/templates`, never the raw script.

## As built (2026-07-25)

Implemented against `effect@4.0.0-beta.101`. 128 tests, `tsc --noEmit` clean, biome clean, and a zero-warning `issues.json` (`warnings: 0, errors: 0, suppressed: 10`, all `*_base`). What follows is where the build diverged from the design above, and what it learned.

### Rulings folded in

The five open questions were [ruled on 2026-07-25](../../../plans/2026-07-25-github-split-decisions-log.md): duplicates fail typed with no repair mode, declared-order normalization is the contract, one marker phrase per dialect, and `@savvy-web/templates` stands as the content home. The fifth changes this document: **`SectionKey` is case-sensitive from day one.** The case-insensitive matching described earlier existed only to keep v3-written `SAVVY-LINT` markers readable; consumers instead declare the exact key present in their files. Markers therefore render the key **verbatim** rather than uppercased — the two go together, since an uppercasing renderer plus case-sensitive keys would let two distinct keys produce one marker.

### Corrections to the design

- **`SectionReconciliation` is a plain interface, not a `Schema.Class`.** It holds `ReadonlyArray<SyncOutcome>`, and `SyncOutcome` is a `Data.TaggedEnum` rather than a schema, so the class form would have been schema-shaped in name only.
- **`SectionKey` is a checked string, not branded.** A brand makes the Type nominal, which forces every call site through a decode step just to write `SectionId.make({ key: "example-tool", … })`. The validation a brand would carry is already enforced at construction — `Schema.Class.make` validates `.check(...)` constraints and throws, confirmed by mutation.
- **`SectionRenderError` gained a third reason, `duplicateDeclaration`.** Declaring one identity twice in a single `syncAll` states two intentions for one block, and any choice between them is a guess — the same argument that makes `duplicateSection` fail on the document side. The design had the guard on only one side.
- **EOL canonicalization happens at parse time**, not inside equality. Parsed section content is normalized as it is scanned, and the declared side is normalized in `check`/`reconcile`. Putting it in a custom `Equal` would have made `Equal.equals` dishonest for a consumer comparing two sections directly.
- **`SectionDialect.matchers()` returns a structurally-inlined type.** See [Build](#build-1).

### The nested-equality probe

The design's one implementation precondition — does `Schema.Class` equality recurse into a field whose type is another `Schema.Class`? — was probed before any comparison code was written. **It does**, and deeply: through `optionalKey` fields and through `Schema.Array` element classes, with `Hash` agreeing wherever `Equal` does. 14/14 cases as expected, five of them returning `false`, so the probe discriminates rather than passing vacuously.

The discriminating case is the one that mattered: same key with a *different* nested `CommentStyle` compares `false`, so equality does not ignore the nested field. Had it ignored it, a `//` section would have compared equal to a `#` section and `syncAll` would have silently merged two different-language blocks. The design's "no custom `Equal`/`Hash`" delta therefore stands as written, and drift detection is plain `Equal.equals` on `Section`.

### What the tests caught

Four defects that a green suite would otherwise have shipped, recorded because each names a class of mistake rather than a typo:

1. **CRLF was downgraded on every pass.** The end-marker match *consumed* the trailing `\r`, so the span held a CR the canonical render never re-emits; each reconciliation stripped one and the document never reached a fixed point. The `\r` is now a **lookahead**.
2. **A stateful-regex hazard.** The scanners carry `g`, and `regex.test` advances the shared `lastIndex`, so a second call on the same content answered differently from the first. Now `matchAll`, which clones internally.
3. **A NUL collision that was documented but not enforced.** `CommentStyle.id` separates its fields with NUL and the doc comment claimed NUL could not appear in a delimiter — but the check allowed it, so `{prefix: "a\0b"}` and `{prefix: "a", suffix: "b"}` keyed the same entry. The delimiter now rejects all control characters.
4. **`FileSystem.readFileString` strips a leading BOM.** Verified against `@effect/platform-node@4.0.0-beta.101`: reading through it made the first sync silently delete a user's BOM — a direct violation of the text-preservation promise. The service reads `fs.readFile` and decodes with `ignoreBOM: true`. **This is the finding that justified the integration suite**, and no in-memory double could have produced it.

### Mutation results

Six mutants; four died immediately, two exposed tests that could not fail:

- **Dropping EOL normalization in `check` left the suite fully green.** The CRLF tests only covered LF declared content against a CRLF document, never the case that matters — a *caller* supplying CRLF content, which without normalization reports drift forever and rewrites on every run. Both the `check` and `reconcile` paths now have that case.
- **The ordering property could not fail.** Its generated documents contain no pre-existing sections, so every section was created and appended and the reassignment path — where ordering normalization actually lives — was never exercised. A second property now reconciles once to create, then re-declares in reversed order against the result.

Both gaps were the same shape: a test that exercises only the easy path of a two-path algorithm. That is the thing to look for when mutating this package.

### Testing posture, as built

Pure suites use plain `it` with no layers at all — the split paying for itself, since the reconciliation scenarios that cost the v3 suite a filesystem are string literals here. Service suites use `it.effect` over an in-memory `FileSystem` built fresh per test and provided at the test boundary.

Two double-related traps are worth recording. `FileSystem.layerNoop` fails **unimplemented** members with a typed `NotFound`, which this package reads as "the file is absent" — so a double implementing only `readFileString` would make every test silently see an empty document instead of its fixture; the double implements `readFile`, the method the service actually calls. And every fake operation is wrapped in `Effect.suspend`, so it observes the map as of when the effect runs rather than when it was constructed.

The integration suite (`__test__/integration/`) covers exactly what a fake cannot settle: the tag `NodeFileSystem` reports for a missing file — asserted against `readFile`, the method the service calls, since pinning it on a method the code does not use would prove nothing — plus real CRLF bytes, a real unchanged-means-unchanged mtime, the BOM, and a read failure that is *not* `NotFound` (reading a directory), which proves the degrade is not over-applied.

### Build

The narrow `_base` suppression landed as designed, covering ten synthesized class-heritage symbols. Two lessons about its boundary:

- **`MarkerMatcher` had to be inlined structurally.** An internal type named on an `@internal` method of a `@public` class still fails the gate, and `@internal` does not help — nor does demoting the interface to a named `type` alias, because an alias is still a named symbol. Inlining the shape at its use sites is the sanctioned fix, and the suppression stayed scoped to `_base`.
- **`{@link X}` is ambiguous for a `Data.TaggedEnum`**, where one name is both a type and a const. Backticks are the only correct form.

### Deferred

Nothing in v1 scope is outstanding. The [out-of-scope list](#deliberately-out-of-scope) is unchanged, and the consumer migration (`@savvy-web/silk-effects` → this package plus `@savvy-web/templates`) is downstream work.

## Settled questions

All five open questions were [ruled on 2026-07-25](../../../plans/2026-07-25-github-split-decisions-log.md) and are recorded here so they are not re-litigated.

1. **`duplicateSection` fails typed; there is no repair mode.** Repair mutates a user's file on an ambiguity, which is a policy call this package does not get to make. A v3-corrupted file is hand-fixed once. If adoption demands it, a `sync` option is the additive fix.
2. **Declared-order normalization is the contract**, not a softenable side effect. It is what makes "the preamble precedes the tool block" enforceable.
3. **The marker phrase lives on the dialect** — one phrase family per document keeps parsing unambiguous, and two families in one file is out of scope.
4. **`SectionKey` is case-sensitive from day one**, and markers render the key verbatim. See [the identity rules](#sectionkey-sectionid-section).
5. **`@savvy-web/templates` stands as the content home.** Whether downstream ships it as a new package or keeps the content in `silk-effects` is downstream's call and does not affect this design.

One question the implementation *raised* and answered rather than deferring: declaring one identity twice in a single call is now `duplicateDeclaration`, the caller-side twin of ruling 1.
