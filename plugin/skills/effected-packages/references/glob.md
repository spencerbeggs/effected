# @effected/glob

The complete minimatch dialect (extglobs, braces, POSIX classes, true globstar, negation) compiled to pure string→predicate schemas — zero IO. Pure tier: peers only on `effect`; the engine is vendored from minimatch 10.x and hardened, answers as minimatch 11.0.5 does (its test oracle, and every pattern portion with magic in it runs through 11's own vendored matcher), with one documented divergence: it matches brace alternatives as a union rather than merging them into one matcher. A numeric brace range of 100 or more values (`{0..999}`) is one magic portion, as in minimatch 11: `hasMagic` is true, `GlobSet` buckets it as a wildcard, `enumerationRoots` stops at it, and it matches past `braceExpandMax`. Point it at arbitrary candidate strings (e.g. `git ls-tree` output); for filesystem scanning use core's `FileSystem.glob`, or `@effected/walker`'s `descend`, which takes a compiled `GlobPattern` and expands it against a real directory tree — the reason to reach for `GlobPattern.compile` even when the immediate need is "find matching files on disk", not just string matching.

## Import

```ts
import { GlobPattern, GlobPatternOptions, GlobSet, Wildcard, WildcardOptions } from "@effected/glob";
import type { EnumerationRoot } from "@effected/glob";
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
| `maxGlobstarRecursion` | `200` | recursion cap backing the globstar false-negative trade-off in Gotchas below; an integer from 1 to 1000, and a value outside that range throws at `make`. `maxExtglobRecursion` is still accepted but limits nothing: extglobs run through minimatch 11's matcher, and nesting past 256 levels fails typed at compile |

## Core API

- **`GlobPattern`** — `Schema.Class` over one encoded field `source`. `GlobPattern.compile(source, options?)` → `Effect<GlobPattern, GlobPatternError>` is the fallible boundary (`GlobPattern.compileResult` is its synchronous `Result` twin); after that `matches(candidate)` is **total** (pure boolean, never throws). `FromString` embeds patterns in config schemas. Metadata: `hasMagic`, `negated`, `enumerationPrefix` (longest literal directory prefix shared by every brace alternative — `""` when the first segment carries magic), `crossesSegments` (true iff the pattern can match more than one level below `enumerationPrefix` — a globstar, or a magic segment followed by more segments). Both fold every brace alternative into one answer. **`enumerationRoots`** → `ReadonlyArray<EnumerationRoot>` keeps them apart — one root per alternative, each `{ prefix, deep, spellings }` (`prefix` canonical and slash-terminated, `""` for the base; `deep` when matches can lie more than one level below it; `spellings` every literal prefix the pattern spells that root with, in pattern order) — so `packages/{a,b}/src/*.ts` reads `packages/a/src/` and `packages/b/src/` one level each rather than all of `packages/`. Roots are distinct, one inside a `deep` root is absorbed into it, and two kept roots never yield the same file. These getters exist for one consumer shape — an enumerator deciding where to read and how deep (`@effected/walker`'s `descend` walks per root) — and all ignore whole-pattern negation: guard on `negated` and enumerate a negated pattern from `cwd`. **`literalPrefix`** is the literal leading directory segments before the first magic segment, unescaped, no trailing slash (`src/{a,b}/*.ts` → `src`; an unescaped `{` is magic; no magic → the whole pattern; `""` when the first segment is magic). The `extglobBang` option reads a leading `!(` as the extglob, as picomatch does (off by default; `!a` still negates; parity at that one point only; `nonegate: true` also avoids `!(` negation but disables every `!`; `GlobSet` has no options and strips one `!` itself). Statics `escape`/`unescape` for user-supplied literals.
- **`GlobSet`** — set semantics over many patterns: leading `!` marks an exclusion filter; `matches(candidate) = someInclude && !someExclude`. `GlobSet.compile(patterns)` → `Effect<GlobSet, GlobPatternError>`, failing typed on the FIRST uncompilable member (the error's `pattern` field names the offender, bang included for exclusions). Accessors: `literals` (deduped effective literal include paths, unescaped, first-seen order — an exact-lookup fast path), `wildcards` (compiled magic include alternatives), `excludes` (compiled exclusion patterns, leading bang stripped), `isExcluded(candidate)`.
- **`Wildcard`** — a separate matcher for allow-list patterns like `agent:*`, not a glob dialect. `*` matches any run of characters other than whitespace, `?` one character other than whitespace, and everything else is literal. There is no separator, so `*` crosses `/`, and `[`, `{`, `!`, `\` and a leading `.` mean nothing special. `Wildcard.compile(pattern, options?)` → `(candidate: string) => boolean` and `Wildcard.matches(pattern, candidate, options?)` → `boolean`; neither throws, and matching never backtracks (at most pattern length × candidate length). `WildcardOptions.make({ nocase: true })` compares literals under Unicode simple case folding. Reach for it instead of escaping a string into a `RegExp`, or instead of a glob when `/` must not be special.

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
- `dot` defaults to `false` — a bare `*`/`**` does NOT match dotfiles or dot-directories unless you pass `{ dot: true }`. Vitest's include/exclude matching runs with `dot: true`, as do other tools that matched dotfiles unconditionally; a consumer replacing one needs the option to stay behavior-compatible.
- Invalid options are a defect at construction; only malformed *patterns* use the typed error channel.
- Brace-expansion budget exhaustion fails as typed `GlobPatternError` (`ExpansionBudgetExceeded`) rather than silently truncating: the result count (`braceExpandMax`), the total expanded length (4,000,000 characters), and the level-2 `**/..` split (1,000,000 added portions) are each bounded. A portion too large for the runtime's regexp engine (about 32,000 literal characters and a wildcard, or about 33,000 non-Latin-1 ones) fails typed as `InvalidRegExp` instead of throwing, and a compile whose regexps and matcher graphs pass a work budget (thousands of brace alternatives each with its own POSIX class, such as `[[:alpha:]]{0..99}{0..99}`, where minimatch 11 compiles it, or each with its own copy of a numeric range kept whole) fails typed as `CompileBudgetExceeded` instead of exhausting memory, and a `GlobSet`'s members share one budget (each POSIX class costs about 4,096 units, so a set in which every member has one tops out at roughly 1,900 members and fails typed past it; sets of plain, brace and range lines compile at 20,000 lines); a POSIX class beside `,`, `#`, space or `-` compiles and matches as minimatch 11 does; every compile-time failure is a `GlobPatternError`, never a defect.
- Globstar recursion over `maxGlobstarRecursion` is a deliberate false negative, a preserved upstream trade-off. Extglobs have no such cap, and nesting past about 256 levels fails typed as `NestingDepthExceeded` at compile. Matching is polynomial and bounded by the input, not linear everywhere: a chain of negations separated by literals (`x!(a)` repeated, against `xb` repeated) is about cubic, 22 ms at a 400-character path and 1.6 s at 2,000, as in minimatch 11. With untrusted patterns or paths, bound the input before matching; matching is synchronous, so an in-process timeout can not stop it.
- Answers follow minimatch 11.0.5 and can differ from minimatch 10.x: `**/a/b/c/**/d/**` matches `d/a/b/c/d/b` here and not there, an empty path portion matches only an empty pattern portion (`a/b/` no longer matches `a/b/?(x)`), and `?` takes one character of an astral file name (`?.txt` matches `😀.txt`).
- Windows-style matching requires explicit `{ platform: "win32" }`.
- **Untrusted patterns: bound the input yourself.** Matching stays polynomial, and the package does not bound its total work (`**/a/**` against 50,000 portions takes about 3.5 s, and brace expansion multiplies the work by its alternatives). `matches` is synchronous, so `Effect.timeout` around it still waits for the whole match. Limit the pattern's and the candidate's length, lower `braceExpandMax` so a brace product past it fails at compile with `ExpansionBudgetExceeded` (a numeric range of 100 or more values is not expanded, so the budget does not apply to it), and enforce a real deadline off the calling thread (a terminated worker, a subprocess).
- `matches` never throws a stack overflow. On less stack than the accepted recursion cap needs, it answers as though no alternative matched: `false`, or `true` for a negated pattern. `GlobSet.matches` inherits this.
