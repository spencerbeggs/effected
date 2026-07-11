# @effected/glob

[![npm](https://img.shields.io/npm/v/@effected%2Fglob?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/glob)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies.

## Why @effected/glob

Glob matching is compilation: a pattern string becomes a predicate over candidate strings, and compilation is the step that can fail. A pattern can exceed the length cap, expand past the brace-expansion budget, or nest past the depth cap. Most glob libraries paper over that boundary by throwing, by silently truncating an over-budget expansion (which quietly changes what the pattern matches), or by overflowing the stack on input a user was allowed to supply.

This package puts the failure where it belongs. `GlobPattern.compile` is the one fallible entry point: it returns `Effect<GlobPattern, GlobPatternError>`, and the error carries the `reason`, the `limit` and the `actual` value rather than a message you have to parse. Once a `GlobPattern` exists, `matches` is total — pure, synchronous, no error channel, and no hostile pattern can make it overflow, allocate unboundedly or hang, because every guard fired before the instance was constructed.

The dialect is not a subset. The engine is a ported-with-attribution vendoring of minimatch, property-tested against the real minimatch as an oracle on every build, with every upstream DoS guard preserved and new depth guards added on the recursion surfaces upstream left open. Vendoring rather than depending is what keeps the package free of runtime dependencies: `effect` is the only peer, and the minimatch oracle is a devDependency confined to the test suite.

One deliberate deviation from upstream: no ambient environment detection. `platform` is an explicit option defaulting to `"posix"`, and `process.platform` is never read, so a pattern behaves identically on every machine. All win32 path handling stays behind the option, for the caller who knows they need it.

## Install

```bash
npm install @effected/glob effect
```

```bash
pnpm add @effected/glob effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

Compile once, then match as many candidates as you like:

```ts
import { GlobPattern, GlobSet } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pattern = yield* GlobPattern.compile("packages/**");
  console.log(pattern.matches("packages/a"));
  // true
  console.log(pattern.matches("packages/a/b/c"));
  // true — ** really crosses segment boundaries
  console.log(pattern.matches("src/a"));
  // false

  // Include/exclude sets: a leading ! is an exclusion filter.
  const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
  console.log(set.matches("packages/core"));
  // true
  console.log(set.matches("packages/internal"));
  // false
});

Effect.runPromise(program);
```

A compiled pattern also carries the metadata a directory enumerator needs, so you can skip walking trees that cannot match:

```ts
import { GlobPattern } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pattern = yield* GlobPattern.compile("packages/**");
  console.log(pattern.hasMagic, pattern.enumerationPrefix, pattern.crossesSegments);
  // true "packages/" true
});

Effect.runPromise(program);
```

Embed patterns in config schemas with the `FromString` codec, which validates compilability at decode time:

```ts
import { GlobPattern } from "@effected/glob";
import { Schema } from "effect";

const Config = Schema.Struct({
  include: Schema.Array(GlobPattern.FromString),
});
// Decoding a config whose `include` holds an uncompilable pattern fails as a
// schema issue, before your program ever sees a GlobPattern.
```

## Errors

Compilation is the only thing that fails, and it fails with one tagged error whose `reason` tells you which guard fired:

| `reason` | Fires when |
| -------- | ---------- |
| `PatternTooLong` | The pattern exceeds the 64KB length cap. |
| `ExpansionBudgetExceeded` | Brace expansion would produce more alternatives than the budget allows. Upstream truncates here, silently changing match semantics; this package fails instead. |
| `NestingDepthExceeded` | Braces, extglobs or the AST nest past the depth cap. |

```ts
import { GlobPattern } from "@effected/glob";
import { Effect } from "effect";

Effect.runPromise(Effect.result(GlobPattern.compile("a".repeat(70_000)))).then(console.log);
// Failure with GlobPatternError:
// { reason: "PatternTooLong", limit: 65536, actual: 70000, pattern: "aaaa…" }
```

## Features

- `GlobPattern.compile(source, options?)` — `Effect<GlobPattern, GlobPatternError>`; the fallible boundary, and the only one.
- `GlobPattern#matches(candidate)` — total, pure, no error channel.
- `GlobPattern#hasMagic` / `negated` / `enumerationPrefix` / `crossesSegments` — metadata for directory enumerators.
- `GlobPattern.escape(literal)` / `unescape(pattern)` — build patterns safely from user-supplied literals.
- `GlobPattern.FromString` — a `Schema.Codec<GlobPattern, string>` for embedding patterns in config schemas.
- `GlobPatternOptions` — the full minimatch options surface, schema-validated. Options refine matching; they never admit a pattern that the defaults reject.
- `GlobSet.compile(patterns)` — include/exclude sets with `literals`, `wildcards` and `excludes` accessors plus `isExcluded`.
- `GlobPatternError` — `_tag`-routable, carrying `pattern`, `reason`, `limit` and `actual`.

## Attribution

The engine in `src/internal/` is ported with attribution from:

- [minimatch](https://github.com/isaacs/minimatch) 10.2.5 — Isaac Z. Schlueter and Contributors, BlueOak-1.0.0
- [brace-expansion](https://github.com/juliangruber/brace-expansion) 5.0.7 — Julian Gruber, MIT
- [balanced-match](https://github.com/juliangruber/balanced-match) 4.0.4 — Julian Gruber, MIT

Each ported file carries its notice, and the real minimatch is used as the test oracle in this package's suite.

## License

[MIT](LICENSE)
