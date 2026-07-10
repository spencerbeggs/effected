# @effected/glob

[![npm](https://img.shields.io/npm/v/@effected%2Fglob?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/glob)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies.

## Why @effected/glob

Glob matching is string → predicate compilation, and compilation can fail: a pattern can be too long, expand past a budget, or nest past a depth cap. `@effected/glob` makes that boundary typed — `GlobPattern.compile` fails with a structured `GlobPatternError` carrying the reason, limit and actual values, never a thrown surprise — while `matches` stays total: no hostile pattern produces a stack overflow, an OOM, or a hang. The engine is a ported-with-attribution vendoring of minimatch 10.2.5 (plus brace-expansion 5.0.7 and balanced-match 4.0.4), continuously property-tested against the real minimatch as an oracle, with every upstream DoS guard preserved and new depth guards on the recursion surfaces upstream left open.

One deliberate deviation: no ambient environment detection. `platform` is an explicit option defaulting to `"posix"` — the caller who knows passes it in; all win32 path handling is kept behind the option.

## Install

```bash
npm install @effected/glob effect
```

```bash
pnpm add @effected/glob effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

```ts
import { GlobPattern, GlobSet } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  // Single patterns: compile once, match totally.
  const pattern = yield* GlobPattern.compile("packages/**");
  pattern.matches("packages/a"); // true
  pattern.matches("packages/a/b"); // true — ** really crosses levels

  // Include/exclude sets: a leading ! is an exclusion filter.
  const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
  set.matches("packages/core"); // true
  set.matches("packages/internal"); // false
});
```

Embed patterns in config schemas with the `FromString` codec:

```ts
import { GlobPattern } from "@effected/glob";
import { Schema } from "effect";

const Config = Schema.Struct({
  include: Schema.Array(GlobPattern.FromString),
});
// decoding validates compilability; uncompilable patterns fail as SchemaError
```

## Features

- `GlobPattern.compile(source, options?)` — `Effect<GlobPattern, GlobPatternError>`; the fallible boundary.
- `GlobPattern#matches(candidate)` — total, pure, no error channel.
- `GlobPattern#hasMagic` / `negated` / `enumerationPrefix` / `crossesSegments` — metadata for directory enumerators.
- `GlobPattern.escape(literal)` / `unescape(pattern)` — build patterns from user-supplied literals.
- `GlobPattern.FromString` — `Schema.Codec<GlobPattern, string>`.
- `GlobPatternOptions` — the full minimatch options surface, schema-validated (invalid options throw at construction).
- `GlobSet.compile(patterns)` — include/exclude sets with `literals`, `wildcards`, `excludes` accessors and `isExcluded`.
- `GlobPatternError` — `_tag`-routable, with `pattern`, `reason` (`PatternTooLong` | `ExpansionBudgetExceeded` | `NestingDepthExceeded`), `limit` and `actual`.

## Attribution

The engine in `src/internal/` is ported with attribution from:

- [minimatch](https://github.com/isaacs/minimatch) 10.2.5 — Isaac Z. Schlueter and Contributors, BlueOak-1.0.0
- [brace-expansion](https://github.com/juliangruber/brace-expansion) 5.0.7 — Julian Gruber, MIT
- [balanced-match](https://github.com/juliangruber/balanced-match) 4.0.4 — Julian Gruber, MIT

Each ported file carries its notice; the real minimatch is used as the test oracle in this package's suite.

## License

[MIT](LICENSE)
