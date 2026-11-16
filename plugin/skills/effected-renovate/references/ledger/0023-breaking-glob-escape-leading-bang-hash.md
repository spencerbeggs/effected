---
id: "0023"
title: "@effected/glob follows minimatch 11.0.8: escape() escapes a leading ! or #, and an escaped backslash before braces stays literal"
kind: breaking
shows: behavioural
applies:
  "@effected/glob": ">=0.23.0"
detect: ["GlobPattern\\.escape", "GlobPattern\\.unescape", "\\\\\\\\\\{", "\\{[^}]*\\\\\\\\,"]
closes: ["1365"]
changesets: ["glob-minimatch-11-0-8", "breaking-floor-effected-app", "breaking-floor-effected-cli-kit", "breaking-floor-effected-config-file", "breaking-floor-effected-lockfiles", "breaking-floor-effected-tsconfig-json", "breaking-floor-effected-walker", "breaking-floor-effected-xdg"]
---

The glob engine now follows minimatch 11.0.8. The compiler finds none of this, so read each hit and run its tests.

- `GlobPattern.escape` escapes a leading `!` or `#`: `escape("!x")` is `\!x` and `escape("#x")` is `\#x`, or `@(!)x` and `[#]x` under `windowsPathsNoEscape`. Where a hit compares escape output to a fixed string, or builds an exclusion by escaping a value and relying on its leading `!`, fix the hit: an escaped `!name` is now an include of that literal name. Build an exclusion by prefixing `!` to the escaped value instead.
- `GlobPattern.unescape` reads a leading `@(!)` back as `!`.
- An escaped backslash (`\\`) before a brace group stays a literal backslash through expansion: `{a\\,b}{0..199}` matches `a\5`, not `a5`, and `a\\{b,c}` matches `a\b`, not `ab`. Where a hit relied on the old match, update the pattern or the expectation.

The kit packages that peer on `@effected/glob` (`app`, `cli-kit`, `config-file`, `lockfiles`, `tsconfig-json`, `walker`, `xdg`) release a breaking line with this one because their peer floor moved to 0.23.0: upgrade them in the same install as `@effected/glob`.

Check the installed `.d.ts` and the package README before changing a hit.
