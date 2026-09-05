# @effected/templates

Managed sections: delimited `BEGIN`/`END` blocks inside files whose surrounding content belongs to the user. A tool owns the block, the user owns everything else, and neither destroys the other. Boundary tier: `effect` is the only peer, with zero runtime dependencies and zero `@effected/*` edges. **`FileSystem` is required in `R`; `Path` deliberately is not** — paths are opaque strings handed straight to `FileSystem`, and this package never joins, resolves or splits one, so the caller guarantees a write's parent directory exists (a write into a missing one fails typed, and that refusal *is* the contract surfacing). v1 scope is managed sections only; whole-file templating stays out until a consumer proves a shape.

The architecture is **pure core, thin edge**: `SectionDocument` is a string-to-string engine where every interesting invariant — idempotency, text preservation, ordering, line endings, marker refusal — is assertable with no layer, no runtime and no filesystem, and `ManagedSection` only reads the file, calls that core, and writes back when the text changed. If you are adding behavior and reaching for `ManagedSection.ts`, you are probably in the wrong file.

## Import

```ts
import { CommentStyle, ManagedSection, Section, SectionDialect, SectionDocument, SectionId } from "@effected/templates";
```

Single entrypoint; no subpaths.

## Feature surface

| Reach for | When |
| --- | --- |
| `SectionId.make({ key, commentStyle })` + `.section(content, attributes?)` | declaring the block a tool owns |
| `SectionDocument.parseResult(text, dialect?)` | reading sections out of a string with no Effect runtime at the call site |
| `SectionDocument.parse` | the same, in `Effect` — it adds only a tracing span |
| `doc.read` / `.has` | is this section present, and what does it currently say |
| `doc.check(section)` | compare against declared content without touching anything |
| `doc.reconcile(sections)` | produce the new text plus per-section outcomes, in declared order |
| `doc.remove(id)` | drop a block and collapse the blank lines it leaves |
| `ManagedSection.sync` / `.syncAll` | make a file say what a tool declares, writing only on change |
| `ManagedSection.check` / `.checkAll` | drift detection over a real file (a `--check` mode) |
| `ManagedSection.read` / `.readAll` / `.isManaged` / `.remove` | file-level inspection and removal |
| `SectionDialect.make({ phrase, styles })` | narrow the marker vocabulary for a domain |
| `CommentStyle.hash` / `.slash` / `.semicolon` / `.dash` / `.html` / `.block` | pick (or define) how markers are commented out |

## Core API

- **`CommentStyle`** — `Schema.Class` of `{ prefix, suffix? }` with the six presets above and `CommentStyle.presets`; an **open set**, so a consumer can define its own. Getters `id` and `isWrapped`.
- **`SectionKey` / `SectionId` / `Section` / `PlacedSection`** — `SectionKey` is a checked string (`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`). `SectionId` is `{ key, commentStyle }`, and **`commentStyle` is required with no default** — a defaulted style is how a caller who forgets the argument writes `#` markers into a TypeScript file, silently producing a syntax error in the user's own source. `id.section(content, attributes?)` mints a `Section` (`key`, `commentStyle`, `content`, `attributes`), whose `id` getter and `withContent` keep identity and attributes intact. `PlacedSection` adds the span as found: `start` (first character of the begin marker), `end` (one past the end marker, so `text.slice(start, end)` is exactly the block) and a 1-based `line` pointing at the begin marker. **`Section` equality is structural and whitespace-significant** — comparing trimmed, collapsed content would silently swallow any template change that altered only indentation.
- **`SectionDialect`** — `Schema.Class` of `phrase` (letters, digits, spaces and underscores only; dashes excluded so a phrase can never contain the `---` closing rule) and `styles` (at least one `CommentStyle`). `SectionDialect.default` is the zero-configuration one: the phrase `MANAGED SECTION` and every preset style. Instance members `recognizes(style)`, `beginMarker(id)`, `endMarker(id)`, `render(section, eol = "\n")` → `Result<string, SectionRenderError>`, `containsMarker(text)` and `matchers()`. One phrase per dialect is deliberate: two marker families in one document make parsing ambiguous for no benefit. `SectionRenderError` is the typed refusal.
- **`SectionDocument`** — the pure core, a `Schema.Class` of `text`, `dialect`, `sections` (in document order) and the detected `eol`. **`parseResult(text, dialect?)` → `Result<SectionDocument, SectionParseError>` is the primitive; `parse` is the `Effect` twin and adds only a tracing span.** Instance members are total or `Result`/`Option`-returning and have **no `Effect` twins, deliberately** — the document is already parsed, so nothing is left to fail effectfully and a twin would be dead surface: `read(id)` → `Option<Section>`, `has(id)` → `boolean`, `check(section)` → `CheckOutcome` (total; EOL-normalized on both sides), `reconcile(sections)` → `Result<SectionReconciliation, SectionRenderError>` (`{ text, outcomes, changed }`; declared sections come back **in declared order**, text outside a managed span and sections this dialect does not own survive byte-for-byte, and nothing is rendered until every declared section renders successfully, so a refusal leaves the document untouched), `remove(id)` → `Option<string>` (collapsing the surrounding blank lines so repeated removals never accumulate gaps). `SectionParseError` carries `reason`, `line` and optional `key`, and `SectionParseError.at(path, error)` attaches a path.
- **`SyncOutcome` / `CheckOutcome`** — `Data.TaggedEnum`s. `SyncOutcome` is `Created` / `Updated` (`before`, `after`) / `Unchanged`; `CheckOutcome` is `Absent` (`id`) / `UpToDate` / `Drifted` (`onDisk`, `expected`).
- **`ManagedSection`** — `Context.Service<ManagedSectionShape>` requiring `FileSystem` in `R`: `read`, `readAll`, `isManaged`, `sync`, `syncAll`, `check`, `checkAll`, `remove`. Failures are `SectionParseError | SectionFileError`, plus `SectionRenderError` on the two sync members. `ManagedSection.layer` is a bound `const` (so it memoizes by reference) using `SectionDialect.default`; `ManagedSection.layerWith(options)` takes a custom `dialect` — a parameterized factory mints a **fresh reference per call** and layers memoize by reference, so bind the result to a `const` rather than calling it at each composition site. A missing file is not an error: it reads as an empty document.

