---
id: "0024"
title: "@effected/glob: a new CompileBudgetExceeded failure, set-wide budgets, and ranges of 100+ values kept whole"
kind: breaking
shows: typed
applies:
  "@effected/glob": ">=0.20.0"
detect: ["GlobPatternError", "GlobSet\\.(make|compile|compileResult)", "hasMagic", "\\{-?[0-9]+\\.\\.-?[0-9]+\\}"]
changesets: ["exact-braces-count"]
closes: ["spencerbeggs/effected#1278", "spencerbeggs/effected#1279", "spencerbeggs/effected#1282", "spencerbeggs/effected#1287"]
---

`GlobPatternError.reason` gains `CompileBudgetExceeded`, so the compiler flags an exhaustive `switch` or `Match` on `reason` until it handles the case. Treat it like the other budget reasons: the pattern is refused, never half-compiled.

- **A compile now has a work budget** for its regexps and matcher graphs, and a portion with more than 256 Unicode properties fails typed. Ordinary patterns are far inside it; thousands of alternatives each carrying a POSIX class are not. Options that change a regexp (`nocase`, `dot`) fit about half of what a default-options compile does.
- **A `GlobSet` is one compile.** Its members share one budget, so a set whose members each compile alone can fail as a whole, at about 2,550 distinct POSIX-class members. A caller that builds a set from untrusted lists handles the typed failure at that boundary. `GlobSet.compileResult` classifies at compile time, so `matches` never throws.
- **A numeric range of 100 or more values** (`{0..999}`) is one magic portion, as in minimatch 11: `hasMagic` is `true`, `GlobSet` buckets it as a wildcard, and enumeration roots stop at it. Code that read such a pattern as literal or expanded it itself should rely on the pattern instead.
- **A POSIX class beside `,`, `#`, a space or `-`** (`[[:alpha:]]-*`) now compiles and matches; it used to fail `InvalidRegExp`. Remove a fallback written for that failure.
- **`crossesSegments` measures from the prefix all brace alternatives share**, so `{apps,packages}/*` is `true`. A hand enumerator that paired it with `enumerationPrefix` now reads every root.

New surface worth adopting: `GlobPattern.matchesByBasename` (the exact `matchBase` rule) and `GlobPattern.alternativeCount` (brace alternatives counted without compiling). Verify by running the code path that compiles patterns from configuration, and read the installed `.d.ts` for the exact shapes.
