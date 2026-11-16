---
"@effected/glob": minor
---

## Bug Fixes

* An escaped backslash before a brace group now stays a literal backslash through brace expansion, as in minimatch 11.0.8. `{a\\,b}{0..199}` matches `a\5`, not `a5`, and `a\\{b,c}` matches `a\b`, not `ab`. In a `GlobSet`, such an include stays one wildcard instead of splitting into alternatives.
* Under `windowsPathsNoEscape`, a `[{]` or `[}]` class stays a literal brace through expansion.

## Breaking Changes

* `GlobPattern.escape` escapes a leading `!` or `#`, so an escaped literal is never read as a negation or a comment. `escape("!x")` returns `\!x` and `escape("#x")` returns `\#x`; under `windowsPathsNoEscape` they return `@(!)x` and `[#]x`. `GlobPattern.unescape` reverses both. In a `GlobSet`, an escaped `!name` is now an include of that literal name, not an exclusion.
