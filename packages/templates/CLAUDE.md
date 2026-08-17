# CLAUDE.md — @effected/templates

Managed sections: delimited `BEGIN`/`END` blocks inside files whose surrounding
content belongs to the user. A tool owns the block, the user owns everything
else, and neither destroys the other.

Design doc: `@../../.claude/design/effected/packages/templates.md`. Read it before
changing behavior — the deltas from the v3 `ManagedSection` port are recorded
there with their reasoning.

## What this package is

**Boundary tier.** `effect` is the only peer; zero runtime dependencies, zero
`@effected` edges. `FileSystem` is required in `R`; **`Path` is not** — paths
are opaque strings handed straight to `FileSystem`, and this package never
joins, resolves or splits one. `@effect/platform-node` is a devDependency, for
the integration suite only.

v1 scope is **managed sections only**. Whole-file templating is out of scope
until a consumer proves a concrete shape.

**First in-kit consumer (2026-07-26): `@effected/github-actions`'s
`ManagedDocument`** — a PR comment or check summary whose regions an action
rewrites while the human's prose survives. It is `SectionDocument` with three
parameters *fixed* (HTML comment style, the `MANAGED REGION` phrase,
`ns.key.region` keys), **a domain fixing of the dialect, not a second engine**:
the region grammar, the line-ending invariant and the idempotence proof all
stayed here. It asked for `SectionDialect`'s parameters to be narrowed, never
extended — keep it that way when the next consumer arrives. The one thing it
later added, **marker attributes**, landed here as syntax plus an equality rule
while the *meaning* of the pairs stayed entirely with the consumer: mechanism
here, content there.

## The one architectural rule: pure core, thin edge

```text
string ──► SectionDocument.parseResult ──► read / has / check / reconcile / remove
                                                          │
                              ManagedSection: read the file, call the above,
                              write back ONLY when the text changed
```

**Behavior belongs in `SectionDocument`, not in the service.** The v3 original
put the whole algorithm inside `Layer.effect`'s closure, so its hardest logic
could only be tested by writing files. Every interesting invariant here —
idempotency, text preservation, ordering, line endings, marker refusal — is a
string-to-string property assertable with no layer, no runtime and no
filesystem.

If you are adding behavior and reaching for `ManagedSection.ts`, you are
probably in the wrong file.

## Module map

| Module | Owns |
| --- | --- |
| `CommentStyle.ts` | `{prefix, suffix?}` + presets. Open set — a consumer can define its own. |
| `Section.ts` | `SectionKey`, `SectionId`, `Section`, `PlacedSection` |
| `SectionDialect.ts` | `Eol`, `SectionRenderError`, marker rendering, the compiled scanners |
| `SectionDocument.ts` | `SectionParseError`, `SectionReconciliation`, the pure core |
| `SectionOutcome.ts` | `SyncOutcome`, `CheckOutcome` (`Data.TaggedEnum`) |
| `ManagedSection.ts` | the service, its layers, `SectionFileError` |
| `internal/scan.ts` | the marker scanner, EOL detection/normalization |
| `internal/reconcile.ts` | the spans/placeholder algorithm |
| `internal/attributes.ts` | the marker attribute grammar, shared by renderer and scanner |

Import direction is one-way: `CommentStyle → Section → SectionDialect →
SectionDocument → ManagedSection`. `internal/` may import concept modules;
concept modules must not import `SectionDocument` (that is why the scanner
returns a plain tagged result and `SectionDocument` mints the error).

`Section.ts` imports `Effect` **as a value** (`Schema.withConstructorDefault`
takes an effect) — still `effect`, still no new dependency, and not evidence of
anything about the pure/service split.

## Invariants — do not break these

1. **Ambiguity fails typed, never silently.** Unterminated, orphaned,
   overlapping and duplicate sections are all `SectionParseError`. Every one of
   them is a case where a silent choice corrupts a user's file: v3 skipped
   unterminated markers, which made the next write append a *second* copy of
   the section.
2. **Idempotency.** A second identical sync produces byte-identical text, all
   `Unchanged`, and **no write at all**. An unchanged write churns mtimes and
   makes every run look like a change to a watcher — pinned by a real-mtime
   integration test.
3. **Text preservation.** Every byte outside a managed span survives, in order.
   This is the package's central promise; it is why the BOM handling below
   exists.
4. **Declared order is a contract.** `syncAll` rewrites the document into
   declared order, so a consumer can say "the preamble precedes the tool block"
   by listing them in that order. Do not soften this into "update in place".
5. **Rendering refuses what it cannot read back.** Content containing a marker,
   a comment style the dialect cannot scan, one identity declared twice, and an
   attribute outside the grammar (`invalidAttribute`, naming it) all fail typed
   **before** anything is written. Attributes are runtime data, so that refusal
   is typed at render, never a defect at construction.
6. **Marker attributes are metadata, never identity.** `name="value"` pairs ride
   the `BEGIN` marker; an `END` never carries any. They count in **equality** —
   an attribute change is real drift, or a stamp would be unwritable — but never
   in identity, so changing one updates the block **in place** rather than
   orphaning it and appending a second. `attributes` is an always-present record
   with a constructor default: a bare marker and an explicit `{}` must stay the
   same section, or a consumer that never uses attributes sees permanent drift
   against every marker on disk. Emission is insertion-ordered, equality is not.

## Sharp edges

