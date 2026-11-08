---
"@effected/glob": minor
---

## Breaking Changes

### `maxGlobstarRecursion` is capped at 1000

`GlobPatternOptions.maxGlobstarRecursion` now accepts an integer from 1 to 1000, and the default stays 200. A higher value throws at `GlobPatternOptions.make`. The option is a plain number at compile time, so only a run finds this.

To migrate:

* Lower a literal or configured value to 1000 at most. Past the cap a walk is a documented false negative rather than an error, so test the patterns the raised value was for
* Bound a value that comes from user input or a config file before calling `make`, or handle the throw at that boundary

### Matching follows minimatch 11.0.5

The engine now answers as minimatch 11.0.5 does, so some patterns match differently:

* An empty path portion matches only an empty pattern portion: `a/b/` no longer matches `a/b/?(x)`, `a/b/*(x)` or `a/b/!(x)`, the same as `a/b/*`
* A `.` or `..` path portion matches only literal dots, with or without `dot`: with `dot: true`, `a/!(x)` and `a/*.` no longer match `a/.` or `a/..`, while `a/!(x).` now matches `a/.`
* Without `dot`, no wildcard takes the leading dot of a dotfile: `[.]*`, `[.]@(a|b)` and `*(a|b)*` no longer match `.a`
* A `!(...)` negates exactly its own sub-pattern: a `!(*)` sub-pattern matches nothing, so `a/!(*)b` no longer matches `a/b`, and `x/a!(b)*` now matches `x/ab`
* An extglob opener that is never closed is literal text: `a*(` no longer matches `ax(`. A portion that is exactly `?()` or `*()` is a `?` or `*` followed by `()`, so `*()` matches `x()` and `hasMagic` is `true` for both; `+(|)` no longer matches the text `+(|)`
* A one-character range such as `[a-a]` is magic, so `hasMagic` is `true` for it
* An escaped `\|` matches a literal `|`: `\|*` no longer matches `b`
* A `[` that never closes is a literal, and extglobs after it still parse: `[+(a)` now matches `[a`, and `hasMagic` is `true` for it
* `[[:punct:]]` matches symbols too (`$`, `^`, `|`), and `[[:print:]]` matches every character but controls
* `maxExtglobRecursion` is still accepted but no longer limits anything: every extglob is matched by minimatch 11's own matcher, and extglob nesting deeper than about 256 levels fails at compile with `NestingDepthExceeded`
* On `win32` with `windowsNoMagicRoot` (on by default with `nocase`), a UNC root with a host and no share, such as `//b`, stays literal, so `hasMagic` is `false` for it
* On `win32`, a `..` cannot remove a drive letter or a UNC host and share, so `C:/a/../../x` no longer matches `x`, and `//host/share/../x` no longer matches `//host/x`. A UNC host and share compare case-insensitively, and `//?/UNC/host/share/...` matches `//host/share/...` and back

To migrate:

* Test the patterns that relied on the old answers, especially extglobs matched against paths with a trailing `/`, and win32 patterns that climb with `..`

Two differences in match answers remain. minimatch 11 matches a numeric range of 100 or more values, such as `{0..999}`, as a single portion; this package still expands it, so `hasMagic` stays `false`, and a range past `braceExpandMax` fails at compile with `ExpansionBudgetExceeded`. And minimatch 11 joins a pattern's brace alternatives with `|` into one matcher, so a `[` in one alternative and a `]` in another become a class, and `b**{Z..a}` does not match its own text there; this package matches the union of the alternatives. Beside those, some patterns minimatch 11 accepts fail at compile here, always with a typed `GlobPatternError`: an over-budget expansion, nesting past 256 levels, and `InvalidRegExp` (see Bug Fixes).

### `GlobPatternError.reason` gains `InvalidRegExp`

Code that switches exhaustively on `GlobPatternError.reason` needs a case for `InvalidRegExp` (see Bug Fixes).

## Features

### `Wildcard`

`Wildcard` is a separate matcher for patterns such as `agent:*` in an allow-list. It is not a glob dialect: `*` matches any run of non-whitespace, `?` matches one non-whitespace character, and every other character is literal, including `/`, `[`, `{` and a leading dot. Matching never backtracks, so a pattern with many stars stays cheap on untrusted input.

