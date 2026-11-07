---
id: "0008"
title: "@effected/glob: maxGlobstarRecursion above 1000 is rejected at make"
kind: breaking
shows: behavioural
applies:
  "@effected/glob": ">=0.20.0"
detect: ["maxGlobstarRecursion"]
changesets: ["firm-globs-cap"]
closes: ["spencerbeggs/effected#1242"]
---

`GlobPatternOptions.maxGlobstarRecursion` accepts an integer from 1 to 1000, and the default is 200. A higher value throws at `GlobPatternOptions.make`. It is a number at compile time, so only a run finds this.

- **A literal or configured value above 1000**: lower it to 1000 at most. The cap is a stack depth, and past it a walk is a documented false negative rather than an error, so a pattern that needed more stops matching there. Test the patterns the raised value was for.
- **A value taken from user input or a config file**: bound it before `make`, or handle the throw at that boundary.

`GlobPattern.matches` and `GlobSet.matches` do not throw on a stack overflow. An overflow answers as the cap does: `false`, or `true` for a negated pattern. Remove a `try`/`catch` for `RangeError` around a match, because nothing reaches it, and any other error the engine throws is a defect.

Verify by running the code path that builds the options. A value at or below 1000 needs no change.
