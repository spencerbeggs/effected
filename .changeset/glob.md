---
"@effected/glob": minor
---

## Features

Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies. `GlobPattern.compile` is the one fallible entry point; once a `GlobPattern` exists, `matches` is total — pure, synchronous, no error channel, and no hostile pattern can make it overflow, allocate unboundedly or hang, because every guard fired before the instance was constructed.

### Compile once, match many

`GlobSet.compile` builds include/exclude sets where a leading `!` is an exclusion filter. A compiled pattern also carries the metadata a directory enumerator needs to skip trees that cannot match.

```ts
import { GlobPattern, GlobSet } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pattern = yield* GlobPattern.compile("packages/**");
  console.log(pattern.matches("packages/a/b/c"));
  // true — ** really crosses segment boundaries
  console.log(pattern.enumerationPrefix, pattern.crossesSegments);
  // "packages/" true

  const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
  console.log(set.matches("packages/core"), set.matches("packages/internal"));
  // true false
});

Effect.runPromise(program);
```

### Embed patterns in config schemas

`GlobPattern.FromString` is a `Schema.Codec<GlobPattern, string>` that validates compilability at decode time, so an uncompilable pattern fails as a schema issue before your program ever sees a `GlobPattern`.

```ts
import { GlobPattern } from "@effected/glob";
import { Schema } from "effect";

const Config = Schema.Struct({
  include: Schema.Array(GlobPattern.FromString),
});
```

Compilation is the only thing that fails, and it fails with one tagged `GlobPatternError` whose `reason` names the guard that fired — `PatternTooLong`, `ExpansionBudgetExceeded` or `NestingDepthExceeded` — carrying `limit` and `actual` rather than a message you have to parse. Where upstream truncates an over-budget brace expansion (silently changing what the pattern matches), this package fails instead. `GlobPattern.escape` / `unescape` build patterns safely from user-supplied literals.