```ts
import { Wildcard, WildcardOptions } from "@effected/glob";

const isAgent = Wildcard.compile("agent:*");
console.log(isAgent("agent:okfit/claude-code"), isAgent("agent: x"));
// true false

console.log(Wildcard.matches("HUMAN:*", "human:spencer", WildcardOptions.make({ nocase: true })));
// true
```

## Bug Fixes

* `optimizationLevel: 2` no longer lets a short pattern take minutes to compile (GHSA-g3hv-75wg-m249). Each `**/../<a>/<b>` doubled the patterns, then every pair was compared, so 16 of them (161 bytes) took about a minute. The split now stops at `braceExpandMax` patterns or 1,000,000 added path portions and fails with `ExpansionBudgetExceeded`; deduplication is linear. `{**/x,x/y}` at this level matches `x/y` again
* A brace pattern whose expansion passes 4,000,000 characters now fails with `ExpansionBudgetExceeded` (CVE-2026-14257). The count budget alone let a 2 KB pattern such as `x…x{a,b}{a,b}…` build hundreds of megabytes and take seconds to compile
* A long `{a},b}` rewrite chain no longer takes quadratic time. After 1,000 rewrites the rest of the pattern stays literal, as in brace-expansion 5.0.12, which counts the rewrites of a whole chain of groups together; a 64 KB pattern of that shape took 8 seconds
* A POSIX class beside a `,`, `#`, space or `-` in one path portion, such as `[[:alpha:]]-*` or `[[:alpha:]]\{a,b}`, no longer throws a raw `SyntaxError` from `GlobPattern.compile`, `GlobPattern.compileResult`, `GlobSet` or schema decoding. It fails typed with the new `GlobPatternError` reason `InvalidRegExp`, whose `limit` and `actual` are 0. In a portion with an extglob, a loose `,`, `#`, space or `-` beside the class now compiles and matches as minimatch 11 does; a one-character class such as `[,]` beside a POSIX class still fails with `InvalidRegExp`
* Matching a pattern with nested repeated extglobs, such as `*(*(a|b)*)`, no longer takes exponential time: a 40-byte pattern matched against its own text took over 40 seconds, and now takes about a millisecond
* A pattern with many `!(...)` in one portion no longer runs the process out of memory at compile: `x` followed by 25 copies of `!(a)` (101 bytes) did. Such a portion is now matched directly, as minimatch 11 matches it, and compiles in linear time
* A pattern too large for the runtime's regular-expression engine (about 32,000 literal characters and a wildcard in one path portion, or about 33,000 non-Latin-1 ones) now fails at compile with `InvalidRegExp`. Compiling runs each regular expression once on a one-byte and once on a two-byte subject, so no pattern that compiles can make `matches` throw
* A pattern of stars separated by literals no longer takes exponential time: `*a` fourteen times then `b`, against 40 characters, took 25 seconds and now takes well under a millisecond. Every pattern portion with magic in it is matched by minimatch 11's own matcher, so `?` also takes one character of an astral file name (`?.txt` matches `😀.txt`), and `*(a)` sixteen thousand times against a 1,000-character path takes about 30 ms to compile and a few ms to match
* A pattern with a long run of `[` that never closes no longer takes seconds to compile: 2,000 `[` in a row took about 5 seconds, and a 64 KB pattern of them would have taken minutes. Such a run now compiles in linear time
* `*\.` and `?\.` now match `a.`. The `*.ext` shortcut compared an escaped extension with its backslash, so they matched only a name ending in `\.`
* `GlobPattern.matches` and `GlobSet.matches` no longer throw when a match overflows the stack. The whole pattern answers as though no alternative matched: `false`, or `true` for a negated pattern. A `try`/`catch` for `RangeError` around a match can go

## Documentation

* The README and `GlobPattern.matches` now cover hostile input. Matching is polynomial and bounded by the input, not linear everywhere: a chain of negations separated by literals, `x!(a)` repeated against `xb` repeated, takes about 22 ms at 400 characters and 1.6 s at 2,000, as in minimatch 11. Matching is synchronous, so an in-process timeout such as `Effect.timeout` cannot stop it: bound the pattern and candidate first, lower `braceExpandMax`, and enforce any deadline off-thread
