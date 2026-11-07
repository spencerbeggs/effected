---
"@effected/glob": minor
---

## Breaking Changes

### `maxGlobstarRecursion` is capped at 1000

`GlobPatternOptions.maxGlobstarRecursion` now accepts an integer from 1 to 1000, and the default stays 200. A higher value throws at `GlobPatternOptions.make`. The option is a plain number at compile time, so only a run finds this.

To migrate:

* Lower a literal or configured value to 1000 at most. Past the cap a walk is a documented false negative rather than an error, so test the patterns the raised value was for
* Bound a value that comes from user input or a config file before calling `make`, or handle the throw at that boundary

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

* `GlobPattern.matches` and `GlobSet.matches` no longer throw when a match overflows the stack. The whole pattern answers as though no alternative matched: `false`, or `true` for a negated pattern. A `try`/`catch` for `RangeError` around a match can go

## Documentation

* The README and `GlobPattern.matches` now cover hostile input. Matching is synchronous, so an in-process timeout such as `Effect.timeout` cannot stop it: bound the pattern and candidate first, lower `braceExpandMax`, and enforce any deadline off-thread
