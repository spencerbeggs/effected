# @effected/glob

The complete minimatch dialect (extglobs, braces, POSIX classes, true globstar, negation) compiled to pure string→predicate schemas — zero IO. Pure tier: peers only on `effect`; the engine is vendored and hardened from minimatch 10.x. Point it at arbitrary candidate strings (e.g. `git ls-tree` output); for filesystem scanning use core's `FileSystem.glob` instead.

## Import

```ts
import { GlobPattern, GlobSet } from "@effected/glob";
```

Single entrypoint; no subpaths.

## Core API

- **`GlobPattern`** — `Schema.Class` over one encoded field `source`. `GlobPattern.compile(source, options?)` → `Effect<GlobPattern, GlobPatternError>` is the fallible boundary; after that `matches(candidate)` is **total** (pure boolean, never throws). `FromString` embeds patterns in config schemas. Metadata: `hasMagic`, `negated`, `enumerationPrefix` (longest literal directory prefix), `crossesSegments`. Statics `escape`/`unescape` for user-supplied literals.
- **`GlobPatternOptions`** — full minimatch options surface, schema-validated; `platform` defaults to `"posix"` and `process.platform` is never read.
- **`GlobSet`** — set semantics over many patterns: leading `!` marks an exclusion filter; `matches(candidate) = someInclude && !someExclude`. `GlobSet.compile(patterns)`; accessors `literals`, `wildcards`, `excludes`, `isExcluded(candidate)`.

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

## Testing machinery

None exported (minimatch is the internal test oracle only).

## Gotchas

- `**` really crosses segments. Code migrated from ad-hoc glob layers that rewrote `/**` to `/*` will see MORE matches here.
- Invalid options are a defect at construction; only malformed *patterns* use the typed error channel.
- Brace-expansion budget exhaustion fails as typed `GlobPatternError` (`ExpansionBudgetExceeded`) rather than silently truncating.
- Extglob over-nesting degrades to literal matching (no error); globstar recursion over the cap is a deliberate false negative — both preserved upstream trade-offs.
- Windows-style matching requires explicit `{ platform: "win32" }`.
