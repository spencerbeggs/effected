---
"@effected/glob": minor
---

## Features

### Pattern introspection

* `GlobPattern.matchesByBasename` reports whether `matchBase` makes a pattern match by basename, and the enumeration getters and `literalPrefix` now account for `matchBase`
* `GlobPattern.alternativeCount` counts the brace alternatives a pattern expands to without compiling it, exactly below `braceExpandMax`, and fails typed on hostile input
* `crossesSegments` measures from the shared prefix of the brace alternatives, so `a/{b,c/d}` is judged by what differs

### Compile budget

A pattern whose compile would exceed the regexp and matcher-graph work budget fails typed with the new `CompileBudgetExceeded` reason on `GlobPatternError`. A `GlobSet` shares one budget across its members, so a set whose members each compile can still fail as a whole. The budget fits about 2,550 distinct POSIX-class members; options that change a regexp fit about half as many. A portion with more than 256 Unicode properties also fails typed.

## Bug Fixes

* A POSIX class beside `,`, `#`, a space or `-` compiles and matches as minimatch 11 does
* A numeric range of 100 or more values, such as `{0..999}`, is one magic portion: `hasMagic` is `true`, `GlobSet` buckets it as a wildcard, and enumeration roots stop at it
* `GlobSet` classifies its members at compile time and `matches` never throws
* An escaped brace is no longer expanded twice

## Breaking Changes

`GlobPatternError.reason` gains `CompileBudgetExceeded`. An exhaustive switch on `reason` needs the new case.
