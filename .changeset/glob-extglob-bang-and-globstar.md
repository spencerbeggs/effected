---
"@effected/glob": minor
---

## Features

* Opt-in `extglobBang` (#1172) reads a leading `!(` as the `!(…)` extglob, as picomatch does, instead of whole-pattern negation. A plain `!a` still negates. Off by default.
* New `literalPrefix` (#1200) on `GlobPattern` returns the literal leading directory segments before the first magic one. Under `nocase` it is spelling-only: it never folds case, so it is not a safe walk root on a case-sensitive filesystem.

## Bug Fixes

* Patterns with more than one `**` no longer give false negatives, and `partial` no longer gives wrong answers for them (#1238).

## Performance

* Matching no longer goes exponential on patterns with many `**`, which also affected default options (#1238). Matching is now polynomial, bounded by the recursion cap; a pathological pattern against a long candidate can still be slow.
