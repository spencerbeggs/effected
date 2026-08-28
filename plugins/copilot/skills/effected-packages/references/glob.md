# @effected/glob

The complete minimatch dialect (extglobs, braces, POSIX classes, true globstar, negation) compiled to pure string→predicate schemas — zero IO. Pure tier: peers only on `effect`; the engine is vendored and hardened from minimatch 10.x. Point it at arbitrary candidate strings (e.g. `git ls-tree` output); for filesystem scanning use core's `FileSystem.glob`, or `@effected/walker`'s `descend` (round 3), which takes a compiled `GlobPattern` and expands it against a real directory tree — the reason to reach for `GlobPattern.compile` even when the immediate need is "find matching files on disk", not just string matching.

## Import

```ts
import { GlobPattern, GlobPatternOptions, GlobSet } from "@effected/glob";
```

Single entrypoint; no subpaths.

## Feature surface

`GlobPatternOptions` is the full minimatch options surface as a `Schema.Class`; construct with `GlobPatternOptions.make({ ... })`. Every field is `optionalKey` — omit what you don't need. Invalid options throw at `make` (a wiring defect, never the typed channel). The fields reached for most often in practice:

| Field | Default | Effect |
| --- | --- | --- |
| `dot` | `false` | match dotfiles/dot-directories with wildcards (off by default, like real minimatch/glob — a bare `*` skips `.git`, `.env`, etc. unless you opt in) |
| `nocase` | `false` | case-insensitive matching |
| `platform` | `"posix"` | separator/root dialect; never reads `process.platform` |
| `noglobstar` | `false` | disable `**` crossing segments, falling back to single-segment `*` |
| `braceExpandMax` | `100000` | brace-expansion budget; tightenable, never raisable above the stock cap |
| `maxGlobstarRecursion` / `maxExtglobRecursion` | engine defaults | recursion caps backing the false-negative trade-offs in Gotchas below |

## Core API

- **`GlobPattern`** — `Schema.Class` over one encoded field `source`. `GlobPattern.compile(source, options?)` → `Effect<GlobPattern, GlobPatternError>` is the fallible boundary; after that `matches(candidate)` is **total** (pure boolean, never throws). `FromString` embeds patterns in config schemas. Metadata: `hasMagic`, `negated`, `enumerationPrefix` (longest literal directory prefix shared by every brace alternative — `""` when the first segment carries magic), `crossesSegments` (true iff the pattern can match more than one level below `enumerationPrefix` — a globstar, or a magic segment followed by more segments). Both metadata getters exist for exactly one consumer shape: an enumerator deciding between a single-level directory read and a bounded recursive descent (this is what `@effected/walker`'s `descend` does internally). Statics `escape`/`unescape` for user-supplied literals.
- **`GlobSet`** — set semantics over many patterns: leading `!` marks an exclusion filter; `matches(candidate) = someInclude && !someExclude`. `GlobSet.compile(patterns)` → `Effect<GlobSet, GlobPatternError>`, failing typed on the FIRST uncompilable member (the error's `pattern` field names the offender, bang included for exclusions). Accessors: `literals` (deduped effective literal include paths, unescaped, first-seen order — an exact-lookup fast path), `wildcards` (compiled magic include alternatives), `excludes` (compiled exclusion patterns, leading bang stripped), `isExcluded(candidate)`.

## Usage

```ts
import { GlobPattern } from "@effected/glob";
import { Effect } from "effect";

const p = Effect.runSync(GlobPattern.compile("packages/**"));
p.matches("packages/a/b"); // true — real ** crosses segments
```

```ts
import { GlobSet } from "@effected/glob";
import { Effect } from "effect";

const set = Effect.runSync(GlobSet.compile(["packages/*", "!packages/internal"]));
set.matches("packages/core"); // true
set.matches("packages/internal"); // false
```

Compiling once and reusing a pattern to filter a batch of candidate strings — the shape every consumer of `git ls-tree`/lockfile-membership output reaches for — folding a compile-guard trip into a domain error rather than leaking `GlobPatternError`:

```ts
import type { GlobPattern as GlobPatternType } from "@effected/glob";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { Effect, Schema } from "effect";

class InvalidPatternError extends Schema.TaggedError<InvalidPatternError>()("InvalidPatternError", {
  pattern: Schema.String,
  reason: Schema.String,
}) {}

const DOT_AWARE = GlobPatternOptions.make({ dot: true });

const compileFilter = (source: string): Effect.Effect<GlobPatternType, InvalidPatternError> =>
  GlobPattern.compile(source, DOT_AWARE).pipe(
    Effect.mapError((error) => new InvalidPatternError({ pattern: source, reason: error.message })),
  );

const filterCandidates = (
  source: string,
  candidates: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, InvalidPatternError> =>
  Effect.gen(function* () {
    const pattern = yield* compileFilter(source);
    return candidates.filter((path) => pattern.matches(path));
  });
```

## Testing machinery

None exported (minimatch is the internal test oracle only).

## Gotchas

- `**` really crosses segments. Code migrated from ad-hoc glob layers that rewrote `/**` to `/*` will see MORE matches here.
- `dot` defaults to `false` — a bare `*`/`**` does NOT match dotfiles or dot-directories unless you pass `{ dot: true }`. Any consumer replacing an older glob tool that matched dotfiles unconditionally needs this option to stay behavior-compatible.
- Invalid options are a defect at construction; only malformed *patterns* use the typed error channel.
- Brace-expansion budget exhaustion fails as typed `GlobPatternError` (`ExpansionBudgetExceeded`) rather than silently truncating.
- Extglob over-nesting degrades to literal matching (no error); globstar recursion over the cap is a deliberate false negative — both preserved upstream trade-offs.
- Windows-style matching requires explicit `{ platform: "win32" }`.