**Line endings.** The document's dominant EOL is detected at parse; markers are
rendered with it. Comparison is EOL-normalized **on both sides** — the parsed
side at scan time and the declared side in `check`/`reconcile`. Drop either and
a CRLF document (or a caller with CRLF content) reports drift forever and
rewrites on every run. v3 was LF-only and silently failed to see sections in
CRLF files at all.

**The scanner's trailing `\r` is a lookahead, not a consumed character.** If the
match consumes it, the section's span contains a CR the canonical render never
re-emits, so every reconciliation strips one and the document never reaches a
fixed point.

**Read bytes, not `readFileString`.** `FileSystem.readFileString` decodes
through a default `TextDecoder`, which **strips a leading BOM** (verified
against `@effect/platform-node@4.0.0-beta.101`). Reading through it makes the
first sync silently delete a user's BOM — a text-preservation violation. The
service reads `fs.readFile` and decodes with `ignoreBOM: true`.

**The caller guarantees the parent directory exists.** `Path` is absent from `R`, so this package cannot create one and a write into a missing directory fails typed. A `Map` fixture accepts any key, so that precondition went untested for years; the volume refuses the write, and the refusal *is* the contract surfacing. Never make the fixture create parents implicitly.

**A partial `FileSystem` double reads as an empty file.** `layerNoop` fails unimplemented members with a typed `NotFound`, which this package treats as "the file is absent" — so a stub implementing only `readFileString` makes every test silently see an empty document. That deny-by-default cost is why the double is a real volume now.

**Regex construction is escaped and cached.** Prefix, suffix and phrase are all
caller-supplied and all end up in the scan pattern. The compiled matchers are
memoized in a module-level `WeakMap` keyed by dialect instance, not a field, so
`SectionDialect` stays a pure schema class.

**`matchAll`, never `regex.test`.** The scanners carry `g`; `test` advances the
shared `lastIndex` and makes a second call on the same text answer differently.

**One attribute grammar, in `internal/attributes.ts`, so scanner and renderer
cannot disagree.** Names are `[A-Za-z][A-Za-z0-9_-]*`, values double-quoted and
free of `"` and line breaks, and **there is no escaping, by design** — an escape
grammar is a second parser hiding inside the first. A run that does not parse, a
duplicate name, or attributes on an `END` all mean *the line is not a marker*:
it is ordinary content, and the ambiguity that creates fails typed downstream
instead of by a guess in the scanner. The marker-injection guard mirrors that
rule exactly — refusing more than the scanner reads back would reject content
that round-trips fine.

**The run is captured as one loose group, then validated by a hand-rolled
single-pass walk — never a second regex.** The marker pattern takes the whole run
in one group (a repeated capture group keeps only its last pair) as a single lazy
quantifier under a once-only `(?:…)?`: no nested quantifiers, the CRLF lookahead
untouched, and a quoted value may contain `---` without being read as the closing
rule. `parseAttributeRun` then walks it character by character. The anchored
`(pair)(sep pair)*$` pattern that used to do this backtracks **polynomially** on
adversarial near-miss runs, and these runs come off untrusted document lines
(CodeQL flagged it). The walk is the same grammar with the same refusals —
mangled pair, duplicate name, unterminated value — touching each character
exactly once, so a megabyte of hostile line costs a megabyte of work. Do not
"simplify" it back into a regex.

**Attributed markers are a one-way compatibility break.** A scanner predating
the feature does not recognize one at all — the line falls out as ordinary
content and the block it opened stops being a managed section. Writing
attributes into a file other tooling also manages is a decision.

## Testing

`@effect/vitest`, `assert.*` — never `expect`. Pure suites use plain `it` (there
is no Effect to run); service suites use `it.effect`.

- Service suites run on the real volume in `__test__/fixtures.ts` (`@effected/memfs`, a devDependency), built fresh per test and provided at the test boundary — it is mutable, so a suite-level `layer(...)` cannot serve it. Every service test runs the code and then reads back what the run left behind, through the volume's inspection surface.
- **Build it eagerly — `makeInspectableWith` under `Layer.succeed`, never `layerInspectableWith`.** A memfs layer re-seeds on every `Effect.provide`, so assertions running *after* the provide would read a volume nobody wrote to.
- **The write counter is a fault handler that declines**, so the write is counted *and* really happens. The mutant it must kill swallows the write while still counting it; five tests fail when it does.
- **Property tests must construct their `CommentStyle` inline**, not from a
  preset, so they exercise structural rather than reference identity.
- The integration suite exists for the facts a fake cannot settle: the tag
  `NodeFileSystem` reports for a missing file (which the whole
  missing-file-is-not-an-error degrade keys on), real CRLF bytes, real mtimes,
  and the BOM. A hand-rolled `node:fs` layer would test the fake against the
  fake.
- A mutation pass is expected on any change to the reconciler or the comparison
  path. Two mutants have already survived a green suite here.

## Build

`savvy.build.ts` carries the narrow `{ messageId: "ae-forgotten-export", pattern:
"_base" }` suppression for the synthesized schema/service class heritage.
**Never widen it.** An internal type named on a signature is a *different*
symbol that still fails the gate and must be inlined structurally — a named
`type` alias does not help, because an alias is still a named symbol.

`{@link X}` on a `Data.TaggedEnum` (a merged value + type name) is ambiguous to
API Extractor; backticks are the only correct form.

Gate on `pnpm build --filter @effected/templates`, never the raw script, and
read `dist/prod/issues.json` rather than console output.
