# @effected/jsonc

Zero-dependency JSONC (JSON with comments) parse/edit/format as Effect schemas: parse to values or an AST, strip comments offset-preservingly, compute byte-minimal edits, format, modify by path, visit as a `Stream`. Pure tier: peers only on `effect`; the engine is a vendored, hardened port of Microsoft's `jsonc-parser`.

## Import

```ts
import { Jsonc, JsoncEdit, JsoncFormatter, JsoncFormattingOptions, JsoncModifier, JsoncNode, JsoncVisitor } from "@effected/jsonc";
```

Single entrypoint; no subpaths.

## Core API

- **`Jsonc`** (facade) — `parse(text, options?)` → `Effect<unknown, JsoncParseError>` (error-recovering; aggregates all parse errors into one typed failure); `parseTree(text, options?)` → `Effect<Option<JsoncNode>, JsoncParseError>`; `stripComments(text, replaceCh?)` (pure); `equals`/`equalsValue` (pure, key-order-independent). Schema factories: `Jsonc.fromString(options?)` decodes a JSONC string to `unknown`; `Jsonc.schema(Target, options?)` decodes straight into your schema; `Jsonc.JsoncFromString` is the pre-bound default-options singleton. `JsoncParseOptions` fields: `disallowComments` (default `false`), `allowTrailingComma` (default `true` — deliberately diverges from Microsoft's parser default of `false`), `allowEmptyContent` (default `false`; when `true`, empty/whitespace/comment-only input decodes to `Option.none()` from `parseTree` instead of failing).
- **`JsoncNode`** — recursive AST class (no parent pointers): `find(path)`, `findAtOffset(offset)`, `pathAt(offset)`, `toValue()`. Absence is `Option`, never an error.
- **The edit pipeline** — structurally parallel to yaml's:
  - **`JsoncEdit`** (`offset`, `length`, `content`) + `JsoncEdit.applyAll(text, edits)` — a pure, non-mutating text-splice applier; edits apply in reverse-offset order so earlier offsets stay valid.
  - **`JsoncFormatter`** — `format(text, range?, options?)` → `ReadonlyArray<JsoncEdit>` (pure, total — never fails, even on malformed input); `formatToString(text, range?, options?)` composes `applyAll ∘ format`. `range?: JsoncRange` (`offset`/`length`) restricts formatting to a sub-region.
  - **`JsoncFormattingOptions`** (round-3 addition: `JsoncFormattingOptionsLike`) — `tabSize` (default `2`), `insertSpaces` (default `true`), `eol` (default `"\n"`), `insertFinalNewline` (default `false`), `keepLines` (preserve existing blank lines/line breaks instead of collapsing to canonical `eol`; default `false`). `JsoncFormattingOptionsLike` is the type accepted at call sites — either a constructed `JsoncFormattingOptions` instance or a structurally-matching plain literal (`{ insertSpaces: false, tabSize: 2 }`) — so callers of `JsoncModifier.modify`'s `formattingOptions` field don't need to construct the class for the common case.
  - **`JsoncModifier`** — `modify(text, path, value, options?)` → `Effect<ReadonlyArray<JsoncEdit>, JsoncModificationError>`. `value === undefined` deletes the target (including its surrounding comma); a missing insertion target appends after the last property/element; `path: []` replaces the whole document. `options?.formattingOptions: JsoncFormattingOptionsLike` controls indentation/EOL of ONLY the inserted/replaced content — it does not reformat the rest of the document. `JsoncModificationError` carries typed `path`/`expected` (`"object" | "array"`)/`depth` fields — never a collapsed `reason` string.
- **`JsoncVisitor`** — SAX-style `visit(text)` → `Stream<JsoncVisitorEvent>`; malformed input surfaces as an error *event*, not a stream failure.

## Usage

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromJsonc = Jsonc.schema(Config);

const program = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(ConfigFromJsonc)('{ "port": 3000 // dev\n }');
});
```

Format-preserving edit of one field in a JSONC config file — the shape any tool that rewrites a single value (a version bump, a flag toggle) without disturbing comments or layout reaches for; a same-value edit round-trips to the identical text, so compare before writing:

```ts
import { JsoncEdit, JsoncFormattingOptions, JsoncModifier } from "@effected/jsonc";
import { Effect } from "effect";

const setField = (
  text: string,
  path: ReadonlyArray<string | number>,
  value: unknown,
): Effect.Effect<string | undefined, never> =>
  JsoncModifier.modify(text, path, value, {
    formattingOptions: JsoncFormattingOptions.make({ insertSpaces: true, tabSize: 2, eol: "\n" }),
  }).pipe(
    Effect.map((edits) => JsoncEdit.applyAll(text, edits)),
    Effect.map((updated) => (updated === text ? undefined : updated)),
    // A path that can't be navigated (parent missing, or not an object/array)
    // reports "nothing to change" instead of failing the caller.
    Effect.catchTag("JsoncModificationError", () => Effect.succeed(undefined)),
  );

const source = '{\n  "version": "1.0.0" // managed by CI\n}\n';
const updated = Effect.runSync(setField(source, ["version"], "1.1.0"));
```

## Testing machinery

None exported.

## Gotchas

- `fromString(options)` / `schema(Target, options)` return a FRESH schema per call, and v4 derivation caches by reference — bind the produced schema to a `const`; use `Jsonc.JsoncFromString` for the default case.
- `allowTrailingComma` defaults to `true`.
- `equals`/`equalsValue` return `false` whenever either side has parse errors — malformed input is never equal to anything, including itself.
- Nesting depth is capped at 256 across all five surfaces (parse, walkers, equals, visitor, modifier); the cap fails through the typed error channel, never a `RangeError`.
- `JsoncModifier.modify`'s `formattingOptions` only shapes the NEW text it inserts or replaces — it is not a whole-document reformat; pair with `JsoncFormatter.formatToString` if you need that too.
