# @effected/glob

[![npm](https://img.shields.io/npm/v/@effected%2Fglob?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/glob)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `~4.1.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/glob

Glob matching is compilation: a pattern string becomes a predicate over candidate strings, and compilation is the step that can fail. A pattern can exceed the length cap, expand past the brace-expansion budget, or nest past the depth cap. Most glob libraries paper over that boundary by throwing, by silently truncating an over-budget expansion (which quietly changes what the pattern matches), or by overflowing the stack on input a user was allowed to supply.

This package puts the failure where it belongs. `GlobPattern.compile` is the one fallible entry point: it returns `Effect<GlobPattern, GlobPatternError>`, and the error carries the `reason`, the `limit` and the `actual` value rather than a message you have to parse. Once a `GlobPattern` exists, `matches` is total — pure, synchronous, no error channel, and no hostile pattern can make it overflow or allocate unboundedly, because every guard fired before the instance was constructed. Matching time is polynomial, bounded by the recursion cap, so a hostile pattern against a long candidate can still be slow.

The dialect is not a subset. The engine is a ported-with-attribution vendoring of minimatch, property-tested against the real minimatch as an oracle on every build, with every upstream DoS guard preserved and new depth guards added on the recursion surfaces upstream left open. Vendoring rather than depending is what keeps the package free of runtime dependencies: `effect` is the only peer, and the minimatch oracle is a devDependency confined to the test suite.

One deliberate deviation from upstream: no ambient environment detection. `platform` is an explicit option defaulting to `"posix"`, and `process.platform` is never read, so a pattern behaves identically on every machine. All win32 path handling stays behind the option, for the caller who knows they need it.

The engine is ported from minimatch 10.2.5 and answers as minimatch 11.0.5 does, which is its test oracle. That includes 11's fixes to `**` matching (minimatch 10.x gives wrong answers on some patterns with more than one `**`, such as `**/a/b/c/**/d/**` against `d/a/b/c/d/b`, and under `partial`); an empty path portion matching only an empty pattern portion, so `a/b/` does not match `a/b/?(x)`; a `.` or `..` portion matching only literal dots, with or without `dot`; no wildcard taking the leading dot of a dotfile without `dot`, even a class such as `[.]` beside other magic or a `*` after an extglob that matched nothing (`[.]*` and `*(a|b)*` do not match `.a`); a `!(...)` negating exactly its own sub-pattern (`!(*)` matches nothing, and `x/a!(b)*` matches `x/ab`); an extglob opener that is never closed reading as literal text (`a*(` does not match `ax(`); a `[` that never closes reading as a literal, with extglobs after it still parsed (`[+(a)` matches `[a`); an escaped `\|` matching a literal `|`; and on win32, a `..` that cannot climb past a drive letter or a UNC share. A numeric range of 100 or more values, such as `{0..999}`, is one pattern portion, as in minimatch 11: `hasMagic` is `true` for it, it is not expanded, and no expansion budget applies to it. One difference in match answers remains: minimatch 11 joins a pattern's brace alternatives with `|` into one matcher, so a `[` in one alternative and a `]` in another become a class (`b**{Z..a}` does not match its own text there); this engine matches the union of the alternatives. Beside it, some patterns 11 accepts fail at compile here, always with a typed `GlobPatternError`: see [Errors](#errors).

## Install

```bash
npm install @effected/glob effect
```

```bash
pnpm add @effected/glob effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

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
| `InvalidRegExp` | A portion's regular expression is too large for the runtime, about 32,000 literal characters before one wildcard. minimatch 11 accepts it. `limit` and `actual` are both 0. |
| `CompileBudgetExceeded` | Compiling the pattern would build more than one compile allows (8,000,000 units: a regexp's length, plus 2,048 for each Unicode property a POSIX class turns into, plus 4 for each item of a portion's matcher). A brace expansion that gives each of thousands of alternatives its own POSIX class, such as `[[:alpha:]]{0..99}{0..99}`, or its own copy of a numeric range kept whole, such as `{$,a}{-9007199254740991..9007199254740991}` twelve times over, fails here instead of exhausting memory. A `GlobSet` is one compile, so its members share the budget. minimatch 11 builds its matchers lazily and accepts the first; it refuses the second. |

```ts
import { GlobPattern } from "@effected/glob";
import { Effect } from "effect";

Effect.runPromise(Effect.result(GlobPattern.compile("a".repeat(70_000)))).then(console.log);
// Failure with GlobPatternError:
// { reason: "PatternTooLong", limit: 65536, actual: 70000, pattern: "aaaa…" }
```

## Hostile input

Matching stays polynomial, and the package does not bound its total work. Four measured cases:

| Pattern | Candidate | Time |
| --- | --- | --- |
| `**/a/**` | 50,000 portions | about 3 s |
| `x` and 1,600 × `!(a)` (6.4 KB) | `x` and 1,600 × `b` | about 25 ms |
| `*(a\|?)` × 10,000 (60 KB) | 1,000 × `a` | about 15 ms |
| `x!(a)` × 1,000 | `xb` × 1,000 (2,000 characters) | about 1.6 s, about cubic in the length (22 ms at 400 characters); minimatch 11 is slower still |

Brace expansion multiplies the work of compiling and matching by its alternatives, within the default `braceExpandMax` of 100,000; a numeric range of 100 or more values is not expanded. Matching is synchronous and blocks the calling thread until it returns, so an in-process timeout cannot stop it: `Effect.timeout` around `Effect.sync(() => pattern.matches(path))` still waits for the whole match. When a pattern or a path comes from untrusted input, bound the input before matching:

- limit the pattern's length, and where a pattern may come from;
- limit the candidate's length or number of portions;
- lower `braceExpandMax`: with `GlobPatternOptions.make({ braceExpandMax: 100 })` a brace product such as `**/a/**/*{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}*` (1,024 alternatives) fails at compile with `ExpansionBudgetExceeded`.

A `GlobSet` is one compile: its members share one compile budget, and past it the set fails typed with `CompileBudgetExceeded`. Each POSIX class costs about 4,096 units in its validation regexp, so a set in which every member has one, such as `[[:alpha:]]` in each line, tops out at roughly 1,900 members; sets of plain, brace and numeric-range lines compile at 20,000 lines.

Where a deadline is needed, enforce it off the calling thread: run the match in a worker that is terminated when the deadline passes, in a subprocess, or under the host's own request deadline.

`maxGlobstarRecursion` is bounded at 1,000, so no accepted value overflows the stack on a default Node stack. If a caller runs `matches` with less stack than that, a stack overflow is never thrown: `matches` answers as though no alternative matched, which is `false` for an ordinary pattern and `true` for a negated one. That is not always the recursion cap's answer for a brace pattern with several alternatives, because the cap fails only the alternative it cuts short and the engine goes on to try the rest, while an overflow answers for the whole pattern.

## Wildcard

`Wildcard` is a separate matcher for patterns like `agent:*` in an allow-list. It is not a glob dialect: `*` matches any run of characters other than whitespace, `?` matches one character other than whitespace, and every other character is literal. There is no separator, so `*` crosses `/`, and `[`, `{`, `!`, `\` and a leading `.` mean nothing special.

```ts
import { Wildcard, WildcardOptions } from "@effected/glob";

const isAgent = Wildcard.compile("agent:*");
console.log(isAgent("agent:okfit/claude-code"), isAgent("agent: x"));
// true false

console.log(Wildcard.matches("HUMAN:*", "human:spencer", WildcardOptions.make({ nocase: true })));
// true
```

`nocase` compares literals under Unicode simple case folding, as a regular expression with the `i` and `u` flags does. Characters are code points, and whitespace is what `\s` matches under the `u` flag. Compiling and matching never throw. Matching does not backtrack, so it costs at most the pattern's length times the candidate's, and consecutive stars collapse to one.

## Features

- `GlobPattern.compile(source, options?)` — `Effect<GlobPattern, GlobPatternError>`; the fallible boundary, and the only one.
- `GlobPattern#matches(candidate)` — total, pure, no error channel.
- `GlobPattern#hasMagic` / `negated` / `enumerationPrefix` / `crossesSegments` — metadata for directory enumerators.
- `GlobPattern#literalPrefix` — the literal leading directory segments before the first magic segment, unescaped and without a trailing slash (`src/{a,b}/*.ts` gives `src`; `src/a.ts` gives itself; `""` when the first segment is magic). Braces are not expanded: an unescaped `{` is magic.
- `extglobBang` option — read a leading `!(` as the `!(…)` extglob rather than whole-pattern negation, as picomatch does. Off by default, so the minimatch reading holds; `!a` still negates. Parity with picomatch at this one point only (set `dot` too to agree with Vitest). `nonegate: true` also gives picomatch's answer for `!(`, but disables every `!` negation. `GlobSet` has no options surface and strips one leading `!` itself as its exclusion marker.
- `GlobPattern.escape(literal)` / `unescape(pattern)` — build patterns safely from user-supplied literals.
- `GlobPattern.FromString` — a `Schema.Codec<GlobPattern, string>` for embedding patterns in config schemas.
- `GlobPatternOptions` — the full minimatch options surface, schema-validated. Options refine matching; they never admit a pattern that the defaults reject.
- `maxGlobstarRecursion` option — from `1` to `1000`, default `200`; a walk past it is a false negative, never an error.
- `Wildcard.compile(pattern, options?)` / `Wildcard.matches(pattern, candidate, options?)` — `*` and `?` only, no separator semantics; `WildcardOptions` carries `nocase`.
- `GlobSet.compile(patterns)` — include/exclude sets with `literals`, `wildcards` and `excludes` accessors plus `isExcluded`.
- `GlobPatternError` — `_tag`-routable, carrying `pattern`, `reason`, `limit` and `actual`.

## Attribution

The engine in `src/internal/` is ported with attribution from:

- [minimatch](https://github.com/isaacs/minimatch) 10.2.5, with the behaviour of 11.0.5 — Isaac Z. Schlueter and Contributors, BlueOak-1.0.0
- [@isaacs/nonrecursive-glob-match](https://github.com/isaacs/nonrecursive-glob-match) 1.1.0, the portion matcher minimatch 11.0.5 runs — Isaac Z. Schlueter and Contributors, BlueOak-1.0.0
- [brace-expansion](https://github.com/juliangruber/brace-expansion) 5.0.12 — Julian Gruber, MIT
- [balanced-match](https://github.com/juliangruber/balanced-match) 4.0.4 — Julian Gruber, MIT

Each ported file carries its notice, and the real minimatch is used as the test oracle in this package's suite.

## License

[MIT](LICENSE)