## Usage

```ts
import { CommentStyle, ManagedSection, SectionId } from "@effected/templates";
import { Effect } from "effect";

const Block = SectionId.make({ key: "tool-config", commentStyle: CommentStyle.hash });

const program = Effect.gen(function* () {
  const sections = yield* ManagedSection;
  const outcome = yield* sections.sync(".tool.yaml", Block.section("generated: true"));
  return outcome._tag; // "Created" | "Updated" | "Unchanged"
});
```

Synchronously, with no runtime — a lint hook or a build plugin:

```ts
import { SectionDocument } from "@effected/templates";
import { Result } from "effect";

const parsed = SectionDocument.parseResult(source);
if (Result.isFailure(parsed)) return null; // parsed.failure is the typed SectionParseError
const outcome = parsed.success.check(declared); // "Absent" | "UpToDate" | "Drifted"
```

## Testing machinery

`ManagedSection.makeTest(overrides?)` / `layerTest(overrides?)` — unstubbed members **die when called**, rather than returning a plausible answer that makes a wrong test pass. For real IO, provide `@effected/memfs`: build the volume eagerly with `makeInspectableWith` under `Layer.succeed`, **never `layerInspectableWith`**, because a memfs layer re-seeds on every `Effect.provide` and assertions running after the provide would read a volume nobody wrote to. Pure suites need plain `it` (there is no Effect to run); service suites use `it.effect`.

## Gotchas

- **Ambiguity fails typed, never silently.** Unterminated, orphaned, overlapping and duplicate sections are all `SectionParseError`. Skipping an unterminated marker would make the next write append a *second* copy of the section.
- **Idempotency is a contract**: a second identical sync produces byte-identical text, all `Unchanged`, and **no write at all**. An unchanged write churns mtimes and makes every run look like a change to a watcher.
- **Declared order is a contract too** — `syncAll` rewrites the document into declared order, so a consumer can say "the preamble precedes the tool block" by listing them in that order. Do not soften it into "update in place".
- **Marker attributes are metadata, never identity.** `name="value"` pairs ride the `BEGIN` marker (never the `END`), count in **equality** (an attribute change is real drift) but never in identity, so changing one updates the block in place instead of orphaning it and appending a second. Names match `[A-Za-z][A-Za-z0-9_-]*`, values are double-quoted and free of `"` and line breaks, and **there is no escaping, by design**. Omitting the field and passing `{}` are the same section. Emission is insertion-ordered; equality is not. Violations fail typed at **render**, not at construction, because attributes are runtime data.
- **Attributed markers are a one-way compatibility break** — a scanner predating the feature does not recognize one at all, so the line falls out as ordinary content and the block it opened stops being a managed section. Writing them into a file other tooling also manages is a decision.
- **Line endings are normalized on both sides** — the parsed side at scan time, the declared side in `check`/`reconcile`. Drop either and a CRLF document (or a caller with CRLF content) reports drift forever and rewrites on every run.
- **The service reads bytes, not `readFileString`.** `FileSystem.readFileString` decodes through a default `TextDecoder`, which strips a leading BOM — reading through it would make the first sync silently delete a user's BOM, violating text preservation.
- **A partial `FileSystem` double reads as an empty file.** `layerNoop` fails unimplemented members with a typed `NotFound`, which this package treats as "the file is absent", so a stub implementing only `readFileString` makes every test silently see an empty document. Use a real volume.
