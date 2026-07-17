---
"@effected/glob": patch
---

## Documentation

Documents on `GlobPattern.enumerationPrefix` (with a cross-reference on `crossesSegments`) that the getter is meaningful for non-negated patterns only. A negated pattern's prefix is still computed from the inner pattern while `matches` inverts the result, so the pattern can match paths outside its own `enumerationPrefix` — a consumer that bounds traversal to the prefix must guard on `negated` and deep-walk from the inner prefix instead.
